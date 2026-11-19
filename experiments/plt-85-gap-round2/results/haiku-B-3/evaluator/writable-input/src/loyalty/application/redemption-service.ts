import type { Order } from "../../orders/domain/order.ts";
import { quoteForOrderWithPoints } from "../../pricing/application/quote-service.ts";
import type { RedeemQuote } from "../../pricing/domain/quote.ts";
import { centsForPoints, pointsForCents, returnPoints, spendablePoints, spendPoints } from "../domain/points.ts";
import type { InMemoryLoyaltyStore } from "../integration/loyalty-store.ts";

/**
 * Use cases for paying an order partly with loyalty points. Callers must hold the
 * customer's lock (see ledger-lock.ts) for the whole call, otherwise two redemptions
 * could spend the same lot.
 */
export type LoyaltyDeps = { loyalty: InMemoryLoyaltyStore; now: () => Date };

export type RedeemErrorCode = "IDEMPOTENCY_KEY_REUSED" | "ORDER_NOT_PENDING" | "ORDER_ALREADY_REDEEMED";
export type RedeemOutcome = { ok: true; quote: RedeemQuote } | { ok: false; errorCode: RedeemErrorCode };
export type RedeemInput = { customerId: string; order: Order; points: number; idempotencyKey: string };

/**
 * Pay part of a pending order with points. A repeated idempotency key replays the first
 * result and consumes nothing; reusing the key for a different request is rejected.
 */
export async function redeemPoints(deps: LoyaltyDeps, input: RedeemInput): Promise<RedeemOutcome> {
  const fingerprint = JSON.stringify({ orderId: input.order.id, points: input.points });
  const previous = await deps.loyalty.redemptionByKey(input.customerId, input.idempotencyKey);
  if (previous) {
    return previous.requestFingerprint === fingerprint
      ? { ok: true, quote: previous.quote }
      : { ok: false, errorCode: "IDEMPOTENCY_KEY_REUSED" };
  }
  if (input.order.status !== "pending") return { ok: false, errorCode: "ORDER_NOT_PENDING" };
  // One redemption per order: a second one would have to be reconciled with the first.
  if (await deps.loyalty.activeRedemptionForOrder(input.order.id)) return { ok: false, errorCode: "ORDER_ALREADY_REDEEMED" };
  return applyRedemption(deps, input, fingerprint);
}

async function applyRedemption(deps: LoyaltyDeps, input: RedeemInput, fingerprint: string): Promise<RedeemOutcome> {
  const at = deps.now();
  const lots = await deps.loyalty.lotsFor(input.customerId);
  // Ask for no more than is spendable; the quote then caps it at the discounted amount.
  const requestedCents = centsForPoints(Math.min(input.points, spendablePoints(lots, at)));
  const quote = quoteForOrderWithPoints(input.order, requestedCents);
  const allocations = spendPoints(lots, pointsForCents(quote.pointsAppliedCents), at);
  for (const a of allocations) {
    const lot = lots.find(l => l.id === a.lotId)!;
    await deps.loyalty.saveLot({ ...lot, points: lot.points - a.points });
  }
  await deps.loyalty.saveRedemption({
    id: crypto.randomUUID(), customerId: input.customerId, orderId: input.order.id,
    idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint,
    status: "applied", allocations, quote,
  });
  return { ok: true, quote };
}

/**
 * Undo the redemption on a cancelled order. Each spent slice goes back to its original lot
 * with the original expiry; slices whose lot has expired by now are forfeited.
 */
export async function reverseRedemption(deps: LoyaltyDeps, orderId: string): Promise<void> {
  const redemption = await deps.loyalty.activeRedemptionForOrder(orderId);
  if (!redemption) return;
  const at = deps.now();
  for (const allocation of redemption.allocations) {
    const lot = await deps.loyalty.getLot(allocation.lotId);
    if (!lot) throw new Error("ledger has no lot " + allocation.lotId);
    const restored = returnPoints(lot, allocation, at);
    if (restored) await deps.loyalty.saveLot(restored);
  }
  await deps.loyalty.saveRedemption({ ...redemption, status: "reversed" });
}
