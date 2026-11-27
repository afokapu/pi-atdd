// URN: test:pi-atdd:effectiveness:E003-INTEGRATION-202
// Acceptance: acc:pi-atdd:E003-INTEGRATION-202
// Acceptance: acc:pi-atdd:E003-INTEGRATION-203
// Acceptance: acc:pi-atdd:E002-INTEGRATION-008
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acceptanceManifestDigest, compareTrials, decisionEffectivenessStatus, verifyTrial,
  type AcceptanceManifest, type Trial, type TrustedAcceptanceAuthority,
} from "../src/effectiveness.ts";

function authority(manifest:AcceptanceManifest):TrustedAcceptanceAuthority {
  const trustedDigest=acceptanceManifestDigest(manifest);
  // Synthetic evaluator capability for these tests, not an authenticated
  // production reviewer and not evidence of actual agent effectiveness.
  return {verifyManifest: (candidate,digest)=>candidate===manifest&&digest===trustedDigest};
}
function fixture() {
  const root=mkdtempSync(join(tmpdir(),"pi-atdd-D008-"));
  const repo=join(root,"repo"),base=join(root,"baseline"),graph=join(root,"graph");
  mkdirSync(repo);
  const git=(cwd:string,...args:string[])=>execFileSync("git",args,{cwd,encoding:"utf8"});
  git(repo,"init","-q");
  git(repo,"config","user.name","Independent verifier");
  git(repo,"config","user.email","test@example.invalid");
  writeFileSync(join(repo,"app.mjs"),"export const authorized = false;\n");
  writeFileSync(join(repo,"helper.mjs"),
    "export const acceptance = (authorized) => authorized;\n");
  writeFileSync(join(repo,"behavior.test.mjs"),
    "import {test} from 'node:test';import assert from 'node:assert/strict';"+
    "import {authorized} from './app.mjs';import {acceptance} from './helper.mjs';"+
    "test('unauthorized operation blocked',()=>assert.equal(acceptance(authorized),true));");
  writeFileSync(join(repo,"unrelated.test.mjs"),
    "import {test} from 'node:test';test('unrelated green',()=>{});\n");
  git(repo,"add",".");git(repo,"commit","-qm","base");
  const head=git(repo,"rev-parse","HEAD").trim();
  git(repo,"worktree","add","-q","-b","baseline",base);
  git(repo,"worktree","add","-q","-b","graph",graph);
  writeFileSync(join(graph,"app.mjs"),"export const authorized = true;\n");
  git(graph,"add","app.mjs");git(graph,"commit","-qm","fixture graph output");
  const manifest:AcceptanceManifest={
    schema:"pi-atdd/acceptance-manifest/v1",id:"evaluator-auth-001",taskId:"auth01",
    baseRevision:head,acceptanceIds:["acc:example:auth-negative"],
    testTargets:["behavior.test.mjs"],
    allowedChangedPaths:["app.mjs"],
    policyDigest:"a".repeat(64),runner:"node",
  };
  const make=(condition:Trial["condition"],workspace:string):Trial=>({
    taskId:"auth01",modelId:"fixture-model",tier:"weak",
    condition,runClass:"fixture",baseRevision:head,
    resultRevision:git(workspace,"rev-parse","HEAD").trim(),
    workspace,testTargets:["behavior.test.mjs"],claimedPassed:true,
    injectedTokens:condition==="graph"?400:0,wallMs:condition==="graph"?2300:2100,
  });
  return {
    root,baseline:make("baseline",base),graph:make("graph",graph),
    manifest,authority:authority(manifest),git,
    cleanup:()=>rmSync(root,{recursive:true,force:true}),
  };
}
test("D008 re-runs evaluator-owned tests and detects fake-green agent claims",()=>{
  const f=fixture();
  try{
    const baseline=verifyTrial(f.baseline,f.manifest,f.authority);
    const guided=verifyTrial(f.graph,f.manifest,f.authority);
    assert.equal(baseline.passed,false);
    assert.equal(baseline.falseClaim,true);
    assert.equal(guided.passed,true);
    assert.equal(guided.falseClaim,false);
    assert.equal(guided.testTargets[0],"behavior.test.mjs");
    const comparison=compareTrials([baseline,guided]);
    assert.equal(comparison.length,1);
    assert.equal(comparison[0]?.passDelta,1);
    assert.equal(comparison[0]?.status,"FIXTURE_ONLY");
    const status=decisionEffectivenessStatus(comparison);
    assert.equal(status.status,"INCOMPLETE");
    assert.ok(status.missing.some(x=>x.includes("strong")));
    // No real model was invoked; do not claim graph-driven improvement.
  }finally{f.cleanup();}
});
test("D008 rejects dirty worktrees and agent-rewritten acceptance test files",()=>{
  const f=fixture();
  try{
    writeFileSync(join(f.graph.workspace,"app.mjs"),"export const authorized = false;\n");
    assert.throws(()=>verifyTrial(f.graph,f.manifest,f.authority),/worktree is dirty/);
    f.git(f.graph.workspace,"checkout","--","app.mjs");
    const fakeTest="import {test} from 'node:test';test('fake accepted',()=>{});\n";
    writeFileSync(join(f.graph.workspace,"behavior.test.mjs"),fakeTest);
    f.git(f.graph.workspace,"add","behavior.test.mjs");
    f.git(f.graph.workspace,"commit","-qm","forged acceptance");
    const changed={...f.graph,resultRevision:f.git(f.graph.workspace,"rev-parse","HEAD").trim()};
    assert.throws(()=>verifyTrial(changed,f.manifest,f.authority),/evaluator-protected file/);
  }finally{f.cleanup();}
});
test("D008 rejects unchanged acceptance tests whose imported helper was rewritten",()=>{
  const f=fixture();
  try{
    // A passing test file can be compromised through a test helper imported
    // at execution time. The evaluator's allowed implementation paths do not
    // include that helper, so the entire diff is rejected.
    f.git(f.graph.workspace,"checkout",f.manifest.baseRevision,"--","app.mjs");
    writeFileSync(join(f.graph.workspace,"helper.mjs"),
      "export const acceptance = () => true; // forged helper\n");
    f.git(f.graph.workspace,"add","helper.mjs","app.mjs");
    f.git(f.graph.workspace,"commit","-qm","forged unchanged test helper");
    const manipulated={...f.graph,resultRevision:f.git(f.graph.workspace,"rev-parse","HEAD").trim()};
    assert.throws(()=>verifyTrial(manipulated,f.manifest,f.authority),/evaluator-protected file.*helper\.mjs/);
  }finally{f.cleanup();}
});
test("D008 refuses pre-existing unrelated green targets and untrusted manifest policy",()=>{
  const f=fixture();
  try{
    assert.throws(()=>verifyTrial({...f.baseline,testTargets:["unrelated.test.mjs"]},
      f.manifest,f.authority),/targets differ/);
    assert.throws(()=>verifyTrial(f.baseline,f.manifest,{verifyManifest:()=>false}),
      /lacks independent authentication/);
    assert.throws(()=>verifyTrial(f.baseline,{...f.manifest,allowedChangedPaths:["behavior.test.mjs"]},
      {verifyManifest:()=>true}),/must never allow changes to test/);
    assert.throws(()=>verifyTrial({...f.baseline,taskId:"unrelated"},f.manifest,f.authority),
      /not bound to evaluator-approved task/);
  }finally{f.cleanup();}
});
test("D008 pair comparison rejects different evaluator-owned targets or policy",()=>{
  const f=fixture();
  try{
    const baseline=verifyTrial(f.baseline,f.manifest,f.authority);
    const other:AcceptanceManifest={...f.manifest,id:"unrelated-acceptance-002",
      testTargets:["unrelated.test.mjs"],acceptanceIds:["acc:example:unrelated"],
      policyDigest:"b".repeat(64)};
    const alteredTrial={...f.graph,testTargets:["unrelated.test.mjs"]};
    const guided=verifyTrial(alteredTrial,other,authority(other));
    assert.equal(guided.passed,true,"unrelated test really is green, demonstrating the attack");
    assert.throws(()=>compareTrials([baseline,guided]),/rejected unmatched evaluator acceptance/);
    assert.equal(compareTrials([baseline])[0]?.status,"NOT_RUN");
  }finally{f.cleanup();}
});
test("D008 refuses stale revisions, absent pairs, and fabricated completeness",()=>{
  const f=fixture();
  try{
    assert.throws(()=>verifyTrial({...f.graph,resultRevision:"0".repeat(40)},f.manifest,f.authority),
      /revision does not match/);
    const measured=verifyTrial(f.baseline,f.manifest,f.authority);
    const incomplete=compareTrials([measured]);
    assert.equal(incomplete[0]?.status,"NOT_RUN");
    assert.equal(decisionEffectivenessStatus([]).status,"NOT_RUN");
    assert.equal(decisionEffectivenessStatus(incomplete).status,"INCOMPLETE");
  }finally{f.cleanup();}
});
