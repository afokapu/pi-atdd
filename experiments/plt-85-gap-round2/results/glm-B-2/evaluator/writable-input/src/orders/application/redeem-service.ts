/**
 * Application use cases that move loyalty points: redeeming points for a
 * pending order, and refunding them when a redeemed order is cancelled.
 *
 * The loyalty store is asynchronous, so two concurrent requests would
 * otherwise read the same lot snapshot and double-spend it. Every ledger
 * mutation for one customer therefore runs inside a per-customer promise
 * chain (a mutex), which serializes redemptions and cancellation refunds
 * without blocking unrelated customers.
 */
import { cancel as cancelOrder, type Order } from "../domain/order.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { InMemoryRedemptionStore, Redemption } from "../integration/redemption-store.ts";
import { pointsToCents, type PointsLot } from "../../loyalty/domain/points.ts";
import { planRefund, planSpend, type LotDeduction } from "../../loyalty/domain/redeem.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import { quoteForOrderWithPoints } from "../../pricing/application/quote-service.ts";
import { UnknownDiscountCodeError } from "../../pricing/domain/discount.ts";
import { UnknownRegionError } from "../../pricing/integration/tax-rates.ts";
import type { QuoteWithPoints } from "../../pricing/domain/quote.ts";

/** Redeem attempt outcome: the new quote, or an HTTP-mappable failure. */
export type RedeemResult =
  | { ok: true; quote: QuoteWithPoints }
  | { ok: false; status: number; error: string };

/** Cancellation outcome: the cancelled order, or an HTTP-mappable failure. */
export type CancelResult =
  | { ok: true; order: Order }
  | { ok: false; status: number; error: string };

export type RedeemInput = {
  orderId: string;
  customerId: string;
  /** Positive integer number of points the customer wants to spend. */
  points: number;
  idempotencyKey: string;
};

export type RedeemServiceDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  redemptions: InMemoryRedemptionStore;
  /** Current time, used for every lot-expiry decision. Defaults to the system clock. */
  now?: () => Date;
};

export class RedeemService {
  private readonly deps: RedeemServiceDeps;
  /** customerId → tail of that customer's chain of ledger operations. */
  private locks = new Map<string, Promise<unknown>>();

  constructor(deps: RedeemServiceDeps) {
    this.deps = deps;
  }

  /** Redeem points for a pending order; idempotent per idempotencyKey. */
  async redeem(input: RedeemInput): Promise<RedeemResult> {
    // Idempotency is decided before any state check: a retry of an applied
    // redemption must return the original result even if the order has since
    // changed status (e.g. was shipped or cancelled afterwards).
    const existing = await this.deps.redemptions.find(input.idempotencyKey);
    if (existing) return this.replayOrConflict(existing, input);
    const order = this.deps.orders.get(input.orderId);
    if (!order || order.customerId !== input.customerId) return { ok: false, status: 404, error: "order not found" };
    if (order.status !== "pending") return { ok: false, status: 409, error: `order ${order.id} is ${order.status}` };
    return this.locked(input.customerId, () => this.applyRedemption(input));
  }

  /** Cancel a pending order owned by the customer and refund its redeemed points. */
  async cancelOrder(input: { orderId: string; customerId: string }): Promise<CancelResult> {
    const order = this.deps.orders.get(input.orderId);
    if (!order || order.customerId !== input.customerId) return { ok: false, status: 404, error: "order not found" };
    if (order.status !== "pending") return { ok: false, status: 409, error: `order ${order.id} is ${order.status}` };
    await this.locked(input.customerId, async () => {
      this.deps.orders.save(cancelOrder(order)); // domain rule: only pending orders cancel
      await this.refundRedemptions(order);
    });
    return { ok: true, order: this.deps.orders.get(input.orderId)! };
  }

