// Acceptance: acc:pi-atdd:E002-INTEGRATION-008
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareTrials, decisionEffectivenessStatus, verifyTrial, type Trial } from "../src/effectiveness.ts";

function fixture() {
  const root=mkdtempSync(join(tmpdir(),"pi-atdd-D008-"));
  const repo=join(root,"repo"),base=join(root,"baseline"),graph=join(root,"graph");
  mkdirSync(repo);
  const git=(cwd:string,...args:string[])=>execFileSync("git",args,{cwd,encoding:"utf8"});
  git(repo,"init","-q");
  git(repo,"config","user.name","Independent verifier");
  git(repo,"config","user.email","test@example.invalid");
  writeFileSync(join(repo,"app.mjs"),"export const authorized = false;\n");
  writeFileSync(join(repo,"behavior.test.mjs"),
    "import {test} from 'node:test';import assert from 'node:assert/strict';"+
    "import {authorized} from './app.mjs';test('unauthorized operation blocked',()=>assert.equal(authorized,true));");
  git(repo,"add",".");git(repo,"commit","-qm","base");
  const head=git(repo,"rev-parse","HEAD").trim();
  git(repo,"worktree","add","-q","-b","baseline",base);
  git(repo,"worktree","add","-q","-b","graph",graph);
  writeFileSync(join(graph,"app.mjs"),"export const authorized = true;\n");
  git(graph,"add","app.mjs");git(graph,"commit","-qm","fixture graph output");
  const make=(condition:Trial["condition"],workspace:string):Trial=>({
    taskId:"auth01",modelId:"fixture-model",tier:"weak",
    condition,runClass:"fixture",baseRevision:head,
    resultRevision:git(workspace,"rev-parse","HEAD").trim(),
    workspace,testTargets:["behavior.test.mjs"],claimedPassed:true,
    injectedTokens:condition==="graph"?400:0,wallMs:condition==="graph"?2300:2100,
  });
  return {root,baseline:make("baseline",base),graph:make("graph",graph),
    cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test("D008 re-runs real acceptance tests and detects a fake-green agent claim",()=>{
  const f=fixture();
  try{
    const baseline=verifyTrial(f.baseline),guided=verifyTrial(f.graph);
    assert.equal(baseline.passed,false);
    assert.equal(baseline.falseClaim,true);
    assert.equal(guided.passed,true);
    assert.equal(guided.falseClaim,false);
    const result=compareTrials([baseline,guided]);
    assert.equal(result.length,1);
    assert.equal(result[0]?.passDelta,1);
    assert.equal(result[0]?.status,"FIXTURE_ONLY");
    const status=decisionEffectivenessStatus(result);
    assert.equal(status.status,"INCOMPLETE");
    assert.ok(status.missing.some(x=>x.includes("strong")));
    // No real model was invoked; do not claim graph-driven model improvement.
  } finally{f.cleanup();}
});
test("D008 refuses stale revisions, absent pairs, and fabricated completeness",()=>{
  const f=fixture();
  try{
    assert.throws(()=>verifyTrial({...f.graph,resultRevision:"0".repeat(40)}),/revision does not match/);
    const measured=verifyTrial(f.baseline);
    const incomplete=compareTrials([measured]);
    assert.equal(incomplete[0]?.status,"NOT_RUN");
    assert.equal(decisionEffectivenessStatus([]).status,"NOT_RUN");
    assert.equal(decisionEffectivenessStatus(incomplete).status,"INCOMPLETE");
  } finally{f.cleanup();}
});
