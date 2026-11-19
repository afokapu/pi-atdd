/**
 * Use case: pay (part of) a pending order with loyalty points.
 *
 * The whole operation — idempotency check, order state change and ledger
 * consumption — runs inside the loyalty ledger's per-customer critical
 * section. The read-decide-write cycle over the customer's points lots must
 * never interleave with a concurrent redemption or cancellation, or two
 * requests could spend the same points.
 */
import { quoteForOrder, quoteForOrderWithPoints } from "../../pricing/application/quote-service.ts";
import type { PointsQuote } from "../../pricing/domain/quote.ts";
import {
  consumablePoints,
  planConsumption,
  type Allocation,
  type ConsumptionPlan,
} from "../../loyalty/domain/points.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import { assertRedeemable, redeem, type Order, type Redemption } from "../domain/order.ts";
import type { InMemoryOrderStore } from "../integration/order-store.ts";
import type { IdempotencyRecord, InMemoryIdempotencyStore, StoredResponse } from "../integration/idempotency-store.ts";

export type PointPaymentDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  idempotency: InMemoryIdempotencyStore;
  /** Clock used for lot expiry decisions. */
  now: () => Date;
};

export type RedeemInput = { points: number; idempotencyKey: string };

/** Body of a successful redemption: the new quote, in integer cents. */
export type RedeemQuote = {
  subtotalCents: number;
  discountCents: number;
  pointsCents: number;
  taxCents: number;
  totalCents: number;
};

type RedeemResponse = StoredResponse;

/** Fingerprint of the normalised redeem body; only the points matter. */
function fingerprint(points: number): string {
  return JSON.stringify({ points });
}

/** Project the priced quote down to the response fields, in integer cents. */
function quoteBody(q: PointsQuote): RedeemQuote {
  return {
    subtotalCents: q.subtotalCents,
    discountCents: q.discountCents,
    pointsCents: q.pointsCents,
    taxCents: q.taxCents,
    totalCents: q.totalCents,
  };
}

/**
 * Same key → same result: the stored original response is replayed verbatim.
 * Same key with a different body → 409, nothing is re-executed.
 */
function replayOrReject(recorded: IdempotencyRecord, fp: string): RedeemResponse {
  if (recorded.fingerprint !== fp)
    return { status: 409, body: { error: "idempotency key already used with a different request body" } };
  return recorded.response;
}

/**
 * Draw the points for one redemption from the ledger. Must be called inside
 * the customer's critical section, so the lots read here cannot change under
 * us. The request is capped at the cents the order still owes, so surplus
 * points stay unconsumed.
 */
async function consumeForOrder(deps: PointPaymentDeps, order: Order, requestedPoints: number): Promise<ConsumptionPlan> {
  const base = quoteForOrder(order);
  const amountDueCents = base.subtotalCents - base.discountCents;
  const lots = await deps.loyalty.lotsFor(order.customerId);
  const plan = planConsumption(lots, consumablePoints(requestedPoints, amountDueCents), deps.now());
  for (const a of plan.allocations) {
    const lot = await deps.loyalty.getLot(a.lotId);
    if (!lot) throw new Error("lot " + a.lotId + " vanished during redemption");
    await deps.loyalty.saveLot({ ...lot, points: lot.points - a.points });
  }
  return plan;
}

/**
 * Redeem `input.points` against pending order `orderId` for its owner.
 * Returns the new quote (subtotal, discount, points, tax, total in cents).
 * Eligibility is checked before the ledger is touched, so a rejected
 * redemption never consumes points; a recorded key replays its stored
 * response without consuming anything more.
 */
export async function redeemOrderPoints(
  deps: PointPaymentDeps,
  orderId: string,
  customerId: string,
  input: RedeemInput,
): Promise<RedeemResponse> {
  const fp = fingerprint(input.points);
  return deps.loyalty.runExclusive(customerId, async () => {
    const order = deps.orders.get(orderId);
    if (!order || order.customerId !== customerId) return { status: 404, body: { error: "order not found" } };
    // Authorisation happened above; only now may a recorded key be replayed.
    const recorded = deps.idempotency.find(orderId, input.idempotencyKey);
    if (recorded) return replayOrReject(recorded, fp);
    assertRedeemable(order);
    const plan = await consumeForOrder(deps, order, input.points);
    // A redemption that consumed nothing (no usable points) leaves the order
    // untouched — there is nothing to reverse on cancellation.
    const updated = plan.totalPoints > 0
      ? redeem(order, { points: plan.totalPoints, allocations: plan.allocations })
      : order;
    const priced = quoteForOrderWithPoints(order, plan.totalPoints);
    deps.orders.save(updated);
    const response: RedeemResponse = { status: 200, body: quoteBody(priced) };
    // Recorded in the same critical section as the side effect, so a retry
    // can never slip past the claim and consume twice.
    deps.idempotency.save(orderId, input.idempotencyKey, { fingerprint: fp, response });
    return response;
  });
}

/**
 * Apply restorations to the ledger. Must be called inside the customer's
 * critical section; expiry stays untouched so points keep their original lot.
 */
export async function applyRestoration(loyalty: InMemoryLoyaltyStore, restorations: Allocation[]): Promise<void> {
  for (const r of restorations) {
    const lot = await loyalty.getLot(r.lotId);
    if (!lot) throw new Error("lot " + r.lotId + " vanished during restoration");
    await loyalty.saveLot({ ...lot, points: lot.points + r.points });
  }
}
