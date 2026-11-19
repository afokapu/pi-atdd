import { planReversal, type PointAllocation } from "../domain/points.ts";
import type { InMemoryLoyaltyStore } from "../integration/loyalty-store.ts";
import type { InMemoryRedemptionStore } from "../integration/redemption-store.ts";

export type ReleaseDeps = {
  loyalty: InMemoryLoyaltyStore;
  redemptions: InMemoryRedemptionStore;
  now: () => Date;
};

export type ReversalResult = { restored: PointAllocation[]; forfeited: PointAllocation[] };

/**
 * Reverse every held redemption of an order: points go back to the exact lots
 * they were drawn from (the lots keep their original expiry); points whose lot
 * has expired by `now` are forfeited. Each held record applies exactly once —
 * its status is checked and flipped to "reversed" inside the same critical
 * section as the restores, so callers must hold the customer's lock (as
 * cancelOrder does).
 */
export async function releaseOrderRedemptions(deps: ReleaseDeps, orderId: string): Promise<ReversalResult> {
  const result: ReversalResult = { restored: [], forfeited: [] };
  for (const record of await deps.redemptions.forOrder(orderId)) {
    if (record.status !== "held") continue; // already reversed: apply once
    const lots = await deps.loyalty.lotsFor(record.customerId);
    const plan = planReversal(lots, record.allocations, deps.now());
    for (const draw of plan.restored) {
      const lot = lots.find(l => l.id === draw.lotId)!; // planReversal only restores existing lots
      await deps.loyalty.saveLot({ ...lot, points: lot.points + draw.points });
    }
    await deps.redemptions.save({ ...record, status: "reversed" });
    result.restored.push(...plan.restored);
    result.forfeited.push(...plan.forfeited);
  }
  return result;
}
