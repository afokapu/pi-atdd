import type { InMemoryLoyaltyStore } from "../integration/loyalty-store.ts";
import type { PointsAllocation } from "../domain/points.ts";

/**
 * Serialises ledger work per customer. The loyalty store is asynchronous, so a
 * read-then-write of a customer's lots can interleave with another request for the
 * same customer and spend the same points twice. Each customer's tasks run one after
 * another; different customers do not wait for each other. This is process-local, which
 * is sufficient for this single-process service.
 */
const tails = new Map<string, Promise<unknown>>();

export function withCustomerLock<T>(customerId: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(customerId) ?? Promise.resolve();
  const run = previous.then(task);
  // The tail never rejects, so one failed task does not block the next one for this customer.
  const tail = run.then(() => undefined, () => undefined);
  tails.set(customerId, tail);
  void tail.then(() => {
    if (tails.get(customerId) === tail) tails.delete(customerId);
  });
  return run;
}

/**
 * Move `delta` points into (or out of) the lot named by an allocation. A missing lot is
 * recreated with the allocation's original expiry; that only matters on a restore.
 */
export async function adjustLot(ledger: InMemoryLoyaltyStore, customerId: string, allocation: PointsAllocation, delta: number): Promise<void> {
  const lot = (await ledger.getLot(allocation.lotId)) ?? { id: allocation.lotId, customerId, points: 0, expiresAt: allocation.expiresAt };
  await ledger.saveLot({ ...lot, points: lot.points + delta });
}
