// ATD-41: the Stream B handoff is an observation trace, never an OoC authority.
import test from "node:test";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {loadConfig,loadCatalog} from "../src/catalog.ts";
import {ReasoningSession,type ContextObservation} from "../src/reasoning-context.ts";
import {PiObservationFeed} from "../src/pi-observation-feed.ts";

const path="src/orders/domain/price.ts";
const oldSource="export const price=1;\n";
const newSource='import {gateway} from "../integration/gateway";\n'+oldSource;
const revise=(scope:string,source:string,prior?:string):ContextObservation=>({
  scope,task:"Private customer request; do not put this in the feed",
  path,sourceText:source,priorSourceText:prior,operation:"edit",
  origin:"pi-event",provenance:"Pi pre-edit source pair",revision:"f".repeat(40),
});
function setup(){
  const cwd=mkdtempSync(join(tmpdir(),"pi-atdd-observation-feed-"));
  const config=loadConfig(cwd);
  const catalog=loadCatalog(config.sources,cwd);
  return {session:new ReasoningSession(catalog,config.selectors),
    cleanup:()=>rmSync(cwd,{force:true,recursive:true})};
}
test("pre-edit source facts expose full typed arguments, source proof, and no OoC or task-text authority",()=>{
  const x=setup(),feed=new PiObservationFeed();
  try{
    const input=revise("domain:change",newSource,oldSource);
    const result=x.session.observe(input);
    const frame=feed.capture("event:0001",input,result);
    assert.equal(frame.event.point,"pre_edit");
    assert.equal(frame.event.repositoryRevision,"f".repeat(40));
    assert.equal(frame.event.targetPathHint,path);
    assert.equal(frame.event.sourceState,"PROPOSED");
    assert.equal(frame.event.sourceDigest,createHash("sha256").update(newSource).digest("hex"));
    assert.equal(frame.disposition,"observation_only_no_authority");
    assert.equal(frame.resourceHints.layer,"domain");
    assert.equal(frame.resourceHints.fileKind,"source");
    assert.ok(frame.observed.some(f=>f.factType==="change"&&
      f.factArgs[0]===input.scope&&f.factArgs[1]==="domain_to_integration_import_added"&&
      f.sourceDigest===frame.event.sourceDigest&&f.sourceRevision===input.revision));
    assert.ok(frame.receipts.some(r=>r.conventionId==="coder.architecture.hierarchy-import"&&
      r.sourceDigest?.length===64&&JSON.stringify(r.proof).includes("domain_to_integration_import_added")));
    assert.ok(!frame.observed.some(f=>f.factType==="task"),
      "raw prompt text must not be exported as an observation");
    assert.ok(!JSON.stringify(frame).includes("Private customer request"),
      "neither an evidence frame nor a proof may leak the user task");
    assert.equal((frame as any).targetOoC,undefined);
    assert.equal((frame as any).authorizedToExecute,undefined);
  }finally{x.cleanup();}
});
test("support replacement, unchanged replay and scope reset have explicit retraction receipts",()=>{
  const x=setup(),feed=new PiObservationFeed();
  try{
    const first=revise("same-source",newSource,oldSource);
    feed.capture("event:1",first,x.session.observe(first));
    const replay=feed.capture("event:2",first,x.session.observe(first));
    assert.equal(replay.retracted.length,0,"unchanged facts must not retract");
    const clean=revise("same-source",oldSource,oldSource);
    const newer=feed.capture("event:3",clean,x.session.observe(clean));
    assert.ok(newer.retracted.some(f=>f.factType==="change"&&
      f.factArgs[1]==="domain_to_integration_import_added"),"removed delta is explicit");
    assert.equal(newer.observed.some(f=>f.factType==="change"&&
      f.factArgs[1]==="domain_to_integration_import_added"),false);
    const reset=feed.invalidate("reset:4");
    assert.equal(reset.length,1);
    assert.equal(reset[0]!.event.point,"scope_reset");
    assert.equal(reset[0]!.event.origin,"pi-session-lifecycle");
    assert.ok(reset[0]!.retracted.some(f=>f.factType==="file_kind"));
    assert.equal(feed.invalidate("reset:5").length,0);
  }finally{x.cleanup();}
});
test("same typed fact with revised source bytes retracts obsolete source support",()=>{
  const x=setup(),feed=new PiObservationFeed();
  try{
    const old=revise("revised-bytes",newSource,oldSource);
    const before=feed.capture("bytes:old",old,x.session.observe(old));
    const changed=revise("revised-bytes",newSource+"// additional commentary\n",oldSource);
    const after=feed.capture("bytes:new",changed,x.session.observe(changed));
    assert.notEqual(after.event.sourceDigest,before.event.sourceDigest);
    assert.equal(after.event.sourceState,"PROPOSED");
    assert.ok(after.retracted.some(f=>f.factType==="code_construct"&&
      f.sourceDigest===before.event.sourceDigest),
      "a changed source must invalidate earlier source-bound evidence even if its predicate stays true");
    assert.ok(after.observed.some(f=>f.factType==="code_construct"&&
      f.sourceDigest===after.event.sourceDigest));
  }finally{x.cleanup();}
});
test("detector evidence carries independent supports and a later retraction",()=>{
  const x=setup(),feed=new PiObservationFeed();
  const base:ContextObservation={
    scope:"review:orders",task:"Review route",path,operation:"review",
    origin:"detector-result",provenance:"actual verified source detector",
    revision:"a".repeat(40),findings:[
      {code:"outward_layer_import",detectorId:"detector.one",evidenceId:"proof:1",
        file:path,revision:"a".repeat(40)},
      {code:"outward_layer_import",detectorId:"detector.two",evidenceId:"proof:2",
        file:path,revision:"a".repeat(40)},
    ],
  };
  try{
    const first=feed.capture("detector:1",base,x.session.observe(base));
    assert.equal(first.event.point,"review");
    assert.equal(first.observed.filter(f=>f.factType==="finding").length,2);
    const second={...base,findings:base.findings!.slice(1)};
    const after=feed.capture("detector:2",second,x.session.observe(second));
    assert.equal(after.retracted.filter(f=>f.factType==="finding").length,1);
    assert.equal(after.observed.filter(f=>f.factType==="finding").length,1);
    assert.ok(after.receipts.some(r=>r.conventionId==="coder.architecture.hierarchy-import"));
    const closed=feed.retractScope("detector:3",base.scope,"clean validator");
    assert.equal(closed?.event.point,"scope_retraction");
    assert.equal(closed?.retracted.filter(f=>f.factType==="finding").length,1);
  }finally{x.cleanup();}
});
test("missing or incomplete evidence never turns into NO_MATCH or admitted OoC",()=>{
  const x=setup(),feed=new PiObservationFeed();
  try{
    const partial=revise("partial","import {",oldSource);
    const result=x.session.observe(partial);
    const frame=feed.capture("evt:1",partial,result);
    assert.ok(frame.missing.some(x=>x.reason==="partial_source_parse"));
    assert.ok(frame.unknownFacts.includes("source"));
    assert.equal(frame.disposition,"observation_only_no_authority");
    assert.throws(()=>feed.capture("!",partial,result),/event identity/);
    assert.throws(()=>feed.capture("evt:2",{...partial,scope:"another"},result),
      /scope mismatch/);
    assert.throws(()=>x.session.observe({...partial,phase:"GREEN"}),/trusted provider/);
  }finally{x.cleanup();}
});
test("mandatory dependencies remain source-authored and not Driver influence",()=>{
  const x=setup(),feed=new PiObservationFeed();
  try{
    const input:ContextObservation={scope:"track:branch",task:"Make a change to tracked code",
      operation:"edit",origin:"pi-event",path:"src/feature.ts",
      provenance:"Pi source edit",sourceText:"export const feature=1;"};
    const out=x.session.observe(input);
    const frame=feed.capture("event:tracker",input,out);
    for(const receipt of frame.receipts)for(const edge of receipt.mandatoryRequires)
      assert.equal(edge.constraint,"mandatory");
    assert.equal(frame.disposition,"observation_only_no_authority");
    assert.ok(!JSON.stringify(frame).includes('"kind":"ADMITTED"'));
    // The semantic OoC contract is deliberately NOT evaluated in this observer.
  }finally{x.cleanup();}
});
