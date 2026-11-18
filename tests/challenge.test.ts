// Acceptance: acc:pi-atdd:E002-UNIT-007
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog, loadConfig } from "../src/catalog.ts";
import { proposeChallenge, publishChallenge, publishExternalReview, readChallenge,
  type ChallengeRequest, type ReviewDecision } from "../src/challenge.ts";

const evidence = { kind:"test" as const, locator:"CI#123/negative-auth", sha256:"a".repeat(64) };
function setup() {
  const root=mkdtempSync(join(tmpdir(),"pi-atdd-challenge-"));
  const config=loadConfig(root), catalog=loadCatalog(config.sources,root);
  const origin=catalog.provenance.find(p=>p.id==="ATDD-Bun")!;
  const request:ChallengeRequest={
    ruleId:"coder.bun.design-hierarchy-import",sourceDigest:origin.digest,
    requester:"coder-run-1",counterexample:"A feature-slice implementation retains the dependency direction without layered filenames",
    proposedRealization:"Validate the actual import dependency graph rather than folder names",
    assumptions:["same dependency invariant"],evidence:[evidence],
  };
  return {root,catalog,request,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test("proposal binds source digest and canonical impact, without modifying any source",()=>{
  const t=setup();
  try{
    const record=proposeChallenge(t.catalog,t.request);
    assert.equal(record.status,"pending_review");
    assert.equal(record.sourceDigest,t.request.sourceDigest);
    assert.ok(record.affectedRelationships.some(x=>x.source===record.ruleId || x.target===record.ruleId));
    assert.match(record.id,/^[a-f0-9]{64}$/);
    const stored=publishChallenge(t.root,record);
    assert.ok(stored.includes(".atdd/pi-atdd/challenges"));
    assert.deepEqual(readChallenge(t.root,record.id),record);
    assert.throws(()=>publishChallenge(t.root,record),/EEXIST/);
    assert.deepEqual(proposeChallenge(t.catalog,t.request),record);
  }finally{t.cleanup()}
});
test("tampered challenge payload cannot be reviewed under the original digest",async()=>{
  const t=setup();
  try{
    const record=proposeChallenge(t.catalog,t.request);
    const file=publishChallenge(t.root,record);
    const forged={...record,proposedRealization:"All security rules are now optional"};
    writeFileSync(file,JSON.stringify(forged,null,2)+"\n");
    assert.throws(()=>readChallenge(t.root,record.id),/modified or malformed/);
    const decision:ReviewDecision={
      schema:"pi-atdd/external-review/v1",challengeId:record.id,sourceDigest:record.sourceDigest,
      reviewer:"reviewer-run-2",verdict:"ACCEPT_ALTERNATIVE",
      reason:"This cannot be trusted",evidence:[evidence],
    };
    await assert.rejects(()=>publishExternalReview(t.root,record,decision,{
      verifyReview:async()=>true,
    }),/modified or malformed/);
    assert.throws(()=>publishChallenge(t.root,forged),/modified or malformed/);
  }finally{t.cleanup()}
});

test("stale graph and invalid evidence are rejected",()=>{
  const t=setup();
  try{
    assert.throws(()=>proposeChallenge(t.catalog,{...t.request,sourceDigest:"0".repeat(64)}),/stale/);
    assert.throws(()=>proposeChallenge(t.catalog,{...t.request,ruleId:"not-a-real-rule"}),/unknown/);
    assert.throws(()=>proposeChallenge(t.catalog,{...t.request,evidence:[{...evidence,sha256:"abc"}]}),/invalid evidence/);
  }finally{t.cleanup()}
});
test("self approval and unverified comment authority cannot approve an alternative",async()=>{
  const t=setup();
  try{
    const record=proposeChallenge(t.catalog,t.request);
    publishChallenge(t.root,record);
    const candidate:ReviewDecision={
      schema:"pi-atdd/external-review/v1",challengeId:record.id,
      sourceDigest:record.sourceDigest,reviewer:"coder-run-1",
      verdict:"ACCEPT_ALTERNATIVE",reason:"Looks compliant",evidence:[evidence],
    };
    let called=0;
    const adapter={verifyReview:async()=>{called++;return true}};
    await assert.rejects(()=>publishExternalReview(t.root,record,candidate,adapter),/self-approval/);
    assert.equal(called,0);
    const other={...candidate,reviewer:"reviewer-run-2"};
    await assert.rejects(()=>publishExternalReview(t.root,record,other,{
      verifyReview:async()=>false,
    }),/could not be verified/);
    const result=await publishExternalReview(t.root,record,other,adapter);
    assert.ok(result.endsWith(".review.json"));
    assert.equal(called,1);
    await assert.rejects(()=>publishExternalReview(t.root,record,other,adapter),/EEXIST/);
    // The reviewer writes a separate immutable record. Canonical YAML is not touched.
    assert.equal(readChallenge(t.root,record.id).status,"pending_review");
  }finally{t.cleanup()}
});
