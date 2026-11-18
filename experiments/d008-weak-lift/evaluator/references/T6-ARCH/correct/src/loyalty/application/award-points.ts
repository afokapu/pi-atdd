import { orderPoints } from "../domain/points.ts";
import { activeMultiplier } from "../integration/campaigns.ts";
import type { PointsLedger } from "../integration/points-ledger.ts";

export function awardOrderPoints(ledger: PointsLedger, customerId: string, subtotalCents: number): number {
  const awarded = orderPoints(subtotalCents, activeMultiplier());
  ledger.credit(customerId, awarded);
  return awarded;
}