  /** Same key + same request replays the stored quote; same key + different request is rejected. */
  private replayOrConflict(existing: Redemption, input: RedeemInput): RedeemResult {
    const sameRequest = existing.orderId === input.orderId
      && existing.customerId === input.customerId
      && existing.pointsRequested === input.points;
    if (!sameRequest) return { ok: false, status: 409, error: "idempotencyKey already used for a different request" };
    return { ok: true, quote: existing.quote };
  }

  /** Mutation half of redeem; always runs inside the customer's lock. */
  private async applyRedemption(input: RedeemInput): Promise<RedeemResult> {
    // A concurrent retry with the same key may have finished while this call
    // waited for the lock — replay it instead of consuming twice.
    const raced = await this.deps.redemptions.find(input.idempotencyKey);
    if (raced) return this.replayOrConflict(raced, input);
    const order = this.deps.orders.get(input.orderId)!;
    if (order.status !== "pending") return { ok: false, status: 409, error: `order ${order.id} is ${order.status}` };
    try {
      return await this.spendAndRecord(order, input);
    } catch (e) {
      if (e instanceof UnknownDiscountCodeError || e instanceof UnknownRegionError) {
        return { ok: false, status: 400, error: (e as Error).message };
      }
      throw e;
    }
  }

  /** Consume lots earliest-expiry-first, record the ledger entry, return the new quote. */
  private async spendAndRecord(order: Order, input: RedeemInput): Promise<RedeemResult> {
    const now = this.clock();
    const base = quoteForOrderWithPoints(order, 0);
    // Points reduce the amount after discounts and before tax; 1 point = 1
    // cent, so points beyond the discounted subtotal would push the amount
    // below zero and are simply not consumed.
    const dueCents = base.subtotalCents - base.discountCents;
    const lots = await this.deps.loyalty.lotsFor(order.customerId);
    const plan = planSpend(lots, Math.min(pointsToCents(input.points), dueCents), now);
    await this.debitLots(plan.deductions, lots);
    const quote = quoteForOrderWithPoints(order, plan.applied);
    await this.deps.redemptions.save({
      idempotencyKey: input.idempotencyKey,
      orderId: order.id,
      customerId: order.customerId,
      pointsRequested: input.points,
      pointsApplied: quote.pointsCents,
      deductions: plan.deductions,
      quote,
      refunded: false,
    });
    return { ok: true, quote };
  }

  /** Write the planned debits back to the loyalty store via the loaded lot copies. */
  private async debitLots(deductions: LotDeduction[], lots: PointsLot[]): Promise<void> {
    const byId = new Map(lots.map(l => [l.id, l]));
    for (const d of deductions) {
      const lot = byId.get(d.lotId)!;
      lot.points -= d.points;
      await this.deps.loyalty.saveLot(lot);
    }
  }

  /** Restore every non-refunded redemption of a cancelled order (runs under the lock). */
  private async refundRedemptions(order: Order): Promise<void> {
    const now = this.clock();
    const lots = await this.deps.loyalty.lotsFor(order.customerId);
    const byId = new Map(lots.map(l => [l.id, l]));
    for (const record of await this.deps.redemptions.allForOrder(order.id)) {
      if (record.refunded) continue;
      const plan = planRefund(record.deductions, id => byId.get(id), now);
      await this.restoreLots(plan.restorations, byId);
      await this.deps.redemptions.save({ ...record, refunded: true });
    }
  }

  /** Add restored points back to their original lots; lots missing from the store stay forfeited. */
  private async restoreLots(restorations: LotDeduction[], byId: Map<string, PointsLot>): Promise<void> {
    for (const r of restorations) {
      const lot = byId.get(r.lotId);
      if (!lot) continue;
      lot.points += r.points;
      await this.deps.loyalty.saveLot(lot);
    }
  }

  private clock(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  /**
   * Run `task` after every previously queued task of the same customer.
   * The stored tail never rejects, so one failure cannot poison the queue.
   */
  private locked<T>(customerId: string, task: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(customerId) ?? Promise.resolve();
    const run = prev.then(task);
    this.locks.set(customerId, run.then(() => undefined, () => undefined));
    return run;
  }
}
