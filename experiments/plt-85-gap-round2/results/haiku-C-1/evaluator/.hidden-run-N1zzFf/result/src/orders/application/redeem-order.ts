import type { Order, OrderBook } from "../domain/order.ts";
import { subtotal, type PricedQuote } from "../../pricing/domain/quote.ts";
import { discountedSubtotal } from "../../pricing/domain/discount.ts";
import { quoteOrderWithPoints } from "../../pricing/application/quote-service.ts";
import {
  allocatePoints, applicablePointsCents, centsToPoints, debit, redemptionFingerprint, type Redemption,
} from "../../loyalty/domain/redemption.ts";
import type { LoyaltyLedger } from "../../loyalty/application/ledger-port.ts";

/**
 * Use case LOY-002: pay part of a pending order with loyalty points.
 *
 * Runs under the customer's lock, so two redemptions for one customer cannot spend the same
 * points. Adjustment order: subtotal, discount, points (capped at the discounted amount), tax.
 * A repeated idempotency key replays the stored quote if the body matches and is rejected
 * otherwise; nothing is consumed on a replay.
 */
export type RedeemRequest = { points: number; idempotencyKey: string };
export type RedeemDeps = { orders: OrderBook; loyalty: LoyaltyLedger; now: () => Date };

export type RedeemOutcome =
  | { kind: "not-found" }
  | { kind: "not-pending" }
  | { kind: "already-redeemed" }
  | { kind: "key-reused" }
  | { kind: "redeemed"; quote: PricedQuote; replayed: boolean };

export function redeemOrder(
  deps: RedeemDeps, customerId: string, orderId: string, req: RedeemRequest,
): Promise<RedeemOutcome> {
  return deps.loyalty.withCustomerLock(customerId, async (): Promise<RedeemOutcome> => {
    const order = deps.orders.get(orderId);
    if (!order || order.customerId !== customerId) return { kind: "not-found" };
    const fingerprint = redemptionFingerprint(orderId, req.points);
    const earlier = await deps.loyalty.redemptionByKey<PricedQuote>(customerId, req.idempotencyKey);
    if (earlier) return replay(earlier, fingerprint);
    if (order.status !== "pending") return { kind: "not-pending" };
    if (await deps.loyalty.redemptionForOrder(orderId)) return { kind: "already-redeemed" };
    return applyRedemption(deps, order, req, fingerprint);
  });
}

/** Same key and same body: the stored quote, verbatim. Same key, other body: rejected. */
function replay(earlier: Redemption<PricedQuote>, fingerprint: string): RedeemOutcome {
  return earlier.fingerprint === fingerprint
    ? { kind: "redeemed", quote: earlier.quote, replayed: true }
    : { kind: "key-reused" };
}

async function applyRedemption(
  deps: RedeemDeps, order: Order, req: RedeemRequest, fingerprint: string,
): Promise<RedeemOutcome> {
  const usable = await deps.loyalty.usableLotsFor(order.customerId, deps.now());
  const payable = discountedSubtotal(subtotal(order.lines), order.discountCode);
  const appliedCents = applicablePointsCents(req.points, payable, usable);
  const allocations = allocatePoints(usable, centsToPoints(appliedCents));
  for (const lot of debit(usable, allocations)) await deps.loyalty.saveLot(lot);
  const quote = quoteOrderWithPoints(order, appliedCents);
  await deps.loyalty.saveRedemption({
    customerId: order.customerId, orderId: order.id, idempotencyKey: req.idempotencyKey,
    fingerprint, allocations, quote, reversed: false,
  });
  return { kind: "redeemed", quote, replayed: false };
}
