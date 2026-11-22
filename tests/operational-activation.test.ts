// ATD-41 / OBS-001..004: independent operational fact and activation characterization.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog, loadConfig } from "../src/catalog.ts";
import { ReasoningSession, type ContextObservation } from "../src/reasoning-context.ts";
import { observationEnvelope } from "../tools/atd-41-observation-envelope.ts";

const DOMAIN = "src/orders/domain/price.ts";
const BASE = 'export const price = () => 4;\n';
const IMPORT = 'import { gateway } from "../integration/network";\n' + BASE;
const ARCH = "coder.architecture.hierarchy-import";

function setup() {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-observed-facts-"));
  const config = loadConfig(cwd);
  const catalog = loadCatalog(config.sources, cwd);
  return { session: new ReasoningSession(catalog, config.selectors),
    finish: () => rmSync(cwd, { recursive:true, force:true }) };
}
const event = (scope:string, path:string, sourceText?:string, priorSourceText?:string):ContextObservation => ({
  scope, path, sourceText, priorSourceText, task:"Simplify the price calculation",
  operation:"edit", origin:"pi-event", provenance:"ATD-41 Pi pre-edit",
  revision:"git:example-revision",
});
function has(result:ReturnType<ReasoningSession["observe"]>, id:string) {
  return result.activations.some(x=>x.id===id);
}
function proof(result:ReturnType<ReasoningSession["observe"]>, id:string) {
  return JSON.stringify(result.activations.find(x=>x.id===id)?.proof ?? null);
}

test("a before/after import emits typed change, source evidence and exact activation proof",()=>{
  const x=setup();
  try {
    const input=event("import",DOMAIN,IMPORT,BASE);
    const out=x.session.observe(input);
    assert.equal(has(out,ARCH),true);
    assert.equal(out.observedFacts.some(f=>f.predicate==="change" &&
      f.args[1]==="domain_to_integration_import_added"),true);
    assert.equal(out.observedFacts.some(f=>f.predicate==="file_kind"&&f.args[1]==="source"),true);
    assert.match(proof(out,ARCH),/pi-atdd.typed-domain-integration-change-edit/);
    assert.match(proof(out,ARCH),/before_after:domain_to_integration_import_added/);
    const env=observationEnvelope("pi-001",input,out);
    assert.equal(env.disposition,"observation_only_no_authority");
    assert.equal(env.event.repositoryRevision,input.revision);
    assert.ok(env.observed.some(f=>f.kind==="change"));
    assert.ok(env.receipts.some(f=>f.conventionId===ARCH&&f.sourceDigest?.length===64));
    assert.deepEqual(x.session.observe(input).added,[]);
    assert.deepEqual(x.session.observe(input).changed,[]);
  }finally{x.finish();}
});

test("delta/retraction: source change support disappears without erasing independent path proof",()=>{
  const x=setup();
  try {
    const both=x.session.observe(event("mutable",DOMAIN,IMPORT,BASE));
    assert.equal(has(both,ARCH),true);
    assert.match(proof(both,ARCH),/domain_to_integration_import_added/);
    const noDelta=x.session.observe(event("mutable",DOMAIN,IMPORT,IMPORT));
    assert.equal(has(noDelta,ARCH),true);
    assert.ok(noDelta.changed.includes(ARCH));
    assert.doesNotMatch(proof(noDelta,ARCH),/domain_to_integration_import_added/);
    const removed=x.session.observe(event("mutable","src/orders/application/price.ts",BASE,IMPORT));
    assert.equal(has(removed,ARCH),false);
    assert.ok(removed.removed.includes(ARCH));
    assert.equal(x.session.engine.query("change",["mutable","domain_to_integration_import_added"]).status,"unknown");
  }finally{x.finish();}
});

test("unknown priors, partial code and untrusted phase never become false, waivers or a fabricated phase",()=>{
  const x=setup();
  try{
    const unobserved=x.session.observe(event("unknown",DOMAIN,IMPORT));
    assert.ok(unobserved.missingReasons.some(g=>g.fact==="change"&&g.reason==="prior_source_unavailable"));
    assert.equal(unobserved.observedFacts.some(f=>f.predicate==="change"),false);
    assert.ok(unobserved.unknownFacts.includes("phase"));
    const parse=x.session.observe(event("unknown",DOMAIN,"import {",BASE));
    assert.ok(parse.missingReasons.some(g=>g.reason==="partial_source_parse"));
    assert.equal(parse.observedFacts.some(f=>f.predicate==="change"),false);
    const dynamic=x.session.observe(event("unknown",DOMAIN,
      BASE+'const loader=import("../integration/network");\n',BASE));
    assert.ok(dynamic.missingReasons.some(g=>g.fact==="change" &&
      g.reason==="dynamic_import_uninspected"));
    assert.ok(dynamic.unknownFacts.includes("change"));
    assert.equal(dynamic.observedFacts.some(f=>f.predicate==="change"),false);
    assert.throws(()=>x.session.observe({...event("x",DOMAIN,IMPORT,BASE),phase:"GREEN"}),/trusted provider/);
    assert.throws(()=>x.session.observe({...event("x",DOMAIN,IMPORT,BASE),
      origin:"trusted-work-provider",phase:"GREEN",revision:undefined}),/pinned revision/);
    const trusted=x.session.observe({...event("trusted",DOMAIN,BASE),
      origin:"trusted-work-provider",phase:"GREEN",revision:"coordinator:revision-1"});
    assert.ok(trusted.observedFacts.some(f=>f.predicate==="phase"&&f.args[1]==="GREEN"));
    assert.equal(trusted.unknownFacts.includes("phase"),false);
  }finally{x.finish();}
});

