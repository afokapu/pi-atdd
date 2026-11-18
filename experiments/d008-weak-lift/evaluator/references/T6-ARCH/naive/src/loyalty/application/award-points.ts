import { orderPoints } from "../domain/points.ts";
import type { PointsLedger } from "../integration/points-ledger.ts";

export function awardOrderPoints(ledger: PointsLedger, customerId: string, subtotalCents: number): number {
  const awarded = orderPoints(subtotalCents);
  ledger.credit(customerId, awarded);
  return awarded;
}
