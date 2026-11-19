import { centsToPoints, isExpiredAt, planRedemption, pointsToCents } from "../../loyalty/domain/points.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import { OrderStateError } from "../domain/order.ts";
import { subtotal, taxOn } from "../../pricing/domain/quote.ts";
import { discountCents } from "../../pricing/domain/discount.ts";
import { getTaxRate } from "../../pricing/integration/tax-rates.ts";
import type { Customer } from "../../http/auth.ts";
import { CustomerLocks } from "./customer-lock.ts";

/** Result of a redemption: the order's new quote, all amounts in integer cents. */
export type RedeemQuote = {
  region: string;
  subtotalCents: number;
  discountCents: number;
  /** Points consumed (1 point = 1 cent; 100 points = 1 EUR). */
  pointsApplied: number;
  /** Value of the consumed points in cents (same number as pointsApplied). */
  pointsCents: number;
  taxCents: number;
  totalCents: number;
};

export type RedeemCommand = { points: number; idempotencyKey: string };

export class OrderNotFoundError extends Error {}
/** Same idempotency key reused with a different request body. */
export class IdempotencyConflictError extends Error {}

export type RedeemDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  locks: CustomerLocks;
  now: () => Date;
};

/**
 * Use case: pay part of a pending order with loyalty points.
 *
 * All state transitions (lot consumption, ledger write) run inside the
 * customer's lock, so concurrent redemptions of one customer observe each
 * other's writes and never spend the same points.
 */
export class RedeemService {
  private deps: RedeemDeps;
  constructor(deps: RedeemDeps) { this.deps = deps; }

  /** Serialize any per-customer sequence (used by redeem and cancel-refund). */
  runExclusive<T>(customerId: string, fn: () => Promise<T>): Promise<T> {
    return this.deps.locks.runExclusive(customerId, fn);
  }

  async redeem(customer: Customer, orderId: string, cmd: RedeemCommand): Promise<RedeemQuote> {
    return this.runExclusive(customer.id, async () => {
      const order = this.deps.orders.get(orderId);
      if (!order || order.customerId !== customer.id) throw new OrderNotFoundError("order not found");

      // Idempotent replay: same key + same body → same result, nothing consumed.
      const existing = await this.deps.loyalty.findRedemption(customer.id, cmd.idempotencyKey);
      if (existing) {
        if (existing.orderId !== orderId || existing.pointsRequested !== cmd.points)
          throw new IdempotencyConflictError("idempotencyKey was already used with a different request");
        return this.quoteFor(order, existing.pointsRedeemed);
      }

      if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);

      const at = this.deps.now();
      const subtotalCents = subtotal(order.lines);
      const discount = discountCents(subtotalCents, order.discountCode);
      // Points reduce the amount after discounts, before tax; never below zero.
      const payableCents = Math.max(0, subtotalCents - discount);
      const wanted = Math.min(cmd.points, centsToPoints(payableCents)); // excess points are not consumed

      const lots = await this.deps.loyalty.lotsFor(customer.id);
      // Consume non-expired lots, earliest expiry first; stops at the balance.
      const plan = planRedemption(lots, wanted, at);
      for (const t of plan.taken) {
        const lot = lots.find(l => l.id === t.lotId)!;
        await this.deps.loyalty.saveLot({ ...lot, points: lot.points - t.points });
      }

      await this.deps.loyalty.saveRedemption({
        customerId: customer.id,
        orderId: order.id,
        idempotencyKey: cmd.idempotencyKey,
        pointsRequested: cmd.points,
        pointsRedeemed: plan.points,
        cents: pointsToCents(plan.points),
        taken: plan.taken,
        createdAt: at,
      });
      return this.quoteFor(order, plan.points);
    });
  }

  /**
   * Return redeemed points to their original lots, with their original
   * expiry. Points from lots that have expired by `at` are forfeited.
   */
  async refundOrder(order: { id: string; customerId: string }, at: Date = this.deps.now()): Promise<{ refundedPoints: number; forfeitedPoints: number }> {
    const redemptions = await this.deps.loyalty.redemptionsForOrder(order.id);
    let refundedPoints = 0, forfeitedPoints = 0;
    for (const r of redemptions) {
      for (const t of r.taken) {
        const lot = await this.deps.loyalty.getLot(t.lotId);
        const expiry = lot?.expiresAt ?? t.expiresAt;
        if (isExpiredAt(expiry, at)) { forfeitedPoints += t.points; continue; }
        if (lot) await this.deps.loyalty.saveLot({ ...lot, points: lot.points + t.points });
        else await this.deps.loyalty.saveLot({ id: t.lotId, customerId: order.customerId, points: t.points, expiresAt: new Date(t.expiresAt.getTime()) });
        refundedPoints += t.points;
      }
    }
    return { refundedPoints, forfeitedPoints };
  }

  /** New quote for the order with `pointsApplied` deducted before tax. */
  private quoteFor(order: { lines: { sku: string; unitPriceCents: number; quantity: number }[]; region: string; discountCode?: string }, pointsApplied: number): RedeemQuote {
    const subtotalCents = subtotal(order.lines);
    const discount = discountCents(subtotalCents, order.discountCode);
    const pointsCents = pointsToCents(pointsApplied);
    const taxableCents = Math.max(0, subtotalCents - discount - pointsCents);
    const taxCents = taxOn(taxableCents, getTaxRate(order.region));
    return {
      region: order.region,
      subtotalCents,
      discountCents: discount,
      pointsApplied,
      pointsCents,
      taxCents,
      totalCents: subtotalCents - discount - pointsCents + taxCents,
    };
  }
}
