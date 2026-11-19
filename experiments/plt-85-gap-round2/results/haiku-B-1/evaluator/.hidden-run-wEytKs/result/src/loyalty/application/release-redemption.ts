import type { InMemoryLoyaltyStore } from "../integration/loyalty-store.ts";
import { isExpired } from "../domain/points.ts";

/**
 * Use case: return the points a cancelled order redeemed to the lots they came from,
 * with their original expiry. A lot that has expired by `at` forfeits its share.
 * Must run under the customer lock.
 */
export async function releaseRedemption(loyalty: InMemoryLoyaltyStore, orderId: string, at: Date): Promise<void> {
  const redemption = await loyalty.redemptionForOrder(orderId);
  if (!redemption || redemption.status !== "held") return;
  for (const allocation of redemption.allocations) {
    const lot = await loyalty.getLot(allocation.lotId);
    if (!lot || isExpired(lot, at)) continue;
    await loyalty.saveLot({ ...lot, points: lot.points + allocation.points });
  }
  await loyalty.saveRedemption({ ...redemption, status: "released" });
}
