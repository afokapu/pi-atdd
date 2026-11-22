import assert from "node:assert/strict";
import test from "node:test";
import {inspectIntegrationPR} from "../scripts/check-integration-contract.mjs";

const base = "integration/atd-39-ooc-activation";
const a = "feature/atd-40-ooc-governance-contract";
const b = "feature/atd-41-structural-activation";
const make = (ref, criteria, other, disposition = "PASS") =>
  [other, ...criteria.map(x => "- " + ref + "/" + x + ": " + disposition + " — evidence: docs/evidence.md")].join("\n");

test("A requires original ATD-29 acceptance, not only wrapper references", () => {
  const result = inspectIntegrationPR({base,head:a,body:"ATD-40 ATD-39"});
  assert.equal(result.status,"INCOMPLETE");
  assert.match(result.problems.join(" "),/ATD-29\/Acceptance-01/);
});
test("A complete declaration is not independent verification", () => {
  const body = make("ATD-29",["Acceptance-01","Acceptance-02","Acceptance-03","Acceptance-04"],"ATD-40 ATD-39 ATD-26");
  const result = inspectIntegrationPR({base,head:a,body});
  assert.equal(result.status,"SELF_DECLARED_COMPLETE");
  assert.match(result.caution,/does not verify/);
});
test("B must map all original OBS acceptance", () => {
  const body = make("ATD-22",["OBS-001","OBS-002","OBS-003","OBS-004"],"ATD-41 ATD-25 ATD-30 ATD-39");
  assert.equal(inspectIntegrationPR({base,head:b,body}).status,"SELF_DECLARED_COMPLETE");
});
test("partial remains incomplete", () => {
  const body = make("ATD-22",["OBS-001","OBS-002","OBS-003","OBS-004"],"ATD-41 ATD-25 ATD-30 ATD-39","PARTIAL");
  const outcome=inspectIntegrationPR({base,head:b,body});
  assert.equal(outcome.status,"DISCLOSED_PARTIAL");
  assert.equal(outcome.outstanding.length,4);
});
test("wrong base and unregistered branch cannot report ready", () => {
  const body = make("ATD-29",["Acceptance-01","Acceptance-02","Acceptance-03","Acceptance-04"],"ATD-40 ATD-26 ATD-39");
  assert.equal(inspectIntegrationPR({base:"main",head:a,body}).status,"INCOMPLETE");
  assert.equal(inspectIntegrationPR({base,head:"feature/wrong",body}).status,"INCOMPLETE");
});

test("ATD-42 Pi-only scope is tracked without unrelated OoC or Coach gates", () => {
  const result=inspectIntegrationPR({base,head:"feature/atd-42-trusted-phase-activation",body:"ATD-42 ATD-39: Pi-only verified Flow phase activation; the separate Flow Coach transition gate is not in this change."});
  assert.equal(result.status,"SCOPE_REVIEW_ONLY");
});