test("detector findings are revision-bound reviewer evidence and independent supports retract correctly",()=>{
  const x=setup();
  try{
    const input:ContextObservation={scope:"review",task:"Inspect boundary",path:DOMAIN,
      operation:"review",origin:"detector-result",provenance:"validated detector adapter",
      revision:"revision:a",findings:[
        {code:"domain_to_integration_import",detectorId:"detector.a",evidenceId:"fact-1",
          file:DOMAIN,revision:"revision:a"},
        {code:"domain_to_integration_import",detectorId:"detector.b",evidenceId:"fact-2",
          file:DOMAIN,revision:"revision:a"},
      ]};
    const first=x.session.observe(input);
    assert.ok(has(first,ARCH));
    const node=first.activations.find(a=>a.id===ARCH)!;
    assert.match(JSON.stringify(node.proof),/detector:detector\.a/);
    assert.match(JSON.stringify(node.proof),/detector:detector\.b/);
    assert.ok(first.observedFacts.filter(f=>f.predicate==="finding").length===2);
    const second=x.session.observe({...input,findings:input.findings!.slice(1)});
    assert.ok(has(second,ARCH));
    assert.ok(second.changed.includes(ARCH));
    assert.doesNotMatch(proof(second,ARCH),/detector:detector\.a/);
    assert.match(proof(second,ARCH),/detector:detector\.b/);
    const none=x.session.observe({scope:"review",task:"Inspect boundary",path:"src/other.ts",
      operation:"review",origin:"pi-event",provenance:"Pi final review"});
    assert.ok(none.removed.includes(ARCH));
    assert.throws(()=>x.session.observe({...input,revision:"revision:b"}),/mismatched detector/);
    assert.throws(()=>x.session.observe({...input,origin:"pi-event"}),/detector findings require/);
  }finally{x.finish();}
});

test("path-only architecture guidance remains distinct from a structural finding",()=>{
  const x=setup();
  try {
    const contextual=x.session.observe(event("known-clean",DOMAIN,BASE,BASE));
    assert.equal(has(contextual,ARCH),true,
      "existing PLT-78 domain-edit guidance is retained for compatibility");
    assert.doesNotMatch(proof(contextual,ARCH),
      /pi-atdd.typed-(?:domain-integration|outward-layer-import)/,
      "contextual guidance must not masquerade as a witnessed forbidden dependency");
    const missing=x.session.observe(event("missing-architecture-source",DOMAIN));
    assert.equal(has(missing,ARCH),true);
    assert.ok(missing.unknownFacts.includes("source"));
  }finally{x.finish();}
});

test("labeled fires/doesNotFire replays distinguish structural coverage from legacy selector false positives",()=>{
  const x=setup();
  const samples:Array<{id:string;shouldFire:boolean;operation:ContextObservation["operation"];
    task:string;path:string;source:string;prior?:string;target:string;structural:boolean}>=[
    {id:"import-added",shouldFire:true,operation:"edit",task:"Adjust price",path:DOMAIN,
      source:IMPORT,prior:BASE,target:ARCH,structural:true},
    {id:"internal-only",shouldFire:false,operation:"edit",task:"Adjust price",
      path:"src/orders/application/price.ts",source:BASE,prior:BASE,target:ARCH,structural:false},
    {id:"bun-delete",shouldFire:true,operation:"edit",task:"Tweak response",path:"src/server.ts",
      source:'Bun.serve({routes:{"/x":{DELETE:()=>new Response("ok")}}});',
      target:"coder.security.missing-auth",structural:true},
    {id:"bun-get-only",shouldFire:false,operation:"edit",task:"Tweak response",path:"src/server.ts",
      source:'Bun.serve({routes:{"/x":{GET:()=>new Response("ok")}}});',
      target:"coder.security.missing-auth",structural:false},
    {id:"test-urn",shouldFire:true,operation:"edit",task:"Tweak check",path:"src/sample.test.ts",
      source:'// URN: test:sample:checkout:E001-SMOKE-001\nimport { test } from "bun:test";',
      target:"tester.acceptance.binding-declared",structural:true},
    {id:"negated-lexical",shouldFire:false,operation:"edit",task:"Do not touch authentication; change only text",
      path:"src/pages.ts",source:'Bun.serve({routes:{"/x":{GET:()=>new Response("ok")}}});',
      target:"coder.security.missing-auth",structural:false},
  ];
  try{
    let hits=0,misses=0,spurious=0;
    for(const c of samples){
      const out=x.session.observe({scope:"label:"+c.id,operation:c.operation,task:c.task,
        path:c.path,sourceText:c.source,priorSourceText:c.prior,
        origin:"pi-event",provenance:"ATD-41 fixture "+c.id});
      const actual=has(out,c.target);
      const p=proof(out,c.target);
      const structure=/(domain_to_integration_import|bun_mutating_route|test_urn_header)/.test(p);
      if(c.shouldFire && actual)hits++;
      if(c.shouldFire && !actual)misses++;
      if(!c.shouldFire && actual)spurious++;
      assert.equal(structure,c.structural,"structural support mismatch "+c.id);
      if(c.id!=="negated-lexical")assert.equal(actual,c.shouldFire,c.id);
      console.log("ATD41_LABELED_REPLAY "+JSON.stringify({
        case:c.id,expect:c.shouldFire,actual,structuralSupport:structure,
        status:out.status,missing:out.missingReasons.map(x=>x.fact+":"+x.reason),
      }));
    }
    // Compatibility means the known negated-language lexical false positive
    // is counted, not quietly 'fixed' by suppressing authored path/term selectors.
    assert.deepEqual({hits,misses,spurious},{hits:3,misses:0,spurious:1});
  }finally{x.finish();}
});
