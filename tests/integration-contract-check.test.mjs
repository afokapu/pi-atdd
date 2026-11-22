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

const reviewBranch = "feature/atd-29-pass-a-semantic-completion";
const fullContracts = {
  "ATD-29": 4, "ATD-28": 4, "ATD-27": 4, "ATD-26": 8,
};
const fullReviewBody = (status = "PARTIAL") => [
  "ATD-26 ATD-29 ATD-28 ATD-27 ATD-39: exact-source full three-pass OoC review",
  ...Object.entries(fullContracts).flatMap(([id, n]) =>
    Array.from({length:n}, (_, i) =>
      "- " + id + "/Acceptance-" + String(i+1).padStart(2,"0") +
      ": " + status + " — evidence: research/atd-26/ATD-26-ALL-20-ORIGINAL-ACCEPTANCES-TRIPLE-CHECK.md; " +
      "reason: independent reviewer and owner signoff remains unverified")),
].join("\n");

test("ATD-26 continuation requires all 20 original ATD-29/28/27/26 criterion rows", () => {
  const result = inspectIntegrationPR({base, head:reviewBranch, body:fullReviewBody()});
  assert.equal(result.status, "DISCLOSED_PARTIAL");
  assert.equal(result.evidence.length, 20);
  assert.equal(result.outstanding.length, 20);
  assert.equal(result.problems.length, 0);
  assert.match(result.caution, /does NOT close the original issue/);
});
test("ATD-26 review continuation cannot silently omit B, C or parent criteria", () => {
  const short = make("ATD-29",
    ["Acceptance-01","Acceptance-02","Acceptance-03","Acceptance-04"],
    "ATD-26 ATD-29 ATD-28 ATD-27 ATD-39");
  const result = inspectIntegrationPR({base, head:reviewBranch, body:short});
  assert.equal(result.status, "INCOMPLETE");
  assert.match(result.problems.join(" "), /ATD-28\/Acceptance-01/);
  assert.match(result.problems.join(" "), /ATD-27\/Acceptance-04/);
  assert.match(result.problems.join(" "), /ATD-26\/Acceptance-08/);
});
test("ATD-26 review requires explicit proof or reason and exact integration target", () => {
  const bad = fullReviewBody().replace("ATD-26/Acceptance-08: PARTIAL — evidence:", "ATD-26/Acceptance-08: PARTIAL — no-citation:");
  const result = inspectIntegrationPR({base, head:reviewBranch, body:bad});
  assert.equal(result.status, "INCOMPLETE");
  assert.match(result.problems.join(" "), /ATD-26\/Acceptance-08/);
  assert.equal(inspectIntegrationPR({base:"main",head:reviewBranch,body:fullReviewBody()}).status,"INCOMPLETE");
});
test("twenty self-declared PASSes remain non-authoritative", () => {
  const outcome = inspectIntegrationPR({base,head:reviewBranch,body:fullReviewBody("PASS")});
  assert.equal(outcome.status,"SELF_DECLARED_COMPLETE");
  assert.equal(outcome.evidence.length,20);
  assert.match(outcome.caution,/Only source-verified applicable conventions, independent tests, review, and owner authority/);
});
test("coordinator intake branch does not self-certify original issues", () => {
  const result = inspectIntegrationPR({
    base,head:"feature/atd-39-register-atd-26-review-intake",
    body:"ATD-39 ATD-26 ATD-29: CI routing and exact SHA registration only",
  });
  assert.equal(result.status, "SCOPE_REVIEW_ONLY");
});
