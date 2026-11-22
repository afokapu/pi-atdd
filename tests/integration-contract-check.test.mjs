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
  assert.match(result.caution,/does NOT close the original issue|does NOT close the original issue/i);
});
test("B must map all original OBS acceptance", () => {
  const body = make("ATD-22",["OBS-001","OBS-002","OBS-003","OBS-004"],"ATD-41 ATD-25 ATD-30 ATD-39");
  assert.equal(inspectIntegrationPR({base,head:b,body}).status,"SELF_DECLARED_COMPLETE");
});
test("partial is disclosed without pretending to complete the source issue", () => {
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

test("coordinator merge-resolution PR is scoped separately from worker acceptance", () => {
  const result=inspectIntegrationPR({base,head:"feature/atd-39-reconcile-trusted-phase",body:"ATD-39 ATD-42 ATD-41: merge-conflict reconciliation, no full issue completion claimed"});
  assert.equal(result.status,"SCOPE_REVIEW_ONLY");
});

test("a source-locked main sync has its own ATD-39 contract, not unrelated work criteria", () => {
  const result=inspectIntegrationPR({base,head:"sync/atd-39-main-3007c139",body:"ATD-39: sync main@3007c13958def5879106c4612f10bef8d524e9db into integration without closing ATD-22 or ATD-29"});
  assert.equal(result.status,"SCOPE_REVIEW_ONLY");
});


test("ATD-22 source follow-up is registered without losing all four original obligations", () => {
  const head="feature/atd-22-observer-acceptance-followup";
  const body=make("ATD-22",["OBS-001","OBS-002","OBS-003","OBS-004"],
    "ATD-41 ATD-25 ATD-30 ATD-39","PARTIAL");
  const out=inspectIntegrationPR({base,head,body});
  assert.equal(out.status,"DISCLOSED_PARTIAL");
  assert.deepEqual(out.outstanding,[
    "ATD-22/OBS-001 = PARTIAL","ATD-22/OBS-002 = PARTIAL",
    "ATD-22/OBS-003 = PARTIAL","ATD-22/OBS-004 = PARTIAL"
  ]);
  assert.equal(inspectIntegrationPR({base,head,body:body.replace("ATD-22/OBS-004","ATD-41/OBS-004")}).status,
    "INCOMPLETE","the worker wrapper cannot replace the last source criterion");
  assert.equal(inspectIntegrationPR({base,head,body:body.replace("evidence: docs/evidence.md","no evidence")}).status,
    "INCOMPLETE","every criterion must include inspectable evidence");
  assert.equal(inspectIntegrationPR({base:"main",head,body}).status,"INCOMPLETE");
});

test("coordinator registration is scope only and arbitrary follow-up branches remain rejected", () => {
  const head="feature/atd-39-register-atd-22-followup";
  const out=inspectIntegrationPR({base,head,body:"ATD-39 ATD-22 ATD-41: exact fork registration only"});
  assert.equal(out.status,"SCOPE_REVIEW_ONLY");
  assert.equal(inspectIntegrationPR({base,head:"feature/atd-22-observer-acceptance-followup-copy",body:"ATD-22 ATD-41 ATD-39"}).status,
    "INCOMPLETE");
});

test("workflow pins the exact ATD-22 and coordinator forks, with no wildcard admission", async () => {
  const {readFileSync}=await import("node:fs");
  const source=readFileSync(new URL("../.github/workflows/integration-acceptance.yml",import.meta.url),"utf8");
  assert.match(source,/feature\/atd-22-observer-acceptance-followup\)\s*\n(?:[^\n]*\n)*?\s*FORK=567b2e513782b380c18f320d69edf140d61a36d4 ;;/);
  assert.match(source,/feature\/atd-39-register-atd-22-followup\)\s*\n(?:[^\n]*\n)*?\s*FORK=9792560103f1a13f34bf8a3f1620342c04158616 ;;/);
  assert.match(source,/\*\) echo "Unregistered integration head:/);
});
