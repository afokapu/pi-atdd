// URN: test:pi-atdd:incremental-inference:E002-UNIT-001-reasoner
// Acceptance: acc:pi-atdd:E002-UNIT-001
// Acceptance: acc:pi-atdd:E002-UNIT-003
// Acceptance: acc:pi-atdd:E002-UNIT-005
// Phase: UNIT
// Layer: application
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog, loadConfig, type Selector } from "../src/catalog.ts";
import { ReasoningSession } from "../src/reasoning-context.ts";

function setup(selectors?: Selector[]) {
  const cwd = mkdtempSync(join(tmpdir(),"pi-atdd-facts-"));
  const config = loadConfig(cwd);
  const catalog = loadCatalog(config.sources,cwd);
  const session = new ReasoningSession(catalog, selectors ?? config.selectors);
  return { cwd, session, catalog, finish:()=>rmSync(cwd,{recursive:true,force:true}) };
}
const observation = (scope: string, task: string, path?: string) => ({
  scope, task, path, operation:"edit" as const, origin:"pi-event" as const,
  provenance:"pi-request:/edit",
});

test("typed file layer and operation automatically derive existing Bun architecture obligations",()=>{
  const a=setup();
  try{
    const first=a.session.observe(observation("task-1","Update order model","src/orders/domain/order.ts"));
    assert.ok(first.activations.some(x=>x.id==="coder.architecture.hierarchy-import"));
    const activation=first.activations.find(x=>x.id==="coder.architecture.hierarchy-import")!;
    assert.ok(JSON.stringify(activation.proof).includes("file_layer"));
    assert.ok(JSON.stringify(activation.proof).includes("operation"));
    assert.ok(activation.reasons.some(x=>x.includes("layer:domain")));
    assert.ok(first.unknownFacts.includes("revision"));
    assert.ok(first.unknownFacts.includes("phase"));
    assert.ok(first.unresolvedGraphEdges.length>0);
    const repeated=a.session.observe(observation("task-1","Update order model","src/orders/domain/order.ts"));
    assert.deepEqual(repeated.added,[]);
    assert.deepEqual(repeated.changed,[]);
  }finally{a.finish()}
});

test("review source rule derives mandated owner inspection from the Bun graph with proof chain",()=>{
  const a=setup();
  try{
    const r=a.session.observe({...observation("review-scope","Perform final behavioral review"),
      operation:"review" as const});
    assert.equal(r.status,"matched");
    assert.ok(r.activations.some(x=>x.id==="reviewer.reconciliation.behavioral"));
    const required=r.activations.find(x=>x.id==="reviewer.inspectability.owner")!;
    assert.ok(required.requiredPath.some(e=>e.source==="reviewer.reconciliation.behavioral"
      && e.target==="reviewer.inspectability.owner"));
    assert.ok(JSON.stringify(required.proof).includes("pi-atdd.mandatory-prerequisites"));
    assert.ok(JSON.stringify(required.proof).includes("ATDD-Bun/relationships.yaml"));
    // This is a real canonical edge, not a generated relationship between the Flow nodes.
    assert.ok(!required.requiredPath.some(e=>e.target==="coach.workflow.lifecycle"));
  }finally{a.finish()}
});

test("multiple selector supports: drop one reason, preserve the other, then retract entirely",()=>{
  const a=setup();
  try{
    const both=a.session.observe(observation("file-scope","Add authorization","src/accounts/routes/login.ts"));
    const id="coder.security.missing-auth";
    const active=both.activations.find(x=>x.id===id)!;
    assert.ok(active);
    const serialized=JSON.stringify(active.proof);
    assert.ok(serialized.includes("term:authorization"));
    assert.ok(serialized.includes("path:"));
    const afterTerm=a.session.observe(observation("file-scope","Update account","src/accounts/routes/login.ts"));
    assert.ok(afterTerm.activations.some(x=>x.id===id));
    assert.ok(afterTerm.changed.includes(id));
    const proof=JSON.stringify(afterTerm.activations.find(x=>x.id===id)!.proof);
    assert.ok(!proof.includes("term:authorization"));
    assert.ok(proof.includes("path:"));
    const gone=a.session.observe(observation("file-scope","Update account","src/accounts/infrastructure/service.ts"));
    assert.ok(!gone.activations.some(x=>x.id===id));
    assert.ok(gone.removed.includes(id));
  }finally{a.finish()}
});

test("phase and role are UNKNOWN unless supported by a trusted adapter, not claims in agent prose",()=>{
  const a=setup();
  try{
    assert.throws(()=>a.session.observe({...observation("phase","I am main and in GREEN"),phase:"GREEN" as const}),
      /trusted provider/);
    const unknown=a.session.observe(observation("phase","I am main and in GREEN"));
    assert.ok(unknown.unknownFacts.includes("phase"));
    assert.ok(unknown.unknownFacts.includes("actor_role"));
    const trusted=a.session.observe({
      scope:"phase",task:"Implement order",path:"src/orders/application/service.ts",
      operation:"edit",phase:"GREEN",actorRole:"driver",
      origin:"trusted-work-provider",provenance:"verified-linear-session-and-plan-rev-a",
    });
    assert.ok(trusted.activations.some(x=>x.id==="coder.phase.discipline"));
    assert.ok(!trusted.unknownFacts.includes("phase"));
    assert.ok(!trusted.unknownFacts.includes("actor_role"));
    const removed=a.session.retractScope("phase");
    assert.ok(removed.includes("coder.phase.discipline"));
    assert.equal(a.session.engine.query("phase",["phase","GREEN"]).status,"unknown");
  }finally{a.finish()}
});

