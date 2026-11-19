import {
  applicablePoints,
  planConsumption,
  spendablePoints,
  type Allocation,
  type PointsLot,
} from "../../loyalty/domain/points.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import type { InMemoryRedemptionStore } from "../../loyalty/integration/redemption-store.ts";
import { quoteForOrder, quoteForOrderWithPoints } from "../../pricing/application/quote-service.ts";
import type { QuoteWithPoints } from "../../pricing/domain/quote.ts";
import { OrderNotFoundError, OrderStateError, type Order } from "../domain/order.ts";
import { PerKeyLock } from "./per-key-lock.ts";

/** The customer does not hold enough spendable (non-expired) points. */
export class InsufficientPointsError extends Error {}

/** The idempotency key was already used with a different payload. */
export class IdempotencyConflictError extends Error {}

/**
 * Collaborators shared by the order use cases that move loyalty points.
 * Constructed once in the composition root (`src/app.ts`) and shared by the
 * redeem and cancel flows, so both serialise on the same per-customer locks.
 */
export type LedgerDeps = {
  orders: InMemoryOrderStore;
  loyalty: InMemoryLoyaltyStore;
  redemptions: InMemoryRedemptionStore;
  locks: PerKeyLock;
  /** Current time — decides lot expiry at consumption and at reversal. */
  now: () => Date;
};

export type RedeemCommand = {
  orderId: string;
  customerId: string;
  points: number;
  idempotencyKey: string;
};

/** Replay scope: keys are never compared across customers or orders. */
const replayScope = (cmd: RedeemCommand): string => cmd.customerId + ":" + cmd.orderId;

/** Fingerprint of the normalised payload — the body minus the key itself. */
const fingerprint = (points: number): string => JSON.stringify({ points });

/**
 * Use case: pay part of a pending order with loyalty points.
 *
 * Money order (integer cents): subtotal → discount → points = taxable base;
 * tax is computed once on that reduced base. Requested points are capped to the
 * discounted amount first (`applicablePoints`), so excess points stay in the lots.
 *
 * The whole read-decide-write runs inside the customer's lock: two concurrent
 * redemptions for one customer can never draw the same lot twice, because the
 * second sees the first's writes. A matching retry replays the stored result
 * without consuming anything; a different payload under a used key is rejected.
 */
export async function redeemForOrder(deps: LedgerDeps, cmd: RedeemCommand): Promise<QuoteWithPoints> {
  return deps.locks.run(cmd.customerId, () => redeemExclusively(deps, cmd));
}

async function redeemExclusively(deps: LedgerDeps, cmd: RedeemCommand): Promise<QuoteWithPoints> {
  // Preconditions re-checked inside the critical section, exactly as for a first request.
  const order = deps.orders.get(cmd.orderId);
  if (!order || order.customerId !== cmd.customerId) throw new OrderNotFoundError(cmd.orderId);
  if (order.status !== "pending") throw new OrderStateError("order " + order.id + " is " + order.status);
  const replay = await replayIfKnown(deps, cmd);
  if (replay) return replay;
  const { applied, allocations, lots } = await consumptionPlan(deps, order, cmd.points);
  await drawLots(deps, lots, allocations);
  const result = quoteForOrderWithPoints(order, applied);
  await claimRecord(deps, cmd, applied, allocations, result);
  return result;
}

/** Replay path: same key + same payload → the stored original result, verbatim. */
async function replayIfKnown(deps: LedgerDeps, cmd: RedeemCommand): Promise<QuoteWithPoints | undefined> {
  const existing = await deps.redemptions.find(replayScope(cmd), cmd.idempotencyKey);
  if (!existing) return undefined;
  if (existing.fingerprint !== fingerprint(cmd.points))
    throw new IdempotencyConflictError("idempotency key was already used with a different payload");
  return existing.response.body;
}

/**
 * Decide how much to apply and which lots to draw. Points reduce after discount,
 * before tax; more than the discounted amount is never applied; the customer
 * must hold enough spendable (non-expired) points for what will be consumed.
 */
async function consumptionPlan(deps: LedgerDeps, order: Order, requestedPoints: number)
  : Promise<{ applied: number; allocations: Allocation[]; lots: PointsLot[] }> {
  const base = quoteForOrder(order);
  const lots = await deps.loyalty.lotsFor(order.customerId);
  const at = deps.now();
  const applied = applicablePoints(requestedPoints, base.subtotalCents - base.discountCents);
  const available = spendablePoints(lots, at);
  if (applied > available) throw new InsufficientPointsError("needs " + applied + " points, customer has " + available + " spendable");
  return { applied, allocations: planConsumption(lots, applied, at), lots };
}

/** Persist the planned draws lot by lot; runs inside the customer's lock. */
async function drawLots(deps: LedgerDeps, lots: PointsLot[], allocations: Allocation[]): Promise<void> {
  const byId = new Map(lots.map(l => [l.id, l]));
  for (const a of allocations) {
    const lot = byId.get(a.lotId)!; // allocation came from this snapshot, under the lock
    await deps.loyalty.saveLot({ ...lot, points: lot.points - a.points });
  }
}

/**
 * Store the replay record with the full original result. The key is claimed
 * here, inside the same critical section as the draw, so a concurrent duplicate
 * can never also run. `recordIfAbsent` mirrors the ledger's unique constraint;
 * while the customer's lock is held a conflict is impossible, so a `false` here
 * signals a broken invariant rather than a recoverable race.
 */
async function claimRecord(deps: LedgerDeps, cmd: RedeemCommand, applied: number, allocations: Allocation[], result: QuoteWithPoints): Promise<void> {
  const claimed = await deps.redemptions.recordIfAbsent({
    scope: replayScope(cmd),
    idempotencyKey: cmd.idempotencyKey,
    fingerprint: fingerprint(cmd.points),
    orderId: cmd.orderId,
    customerId: cmd.customerId,
    pointsApplied: applied,
    allocations,
    response: { status: 200, body: result },
    reversed: false,
  });
  if (!claimed) throw new IdempotencyConflictError("idempotency key already used");
}
