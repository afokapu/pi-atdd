/**
 * Acceptance LOY-001
 * Given an active loyalty campaign with a configured multiplier
 * When points are awarded for a customer's order subtotal
 * Then the customer's ledger is credited floor(base points x multiplier),
 *  where base points are 1 per whole euro of the subtotal
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { awardOrderPoints } from "../../src/loyalty/application/award-points.ts";
import { activateCampaign } from "../../src/loyalty/integration/campaigns.ts";
import { PointsLedger } from "../../src/loyalty/integration/points-ledger.ts";

test("LOY-001: double-points campaign doubles the points credited", () => {
  const ledger = new PointsLedger();
  activateCampaign("double-points");
  try {
    const awarded = awardOrderPoints(ledger, "alice", 4250);
    assert.equal(awarded, 84);
    assert.equal(ledger.balance("alice"), 84);
  } finally {
    activateCampaign(null);
  }
});