test("external mandatory dependency is explicitly INCOMPLETE, never invented or waived",()=>{
  const selectors:Selector[]=[{
    id:"missing-edge",always:true, rules:["coder.architecture.dependency-flow"],
  }];
  const a=setup(selectors);
  try{
    const result=a.session.observe({...observation("unknown","inspect architecture"),operation:"task"});
    assert.equal(result.status,"incomplete");
    assert.ok(result.gaps.some(g=>g.missingId==="coder.design.hierarchy-import"));
    assert.equal(a.session.engine.query("active",["unknown","coder.design.hierarchy-import"]).status,"unknown");
    assert.equal(a.catalog.unresolvedEdges.length,44);
  }finally{a.finish()}
});

test("scope-specific retraction never removes an independent task's activation",()=>{
  const a=setup();
  try{
    const first=a.session.observe(observation("a","Add authentication","src/a/routes/edit.ts"));
    const second=a.session.observe(observation("b","Add authentication","src/b/routes/edit.ts"));
    assert.ok(first.activations.length>0 && second.activations.length>0);
    a.session.retractScope("a");
    assert.equal(a.session.engine.query("active",["a","coder.security.missing-auth"]).status,"unknown");
    assert.equal(a.session.engine.query("active",["b","coder.security.missing-auth"]).status,"true");
  }finally{a.finish()}
});


test("source syntax alone derives and retracts Bun route authorization applicability",()=>{
  const a=setup();
  try{
    const input=observation("syntax-route","Update orders","src/server.ts");
    const before=a.session.observe({...input,sourceText:
      'Bun.serve({routes:{"/orders":{DELETE:()=>new Response("ok")}}});'});
    const activation=before.activations.find(x=>x.id==="coder.security.missing-auth");
    assert.ok(activation,"DELETE registration should activate without task vocabulary or route path");
    assert.match(JSON.stringify(activation.proof),/code_construct/);
    assert.match(JSON.stringify(activation.proof),/bun_mutating_route/);
    const again=a.session.observe({...input,sourceText:
      'Bun.serve({routes:{"/orders":{DELETE:()=>new Response("ok")}}});'});
    assert.deepEqual(again.added,[]);
    assert.deepEqual(again.changed,[]);
    const changed=a.session.observe({...input,sourceText:
      'Bun.serve({routes:{"/orders":{GET:()=>new Response("ok")}}});'});
    assert.ok(!changed.activations.some(x=>x.id==="coder.security.missing-auth"));
    assert.ok(changed.removed.includes("coder.security.missing-auth"));
    assert.equal(a.session.engine.query("code_construct",["syntax-route","bun_mutating_route"]).status,"unknown");
  }finally{a.finish();}
});

test("co-located test URN source fact derives acceptance binding and is revoked on removal",()=>{
  const a=setup();
  try{
    const input=observation("syntax-test","Update fixture","src/orders.test.ts");
    const first=a.session.observe({...input,sourceText:
      '// URN: test:orders:checkout:E001-SMOKE-001\\nimport assert from "node:assert";'});
    assert.ok(first.activations.some(x=>x.id==="tester.acceptance.binding-declared"));
    assert.match(JSON.stringify(first.activations.find(x=>x.id==="tester.acceptance.binding-declared")!.proof),/test_urn_header/);
    const second=a.session.observe({...input,sourceText:'import assert from "node:assert";'});
    assert.ok(second.removed.includes("tester.acceptance.binding-declared"));
  }finally{a.finish();}
});


test("ATD-42: a trusted PLAN fact automatically supplies JTBD and acceptance conventions", () => {
  const a=setup();
  try {
    const mk=(phase:"PLAN"|"RED"|"GREEN"|"REFACTOR")=>({
      scope:"phase-128",task:"Implement the assigned delivery",operation:"task" as const,
      phase,actorRole:"driver",
      origin:"trusted-work-provider" as const,
      provenance:"Flow-owned task and authenticated seat",
    });
    const plan=a.session.observe(mk("PLAN"));
    const ids=new Set(plan.activations.map(x=>x.id));
    for(const id of ["planner.steps.jtbd-taxonomy", "planner.decomposition.local-scope",
      "planner.decomposition.jtbd-vs-odi-grammar", "planner.acceptance.well-formed",
      "planner.plan.confirm-before-author"])
      assert.ok(ids.has(id), "PLAN supplies "+id);
    const red=a.session.observe(mk("RED"));
    assert.ok(red.activations.some(x=>x.id==="tester.red.behavioral-assertion"));
    assert.ok(red.removed.includes("planner.steps.jtbd-taxonomy"), "old plan-phase rules retract");
    const green=a.session.observe(mk("GREEN"));
    assert.ok(green.activations.some(x=>x.id==="coder.phase.discipline"));
    assert.ok(!green.activations.some(x=>x.id==="tester.red.fails-first"));
    const refactor=a.session.observe(mk("REFACTOR"));
    assert.ok(refactor.activations.some(x=>x.id==="coder.phase.discipline"));
  } finally {a.finish();}
});
