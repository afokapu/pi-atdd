import { cancel, OrderNotFoundError, OrderStateError, type Order } from "../domain/order.ts";
import { planRestoration, type Allocation } from "../../loyalty/domain/points.ts";
import type { InMemoryLoyaltyStore } from "../../loyalty/integration/loyalty-store.ts";
import type { InMemoryRedemptionStore, RedemptionRecord } from "../../loyalty/integration/redemption-store.ts";
import type { LedgerDeps } from "./redeem-points.ts";

export type CancelOutcome = {
  order: Order;
  /** Points returned to their original lots (sum over restored allocations). */
  restoredPoints: number;
  /** Points whose lot had expired by reversal time (sum; discarded, never re-issued). */
  forfeitedPoints: number;
};

/**
 * Use case: cancel a pending order. Runs in the same per-customer lock as
 * redeem, so a concurrent redemption cannot interleave with the reversal. If
 * the order was paid partly with points, every redemption record of the order
 * is reversed exactly once: the recorded allocations go back to their original
 * lots, original expiry intact; points whose lot expired meanwhile are
 * forfeited — never rebuilt from current balances, never re-issued as fresh lots.
 */
export async function cancelOrder(deps: LedgerDeps, orderId: string, customerId: string): Promise<CancelOutcome> {
  return deps.locks.run(customerId, () => cancelExclusively(deps, orderId, customerId));
}

async function cancelExclusively(deps: LedgerDeps, orderId: string, customerId: string): Promise<CancelOutcome> {
  const order = deps.orders.get(orderId);
  if (!order || order.customerId !== customerId) throw new OrderNotFoundError(orderId);
  const cancelled = cancel(order); // domain rule: pending only — throws OrderStateError otherwise
  const reversals = await reverseRedemptions(deps, orderId);
  deps.orders.save(cancelled);
  return { order: cancelled, restoredPoints: reversals.restored, forfeitedPoints: reversals.forfeited };
}

/** Reverse every not-yet-reversed redemption of the order, exactly once each. */
async function reverseRedemptions(deps: LedgerDeps, orderId: string): Promise<{ restored: number; forfeited: number }> {
  const records = await deps.redemptions.forOrder(orderId);
  let restored = 0;
  let forfeited = 0;
  for (const record of records) {
    if (record.reversed) continue; // guard: a reversal applies once, even across repeated cancels
    const outcome = await restoreAllocations(deps, record);
    restored += outcome.restored;
    forfeited += outcome.forfeited;
  }
  return { restored, forfeited };
}

/** Restore the recorded allocations from `record`; the reversal decision uses the injected clock. */
async function restoreAllocations(deps: LedgerDeps, record: RedemptionRecord): Promise<{ restored: number; forfeited: number }> {
  const lots = await deps.loyalty.lotsFor(record.customerId);
  const { restored, forfeited } = planRestoration(record.allocations, lots, deps.now());
  const byId = new Map(lots.map(l => [l.id, l]));
  for (const a of restored) {
    const lot = byId.get(a.lotId)!; // allocations always reference existing lots of this customer
    await deps.loyalty.saveLot({ ...lot, points: lot.points + a.points });
  }
  record.reversed = true;
  await deps.redemptions.save(record);
  return { restored: sumPoints(restored), forfeited: sumPoints(forfeited) };
}

const sumPoints = (allocations: Allocation[]): number => allocations.reduce((sum, a) => sum + a.points, 0);
