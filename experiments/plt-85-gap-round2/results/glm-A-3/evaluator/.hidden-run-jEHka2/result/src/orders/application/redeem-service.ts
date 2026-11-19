import { applyRedemption, type Order } from "../domain/order.ts";
import { availablePoints, planConsumption, planRefund } from "../../loyalty/domain/redeem.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import type { QuoteWithPoints } from "../../pricing/domain/quote.ts";

export type RedeemCommand = {
  customerId: string;
  orderId: string;
  /** Points the customer wants to spend (1 point = 1 cent). */
  points: number;
  idempotencyKey: string;
  /** Amount in cents that points can reduce for this order: subtotal minus discount. */
  maxRedeemableCents: number;
  /** Quote the whole order with `totalPoints` applied (only invoked for a fresh redemption). */
  quoteFor: (totalPoints: number) => QuoteWithPoints;
};

export type RedeemOutcome =
  | { kind: "ok"; quote: QuoteWithPoints }
  | { kind: "conflict"; error: string }
  | { kind: "notFound" };

type RedemptionRecord = { orderId: string; points: number; quote: QuoteWithPoints };

/**
 * Use case: pay (part of) a pending order with loyalty points.
 *
 * All state changes run inside a per-customer critical section, so concurrent
 * redemptions of one customer never spend the same points twice even though
 * the ledger store is asynchronous. Idempotency records make a replayed
 * request return the original quote without consuming anything more; the same
 * key with a different request is rejected.
 */
export class RedeemService {
  private records = new Map<string, RedemptionRecord>();
  private locks = new Map<string, Promise<unknown>>();
  private orders: InMemoryOrderStore;
  private loyalty: InMemoryLoyaltyStore;
  private now: () => Date;

  constructor(orders: InMemoryOrderStore, loyalty: InMemoryLoyaltyStore, now: () => Date = () => new Date()) {
    this.orders = orders;
    this.loyalty = loyalty;
    this.now = now;
  }

  /**
   * Serialize work per customer: each closure runs only after every previous
   * one for the same customer has settled (regardless of success/failure).
   */
  runExclusive<T>(customerId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(customerId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const settled: Promise<unknown> = next.catch(() => {});
    this.locks.set(customerId, settled);
    void settled.then(() => {
      if (this.locks.get(customerId) === settled) this.locks.delete(customerId);
    });
    return next;
  }

  /** Redeem points for a pending order. Safe to call concurrently. */
  redeem(cmd: RedeemCommand): Promise<RedeemOutcome> {
    return this.runExclusive(cmd.customerId, () => this.redeemLocked(cmd));
  }

  private async redeemLocked(cmd: RedeemCommand): Promise<RedeemOutcome> {
    // Re-read inside the critical section: earlier requests may have changed the order.
    const order = this.orders.get(cmd.orderId);
    if (!order || order.customerId !== cmd.customerId) return { kind: "notFound" };

    const recordKey = cmd.customerId + "\u0000" + cmd.idempotencyKey;
    const existing = this.records.get(recordKey);
    if (existing) {
      if (existing.orderId !== cmd.orderId || existing.points !== cmd.points)
        return { kind: "conflict", error: "idempotency key was already used with a different request" };
      return { kind: "ok", quote: existing.quote };
    }
    if (order.status !== "pending") return { kind: "conflict", error: "order " + order.id + " is " + order.status };

    const at = this.now();
    const lots = await this.loyalty.lotsFor(cmd.customerId);
    const alreadyApplied = order.redemption?.points ?? 0;
    const reducibleCents = Math.max(0, cmd.maxRedeemableCents - alreadyApplied);
    // 100 points = 1 EUR = 100 cents, so points and cents are numerically equal.
    // Points beyond the reducible amount or the balance are not consumed.
    const applied = Math.max(0, Math.min(cmd.points, reducibleCents, availablePoints(lots, at)));

    const plan = planConsumption(lots, applied, at);
    for (const use of plan) {
      const lot = await this.loyalty.getLot(use.lotId);
      if (!lot) continue; // lot vanished mid-plan: cannot happen with the in-memory store
      await this.loyalty.saveLot({ ...lot, points: lot.points - use.points });
    }

    const updated = applyRedemption(order, applied, plan);
    this.orders.save(updated);
    const quote = cmd.quoteFor(updated.redemption?.points ?? alreadyApplied + applied);
    this.records.set(recordKey, { orderId: cmd.orderId, points: cmd.points, quote });
    return { kind: "ok", quote };
  }

  /**
   * Return the points a cancelled order consumed to their original lots with
   * their original expiry; points from lots that expired in the meantime are
   * forfeited. Must be called while holding the customer's lock (the cancel
   * flow wraps its whole read-modify-write in `runExclusive`).
   */
  async refundRedemption(order: Order): Promise<void> {
    const redeemed = order.redemption;
    if (!redeemed || redeemed.lots.length === 0) return;
    const at = this.now();
    const lots = await this.loyalty.lotsFor(order.customerId);
    const { refunds } = planRefund(redeemed.lots, lots, at);
    for (const use of refunds) {
      const lot = await this.loyalty.getLot(use.lotId);
      if (!lot) continue; // lot deleted: forfeited
      await this.loyalty.saveLot({ ...lot, points: lot.points + use.points });
    }
  }
}
