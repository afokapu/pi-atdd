// Characterization audit for PLT-105. The authored labels are independent of the matcher.
// Missing intended activations are reported as gaps, not disguised as successful assertions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog, loadConfig } from "../src/catalog.ts";
import { ReasoningSession, type ContextObservation } from "../src/reasoning-context.ts";

type Profile = "planner" | "tester" | "coder" | "reviewer" | "coach" | "shared";
type Scenario = {
  key:string; profile:Profile; request:string; operation:ContextObservation["operation"];
  target:string; shouldActivate:boolean;
  path?:string; sourceText?:string; basis:string;
};
function setup() {
  const cwd=mkdtempSync(join(tmpdir(),"pi-atdd-ambiguity-"));
  const config=loadConfig(cwd);
  const catalog=loadCatalog(config.sources,cwd);
  return {session:new ReasoningSession(catalog,config.selectors),finish:()=>rmSync(cwd,{recursive:true,force:true})};
}
function probe(session:ReasoningSession, key:string, request:string,
  operation:ContextObservation["operation"], path?:string, sourceText?:string){
  return session.observe({scope:key,task:request,operation,path,sourceText,
    origin:"pi-event",provenance:"PLT-105/ambiguous-discovery-audit"});
}
const SCENARIOS: readonly Scenario[] = [
  {key:"planner-acceptance",profile:"planner",request:"Tighten up the promise before we build it.",
    operation:"edit",path:"plan/acceptances/payment.yaml",target:"planner.acceptance.given-when-then-structure",
    shouldActivate:true,basis:"Editing an authored acceptance should prompt acceptance structure guidance"},
  {key:"planner-docs",profile:"planner",request:"Keep the diagram and decision in sync.",
    operation:"edit",path:"docs/decisions/checkout.adoc",target:"planner.docs.reference-integrity",
    shouldActivate:true,basis:"Changing a documented decision warrants reference integrity guidance"},
  {key:"tester-urn",profile:"tester",request:"This check isn't convincing yet.",
    operation:"edit",path:"src/checkouts.test.ts",
    sourceText:'// URN: test:checkout:payment:E001-SMOKE-001\\nimport { test } from "bun:test";',
    target:"tester.acceptance.binding-declared",shouldActivate:true,
    basis:"A test carrying a URN must claim the acceptance it actually proves"},
  {key:"tester-no-urn",profile:"tester",request:"Prove checkout still behaves properly.",
    operation:"edit",path:"tests/checkout.test.ts",
    sourceText:'import { test } from "bun:test"; test("checkout",()=>{});',
    target:"tester.acceptance.binding-declared",shouldActivate:false,
    basis:"This specific binding rule explicitly excludes files with no URN; another test identity rule may apply"},
  {key:"coder-delete",profile:"coder",request:"Let old memberships disappear gracefully.",
    operation:"edit",path:"src/server.ts",
    sourceText:'const methods={DELETE:()=>new Response("ok")}; const routes={"/memberships":methods}; Bun.serve({routes});',
    target:"coder.security.missing-auth",shouldActivate:true,
    basis:"A mutating Bun route needs a per-handler authorization check"},
  {key:"coder-import",profile:"coder",request:"Simplify the price calculation.",
    operation:"edit",path:"src/orders/domain/price.ts",
    sourceText:'import { send } from "../integration/network"; export const price=()=>send();',
    target:"coder.architecture.hierarchy-import",shouldActivate:true,
    basis:"A domain module must not depend outward on integration"},
  {key:"reviewer-ambiguous",profile:"reviewer",request:"Can we hand this over now?",
    operation:"review",target:"reviewer.reconciliation.behavioral",shouldActivate:true,
    basis:"A final acceptance decision requires behavioral reconciliation, even without the word review"},
  {key:"reviewer-explicit",profile:"reviewer",request:"Review the assembled behavior before shipping.",
    operation:"review",target:"reviewer.reconciliation.behavioral",shouldActivate:true,
    basis:"Explicit final review request"},
  {key:"coach-messaging",profile:"coach",request:"Make sure everyone sees the latest answer.",
    operation:"edit",path:"src/runtime/messaging/inbox.ts",sourceText:"export const poll=()=>[];",
    target:"coach.collaboration.accountable-delegation",shouldActivate:true,
    basis:"Coordination delivery involves accountable agent messages"},
  {key:"coach-continuity",profile:"coach",request:"Keep the next worker going when this tab disappears.",
    operation:"task",target:"coach.workflow.lifecycle",shouldActivate:true,
    basis:"If the workflow profile is active, durable agent continuity invokes its lifecycle policy"},
  {key:"shared-brief",profile:"shared",request:"Set up another helper for this.",
    operation:"create",path:"src/agents/briefs/worker.yaml",
    target:"shared.model.tier-by-role",shouldActivate:true,
    basis:"A new worker brief calls for the model tier policy"},
  {key:"shared-proposal",profile:"shared",request:"This recurring choice should become a rule.",
    operation:"task",target:"shared.convention.propose",shouldActivate:true,
    basis:"Proposing a new engineering convention invokes the proposal governance"},
];

