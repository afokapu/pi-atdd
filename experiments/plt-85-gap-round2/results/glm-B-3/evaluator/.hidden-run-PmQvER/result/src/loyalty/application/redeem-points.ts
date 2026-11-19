import { planConsumption, refundableConsumption, type Consumption } from "../domain/points.ts";
import { isSameRedemption, type RedemptionRecord } from "../domain/redemption.ts";
import type { InMemoryLoyaltyStore } from "../integration/loyalty-store.ts";
import type { InMemoryRedemptionStore } from "../integration/redemption-store.ts";
import { OrderStateError, requirePending, type Order } from "../../orders/domain/order.ts";
import type { InMemoryOrderStore } from "../../orders/integration/order-store.ts";
import { quoteForOrder, quoteForOrderWithPoints } from "../../pricing/application/quote-service.ts";
import type { RedeemedQuote } from "../../pricing/domain/quote.ts";

/** Result of a redeem attempt; the route maps each kind onto an HTTP response. */
export type RedeemOutcome =
  | { kind: "ok"; quote: RedeemedQuote }
  | { kind: "orderNotFound" }
  | { kind: "orderNotPending"; message: string }
  | { kind: "conflict"; message: string };

export type RedemptionDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  redemptions: InMemoryRedemptionStore;
  /** Current time; decides which points lots are expired. */
  now: () => Date;
};

/**
 * Use case: pay part of a pending order with loyalty points.
 *
 * Every mutation runs inside the owner's loyalty ledger transaction, so
 * concurrent redemptions (or a cancellation) for one customer serialize and
 * never spend or refund the same points twice. Idempotency: a repeated key
 * with the identical request replays the stored result without consuming
 * anything more; the same key with a different body is a conflict.
 */
export class RedemptionService {
  private deps: RedemptionDeps;
  constructor(deps: RedemptionDeps) { this.deps = deps; }

  /** Spend `points` on order `orderId` for `customerId`, idempotent per `idempotencyKey`. */
  async redeem(customerId: string, orderId: string, points: number, idempotencyKey: string): Promise<RedeemOutcome> {
    return this.deps.loyalty.transact(customerId, () => this.redeemInTransaction(customerId, orderId, points, idempotencyKey));
  }

  /**
   * Run `op` serialized against the customer's other ledger mutations. Order
   * cancellation uses this so the status flip and the point refund are atomic
   * relative to concurrent redemptions for the same customer.
   */
  inLedgerTransaction<T>(customerId: string, op: () => Promise<T>): Promise<T> {
    return this.deps.loyalty.transact(customerId, op);
  }

  /**
   * Return the points spent on a cancelled order to their original lots, with
   * the original expiry; points whose lot has expired by now are forfeited.
   * Must be called inside the owner's ledger transaction. Removing the records
   * first makes the refund idempotent — a repeated call refunds nothing.
   */
  async refundForOrder(orderId: string): Promise<void> {
    const records = await this.deps.redemptions.allForOrder(orderId);
    if (records.length === 0) return;
    for (const r of records) await this.deps.redemptions.remove(r.customerId, r.idempotencyKey);
    const customerId = records[0]!.customerId;
    const lotById = new Map((await this.deps.loyalty.lotsFor(customerId)).map(l => [l.id, l]));
    // Aggregate the per-lot debits across all of the order's redemptions.
    const owed = new Map<string, number>();
    for (const record of records) {
      const { refunds } = refundableConsumption(record.consumed, lotById, this.deps.now());
      for (const r of refunds) owed.set(r.lotId, (owed.get(r.lotId) ?? 0) + r.points);
    }
    for (const [lotId, points] of owed) {
      const lot = await this.deps.loyalty.getLot(lotId);
      if (!lot) continue; // vanished lot: nothing to return those points to
      await this.deps.loyalty.saveLot({ ...lot, points: lot.points + points });
    }
  }

  /** Transaction body of `redeem`: replay handling first, then a fresh redemption. */
  private async redeemInTransaction(customerId: string, orderId: string, points: number, idempotencyKey: string): Promise<RedeemOutcome> {
    const existing = await this.deps.redemptions.find(customerId, idempotencyKey);
    if (existing) return this.replayOutcome(existing, orderId, points);
    return this.redeemNew(customerId, orderId, points, idempotencyKey);
  }

  /** Same key + identical body → the stored result again; any other body → conflict. */
  private async replayOutcome(record: RedemptionRecord, orderId: string, points: number): Promise<RedeemOutcome> {
    if (!isSameRedemption(record, orderId, points))
      return { kind: "conflict", message: "idempotencyKey already used with a different request" };
    const order = this.deps.orders.get(record.orderId);
    if (!order) return { kind: "orderNotFound" };
    return { kind: "ok", quote: quoteForOrderWithPoints(order, record.pointsCents) };
  }

  private async redeemNew(customerId: string, orderId: string, points: number, idempotencyKey: string): Promise<RedeemOutcome> {
    const order = this.deps.orders.get(orderId);
    if (!order || order.customerId !== customerId) return { kind: "orderNotFound" };
    try { requirePending(order); } catch (e) {
      if (e instanceof OrderStateError) return { kind: "orderNotPending", message: e.message };
      throw e;
    }
    // 1 point = 1 cent, applied after discount and before tax: the discounted
    // subtotal minus points already redeemed on this order caps consumption,
    // so excess points are not consumed and the amount never goes below zero.
    const base = quoteForOrder(order);
    const previousCents = (await this.deps.redemptions.allForOrder(orderId)).reduce((sum, r) => sum + r.pointsCents, 0);
    const payableRemaining = base.subtotalCents - base.discountCents - previousCents;
    const targetPoints = Math.min(points, Math.max(payableRemaining, 0));
    const lots = await this.deps.loyalty.lotsFor(customerId);
    const { plan, consumedPoints } = planConsumption(lots, targetPoints, this.deps.now());
    await this.debitLots(plan);
    const record: RedemptionRecord = { idempotencyKey, customerId, orderId, pointsRequested: points, pointsCents: consumedPoints, consumed: plan };
    await this.deps.redemptions.save(record);
    return { kind: "ok", quote: quoteForOrderWithPoints(order, consumedPoints) };
  }

  /** Persist the planned debits; lots keep their original expiry untouched. */
  private async debitLots(plan: Consumption[]): Promise<void> {
    for (const entry of plan) {
      const lot = await this.deps.loyalty.getLot(entry.lotId);
      if (!lot) throw new Error("lot " + entry.lotId + " disappeared mid-transaction");
      await this.deps.loyalty.saveLot({ ...lot, points: lot.points - entry.points });
    }
  }
}
