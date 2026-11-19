import type { Order } from "../../orders/domain/order.ts";
import { quoteForOrderWithPoints } from "../../pricing/application/quote-service.ts";
import { discountedSubtotal } from "../../pricing/domain/discount.ts";
import { subtotal } from "../../pricing/domain/quote.ts";
import { allocationTotal, planConsumption, type PointAllocation, type PointsLot } from "../domain/points.ts";
import { redemptionFingerprint, type Redemption } from "../domain/redemption.ts";
import type { InMemoryLoyaltyStore } from "../integration/loyalty-store.ts";
import type { InMemoryRedemptionStore } from "../integration/redemption-store.ts";
import { customerLockKey, type OwnerLocks } from "./owner-locks.ts";

export type RedeemDeps = {
  orders: { get(id: string): Order | undefined };
  loyalty: InMemoryLoyaltyStore;
  redemptions: InMemoryRedemptionStore;
  locks: OwnerLocks;
  now: () => Date;
};

export type RedeemCommand = {
  orderId: string;
  customerId: string;
  points: number;
  idempotencyKey: string;
};

/**
 * Use case: pay part of a pending order with loyalty points. The whole
 * redemption (idempotency check, lot consumption, ledger record) runs as one
 * critical section per customer, so concurrent redemptions of one customer
 * serialise and can never spend the same points twice.
 */
export function redeemPoints(deps: RedeemDeps, cmd: RedeemCommand) {
  return deps.locks.run(customerLockKey(cmd.customerId), () => redeemInSection(deps, cmd));
}

/** Critical section body; requires the caller to hold the customer's lock. */
async function redeemInSection(deps: RedeemDeps, cmd: RedeemCommand) {
  // Authorise exactly as a first request would, before touching any stored state.
  const order = deps.orders.get(cmd.orderId);
  if (!order || order.customerId !== cmd.customerId) return { status: 404, body: { error: "order not found" } };
  const existing = await deps.redemptions.findByKey(cmd.customerId, cmd.idempotencyKey);
  if (existing) return replayOrReject(existing, redemptionFingerprint(cmd));
  if (order.status !== "pending") return { status: 409, body: { error: `order ${order.id} is ${order.status}` } };

  const at = deps.now();
  const cap = await remainingPayableCents(deps, order);
  const want = Math.min(cmd.points, Math.max(0, cap));
  const lots = await deps.loyalty.lotsFor(cmd.customerId);
  const allocations = want > 0 ? planConsumption(lots, want, at) : [];
  const appliedPoints = allocationTotal(allocations);
  await persistConsumption(deps, lots, allocations);
  const response = { status: 200, body: quoteForOrderWithPoints(order, appliedPoints) };
  return claimAndReturn(deps, cmd, appliedPoints, allocations, response);
}

/**
 * Same key + same payload: replay the stored original response verbatim,
 * whatever has since happened to the order, and consume nothing more. Same
 * key + different payload: reject, changing nothing.
 */
function replayOrReject(existing: Redemption, fingerprint: string) {
  if (existing.fingerprint === fingerprint) return existing.response;
  return { status: 409, body: { error: "idempotency key already used with a different payload" } };
}

/**
 * Cents still payable with points: the subtotal after discount, minus what
 * this order's held redemptions have already applied. Keeps the order total
 * from ever dropping below zero across multiple partial redemptions.
 */
async function remainingPayableCents(deps: RedeemDeps, order: Order): Promise<number> {
  const payable = discountedSubtotal(subtotal(order.lines), order.discountCode);
  const held = await deps.redemptions.forOrder(order.id);
  const applied = held.filter(r => r.status === "held").reduce((sum, r) => sum + r.appliedCents, 0);
  return payable - applied;
}

/**
 * Decrement every drawn lot in the ledger. Lots are never deleted: a lot
 * emptied here stays at zero, so a later reversal can restore points to the
 * same lot id with its original expiry.
 */
async function persistConsumption(deps: RedeemDeps, lots: PointsLot[], allocations: PointAllocation[]): Promise<void> {
  const byId = new Map(lots.map(l => [l.id, l]));
  for (const a of allocations) {
    const lot = byId.get(a.lotId)!; // allocations reference lots from this read
    await deps.loyalty.saveLot({ ...lot, points: lot.points - a.points });
  }
}

/** Claim the idempotency key inside the critical section and return the result. */
async function claimAndReturn(deps: RedeemDeps, cmd: RedeemCommand, appliedPoints: number, allocations: PointAllocation[], response: { status: number; body: unknown }) {
  const record: Redemption = {
    customerId: cmd.customerId,
    orderId: cmd.orderId,
    idempotencyKey: cmd.idempotencyKey,
    fingerprint: redemptionFingerprint(cmd),
    appliedCents: appliedPoints,
    allocations,
    response,
    status: "held",
  };
  if (await deps.redemptions.claim(record)) return response;
  // Unreachable under the per-customer lock; replay a concurrent twin's stored result.
  const twin = await deps.redemptions.findByKey(cmd.customerId, cmd.idempotencyKey);
  return twin ? twin.response : response;
}
