import type { PointsLot } from "../domain/points.ts";
import type { Redemption } from "../domain/redemption.ts";

/**
 * Port the use cases need from the loyalty ledger. Application code depends on this shape,
 * not on the adapter; `InMemoryLoyaltyStore` satisfies it structurally and is wired in app.ts.
 */
export type LoyaltyLedger = {
  /** Non-expired lots with points left for a customer at instant `at`. */
  usableLotsFor(customerId: string, at: Date): Promise<PointsLot[]>;
  getLots(ids: string[]): Promise<PointsLot[]>;
  saveLot(lot: PointsLot): Promise<void>;
  redemptionByKey<Q = unknown>(customerId: string, idempotencyKey: string): Promise<Redemption<Q> | undefined>;
  redemptionForOrder<Q = unknown>(orderId: string): Promise<Redemption<Q> | undefined>;
  saveRedemption<Q>(redemption: Redemption<Q>): Promise<void>;
  /** Run `work` exclusively for one customer: calls for the same customer run one after another. */
  withCustomerLock<T>(customerId: string, work: () => Promise<T>): Promise<T>;
};
