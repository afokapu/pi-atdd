// ATD-22 OBS-002: full sidecar inventory and honest text-only reasoner diagnostic.
// This deliberately does NOT claim that NL example text provides an observed
// file/diff/provider/detector. Executable structured witnesses remain missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { enumerateSidecarExamples, replayAllSidecarExamples } from "../tools/sidecar-activation-matrix.ts";

test("OBS-002 all 358 frozen source specifications and split parts are enumerated with source locks",()=>{
  const data=enumerateSidecarExamples();
  assert.equal(data.sources,359,"358 upstream canonical + 1 package-authored sidecar");
  assert.equal(data.variants,390,"343 frozen + 1 package-authored + 46 split-part variants");
  assert.equal(data.lockFailures.length,0,"source/sidecar SHA-256 evidence is unchanged");
  assert.equal(data.lockChecks,718);
  assert.ok(data.examples.length>1_000);
  assert.equal(new Set(data.examples.map(x=>x.sourceId)).size,359);
  assert.equal(new Set(data.examples.map(x=>x.effectiveRuleId)).size,390);
  assert.ok(data.examples.every(x=>x.text.length>0));
});

test("OBS-002 every fires and doesNotFire example is probed, but no task-only text is graded as structural evidence",()=>{
  const r=replayAllSidecarExamples();
  const {outcomes,...summary}=r;
  assert.equal(r.totalSources,359);
  assert.equal(r.totalRuleVariants,390);
  assert.equal(r.totalCases,r.fireCases+r.doesNotFireCases);
  assert.equal(outcomes.length,r.totalCases);
  assert.ok(r.fireCases>0&&r.doesNotFireCases>0);
  assert.equal(r.sourceLockFailures.length,0);
  assert.equal(r.unqualifiedCases,r.totalCases,
    "NL examples are not event/file/revision/detector observations");
  assert.ok(outcomes.every(o=>o.qualification==="UNQUALIFIED_TASK_TEXT_ONLY"&&
    o.missingEvidence.includes("source_or_diff_not_observed")));
  assert.equal(r.taskOnlyFireMatches+r.taskOnlyFireMisses,r.fireCases);
  assert.equal(r.taskOnlyNegativeMatches+r.taskOnlyNegativeNonMatches,r.doesNotFireCases);
  assert.ok(outcomes.some(x=>x.sidecarPath.includes("design-hierarchy-import")),
    "the frozen legacy path is retained even when the loaded rule was renamed");
  // Every case is individually addressable in the persisted GitHub Actions log,
  // even when the source prose cannot be turned into an authorized event.
  for(const o of outcomes)console.log("ATD41_OBS002_CASE "+JSON.stringify({
    sourceId:o.sourceId,ruleId:o.effectiveRuleId,sidecar:o.sidecarPath,
    kind:o.kind,index:o.index,sourceSha256:o.sourceSha256,
    mappedRule:o.mappedRule,taskTextActivated:o.taskTextActivated,
    qualification:o.qualification,missingEvidence:o.missingEvidence,
  }));
  console.log("ATD41_OBS002_FULL_SIDECARE_TASK_ONLY_DIAGNOSTIC "+JSON.stringify(summary));
});
