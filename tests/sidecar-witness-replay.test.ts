// ATD-22 OBS-002: a subset of author-identified Gherkin examples has real source facts.
// Every remaining corpus case is explicitly UNQUALIFIED; no full-corpus pass.
import test from "node:test";
import assert from "node:assert/strict";
import {replayQualifiedSidecarWitnesses,fullWitnessGapSummary} from "../tools/sidecar-witness-replay.ts";

test("pinned architecture fires and doesNotFire examples have executable source witnesses",()=>{
  const report=replayQualifiedSidecarWitnesses();
  assert.equal(report.verified,10);
  assert.equal(report.passed,10,JSON.stringify(report.failures));
  assert.equal(report.failed,0,JSON.stringify(report.failures));
  assert.ok(report.cases.every(x=>x.qualified&&x.pass&&x.sourceLock.length===64));
  const positives=report.cases.filter(x=>x.expected);
  assert.equal(positives.length,5);
  assert.ok(positives.every(x=>x.activated&&x.structuralProof));
  const negatives=report.cases.filter(x=>!x.expected);
  assert.equal(negatives.length,5);
  assert.ok(negatives.every(x=>!x.activated));
});
test("entire sidecar matrix reports all remaining unqualified situations",()=>{
  const summary=fullWitnessGapSummary();
  assert.equal(summary.total,2579);
  assert.equal(summary.qualified,10);
  assert.equal(summary.pass,10);
  assert.equal(summary.fail,0);
  assert.equal(summary.unqualified,2569);
  assert.equal(summary.gaps.length,2569);
  for(const gap of summary.gaps)assert.match(gap.reason,/no independent executable/);
  process.stdout.write("ATD22_OBS002_STRUCTURAL_QUALIFICATION "+
    JSON.stringify({total:summary.total,qualified:summary.qualified,
      passed:summary.pass,failed:summary.fail,unqualified:summary.unqualified})+"\n");
});