test("two ambiguous discovery cases per convention profile: capture candidate hits and gaps",()=>{
  const x=setup();
  try{
    const actuals: Record<string,{expected:boolean;matched:boolean;status:string;ids:string[]}>={};
    for(const c of SCENARIOS){
      const result=probe(x.session,c.key,c.request,c.operation,c.path,c.sourceText);
      const matches=result.activations.some(a=>a.id===c.target);
      actuals[c.key]={expected:c.shouldActivate,matched:matches,status:result.status,
        ids:result.activations.map(a=>a.id)};
      console.log("PROFILE_DISCOVERY_AUDIT "+JSON.stringify({
        case:c.key,profile:c.profile,request:c.request,expectedRule:c.target,
        expectedApplicable:c.shouldActivate,activated:matches,status:result.status,
        actualRules:result.activations.map(a=>a.id),reason:c.basis,
      }));
    }
    assert.equal(Object.keys(actuals).length,12);
    for(const profile of ["planner","tester","coder","reviewer","coach","shared"] as const)
      assert.equal(SCENARIOS.filter(c=>c.profile===profile).length,2);
    assert.equal(actuals["coder-delete"]!.matched,true,"AST should catch aliased DELETE route");
    assert.equal(actuals["tester-urn"]!.matched,true,"AST should catch co-located URN test");
    assert.equal(actuals["tester-no-urn"]!.matched,true,
      "Characterize existing broad path selector despite rule's URN exception");
    assert.equal(actuals["planner-acceptance"]!.matched,false,"Planner gap currently explicit");
    assert.equal(actuals["reviewer-ambiguous"]!.matched,false,"Review intent is not inferred from stage alone");
    const applicable=SCENARIOS.filter(c=>c.shouldActivate).length;
    const hits=SCENARIOS.filter(c=>c.shouldActivate&&actuals[c.key]!.matched).length;
    const spurious=SCENARIOS.filter(c=>!c.shouldActivate&&actuals[c.key]!.matched).length;
    console.log("PROFILE_DISCOVERY_TOTAL "+JSON.stringify({scenarios:SCENARIOS.length,
      profiles:6,expectedApplicable:applicable,observedExpectedHits:hits,
      missedApplicable:applicable-hits,overActivation:spurious}));
  } finally{x.finish();}
});

test("ambiguous multi-stage handoff task: discover evidence as work unfolds, not from the task",()=>{
  const x=setup();
  try{
    const request="Make the cancellation flow safe enough to ship, keep the checks honest, and leave a clear handoff.";
    const stages: Array<{id:string;op:ContextObservation["operation"];path?:string;source?:string;
      target?:string;expectedByIntent?:boolean}>=[
      {id:"task-start",op:"task"},
      {id:"Bun-write",op:"create",path:"src/server.ts",
        source:'const handlers={DELETE:()=>new Response("ok")}; const routes={"/memberships":handlers}; Bun.serve({routes});',
        target:"coder.security.missing-auth",expectedByIntent:true},
      {id:"test-write",op:"create",path:"src/membership.test.ts",
        source:'// URN: test:member:membership:E001-CANCEL-001\\nimport { test } from "bun:test";',
        target:"tester.acceptance.binding-declared",expectedByIntent:true},
      {id:"plan-write",op:"edit",path:"plan/acceptances/cancel.yaml",
        source:"given: membership active\\nwhen: cancellation requested\\nthen: membership removed\\n",
        target:"planner.acceptance.given-when-then-structure",expectedByIntent:true},
      {id:"domain-import",op:"edit",path:"src/membership/domain/state.ts",
        source:'import { gateway } from "../integration/gateway"; export const state=()=>gateway();',
        target:"coder.architecture.hierarchy-import",expectedByIntent:true},
      {id:"handoff",op:"task",target:"coach.workflow.lifecycle",expectedByIntent:true},
      {id:"final-review",op:"review",target:"reviewer.reconciliation.behavioral",expectedByIntent:true},
    ];
    let matched=0, missed=0;
    for(const stage of stages){
      const out=probe(x.session,"complex-"+stage.id,request,stage.op,stage.path,stage.source);
      const hit=!!stage.target && out.activations.some(a=>a.id===stage.target);
      if(stage.expectedByIntent)hit?matched++:missed++;
      console.log("COMPLEX_DISCOVERY_STAGE "+JSON.stringify({
        stage:stage.id,point:stage.op,status:out.status,expectedRule:stage.target??null,
        targetHit:hit,actualRules:out.activations.map(a=>a.id),
      }));
      // PLT-96 tracker rules (on main) match broad wording, so status may be "matched"; the ambiguous task still has no domain-rule evidence.
      if(stage.id==="task-start")assert.ok(out.activations.every(a=>a.id.startsWith("shared.")),"ambiguous task has no domain selector evidence");
      if(stage.id==="Bun-write")assert.ok(hit,"generic-path mutating route must activate");
      if(stage.id==="test-write")assert.ok(hit,"co-located URN test must activate");
    }
    console.log("COMPLEX_DISCOVERY_TOTAL "+JSON.stringify({
      stages:stages.length,expectedStageTargets:matched+missed,matched,missed}));
  }finally{x.finish();}
});

test("adversarial negated task wording can activate a lexical security rule on GET-only code",()=>{
  const x=setup();
  try{
    const result=probe(x.session,"negated","Do not touch authentication; change the public read text only.",
      "edit","src/pages.ts",'Bun.serve({routes:{"/catalog":{GET:()=>new Response("ok")}}});');
    const id="coder.security.missing-auth";
    const activation=result.activations.find(a=>a.id===id);
    console.log("NEGATED_LANGUAGE_AUDIT "+JSON.stringify({
      expectedApplicable:false,actualTriggered:!!activation,
      selectorEvidence:activation?.reasons.filter(s=>s.includes("term:"))??[],
      status:result.status,
    }));
    assert.ok(activation,"record existing lexical negation false-positive as a known discovery gap");
    assert.ok(activation.reasons.some(s=>s.includes("term:authentication")));
    assert.ok(!activation.reasons.some(s=>s.includes("bun_mutating_route")));
  }finally{x.finish();}
});
