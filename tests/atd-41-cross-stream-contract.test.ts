// ATD-41/ATD-39: compare the real Pi reasoner/observer with Stream A's
// provisional S1–S7 field/proof expectations. No T9 matcher or OoC admission.
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {loadCatalog,loadConfig} from "../src/catalog.ts";
import {ReasoningSession,type ContextObservation} from "../src/reasoning-context.ts";
import {PiObservationFeed} from "../src/pi-observation-feed.ts";

function setup(){
  const cwd=mkdtempSync(join(tmpdir(),"pi-atdd-stream-a-b-contract-"));
  const config=loadConfig(cwd),catalog=loadCatalog(config.sources,cwd);
  return {catalog,session:new ReasoningSession(catalog,config.selectors),
    feed:new PiObservationFeed(),cleanup:()=>rmSync(cwd,{recursive:true,force:true})};
}
const observe=(scope:string,path:string,source:string):ContextObservation=>({
  scope,task:"Adjust a source without security keywords",path,
  sourceText:source,priorSourceText:"export const value=1;\n",
  operation:"edit",origin:"pi-event",provenance:"Pi proposed edit",
  revision:"a".repeat(40),
});
test("S1/S2 source-backed mutation enters existing graph, GET-only retracts without claiming global NO_RULE",()=>{
  const x=setup(),scope="contract:S1";
  try{
    const bad=observe(scope,"src/server.ts",
      'Bun.serve({routes:{"/orders":{DELETE:()=>new Response("ok")}}});');
    const first=x.feed.capture("S1:event",bad,x.session.observe(bad));
    const match=first.receipts.find(r=>r.conventionId==="coder.security.missing-auth");
    assert.ok(match);
    assert.match(JSON.stringify(match.proof),/bun_mutating_route_missing_auth/);
    assert.equal(match.sourceDigest?.length,64);
    assert.ok(first.observed.some(f=>f.factType==="code_construct"&&
      f.factArgs[1]==="bun_mutating_route_missing_auth"));
    assert.equal(first.disposition,"observation_only_no_authority");
    const get=observe(scope,"src/server.ts",
      'Bun.serve({routes:{"/orders":{GET:()=>new Response("ok")}}});');
    const second=x.feed.capture("S2:event",get,x.session.observe(get));
    assert.ok(second.removedRuleIds.includes("coder.security.missing-auth"));
    assert.ok(second.retracted.some(f=>f.factType==="code_construct"&&
      f.factArgs[1]==="bun_mutating_route_missing_auth"));
    assert.ok(!second.receipts.some(r=>r.conventionId==="coder.security.missing-auth"));
    assert.equal(second.disposition,"observation_only_no_authority");
    assert.ok(!("NO_RULE_REQUIRED" in second),"an empty scoped rule is not a full catalog proof");
  }finally{x.cleanup();}
});
test("S3 test URN distinguishes missing binding from separate review truthfulness",()=>{
  const x=setup(),scope="contract:S3",path="src/order.test.ts";
  const header="// URN: test:orders:checkout:E001-SMOKE-001\n";
  const body='import {test} from "bun:test";\n';
  try{
    const first=observe(scope,path,header+body);
    const before=x.feed.capture("S3:missing",first,x.session.observe(first));
    assert.ok(before.observed.some(f=>f.factArgs[1]==="test_urn_missing_binding"));
    assert.ok(before.receipts.some(r=>r.conventionId==="tester.acceptance.binding-declared"));
    const valid=observe(scope,path,header+"// Acceptance: acc:checkout\n"+body);
    const after=x.feed.capture("S3:valid",valid,x.session.observe(valid));
    assert.ok(after.retracted.some(f=>f.factArgs[1]==="test_urn_missing_binding"));
    assert.ok(!after.receipts.some(r=>r.conventionId==="tester.acceptance.binding-declared"),
      "a complete header must not be reported as a missing-header finding");
    const reviewer={...valid,operation:"review" as const};
    const reviewed=x.feed.capture("S3:review",reviewer,x.session.observe(reviewer));
    assert.ok(reviewed.receipts.some(r=>r.conventionId==="tester.acceptance.binding-declared"&&
      JSON.stringify(r.proof).includes("truthfulness-review")));
    assert.ok(reviewed.missing.some(m=>m.reason==="test_binding_truthfulness_requires_review"));
  }finally{x.cleanup();}
});
test("S4/S5 graph closure is authored mandatory only; potential Drivers are not derived",()=>{
  const x=setup();
  try{
    const input:ContextObservation={scope:"contract:S4",task:"Perform final behavioral review",
      operation:"review",origin:"pi-event",provenance:"Pi reviewer request"};
    const result=x.session.observe(input);
    const frame=x.feed.capture("S4:event",input,result);
    const dependent=frame.receipts.find(r=>r.conventionId==="reviewer.inspectability.owner");
    assert.ok(dependent);
    assert.ok(dependent.mandatoryRequires.some(e=>e.fromRuleId==="reviewer.reconciliation.behavioral"
      && e.toRuleId==="reviewer.inspectability.owner"&&e.constraint==="mandatory"));
    assert.ok(dependent.mandatoryRequires.every(e=>e.constraint==="mandatory"&&!!e.sourcePath));
    assert.ok(!JSON.stringify(dependent.mandatoryRequires).includes("runs_alongside"));
    assert.equal(frame.disposition,"observation_only_no_authority");
    assert.equal((frame as any).possibleDrivers,undefined);
  }finally{x.cleanup();}
});
test("S6/S7 incomplete source and missing provider never produce admitted identity or NO_MATCH proof",()=>{
  const x=setup();
  try{
    const bad=observe("contract:S7","src/server.ts","Bun.serve({routes:{");
    const partial=x.feed.capture("S7:partial",bad,x.session.observe(bad));
    assert.ok(partial.missing.some(m=>m.reason==="partial_source_parse"));
    assert.ok(partial.unknownFacts.includes("code_construct"));
    assert.equal(partial.disposition,"observation_only_no_authority");
    assert.ok(!partial.observed.some(f=>f.factArgs[1]==="bun_mutating_route_missing_auth"));
    assert.throws(()=>x.session.observe({...bad,phase:"GREEN"}),/trusted provider/);
    assert.equal((partial as any).admittedOoC,undefined);
    assert.equal((partial as any).authorizedToExecute,undefined);
  }finally{x.cleanup();}
});
