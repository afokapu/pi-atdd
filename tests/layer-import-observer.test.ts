// ATD-22 OBS-001/002: real parser situations, not prose-only matches.
import test from "node:test";
import assert from "node:assert/strict";
import {observeOutwardImports,roleInPath} from "../src/layer-import-observer.ts";

const base="export const unchanged=1;\n";
const cases=[
  {id:"domain-application",path:"src/orders/domain/price.ts",
    source:'import {use} from "../application/use";\n'+base,edge:"domain->application"},
  {id:"domain-integration",path:"src/orders/domain/price.ts",
    source:'import {gateway} from "../integration/gateway";\n'+base,edge:"domain->integration"},
  {id:"application-presentation",path:"src/orders/application/use.ts",
    source:'export {Card} from "../presentation/Card";\n'+base,edge:"application->presentation"},
  {id:"integration-presentation",path:"src/orders/integration/http.ts",
    source:'import {View} from "../presentation/View";\n'+base,edge:"integration->presentation"},
] as const;

test("all authored outward layer families have independent source/diff proofs",()=>{
  for(const c of cases){
    const hit=observeOutwardImports(c.path,c.source,base);
    assert.equal(hit.present,true,c.id);
    assert.equal(hit.added,true,c.id);
    assert.ok(hit.edges.includes(c.edge),c.id);
    assert.ok(hit.addedEdges.includes(c.edge),c.id);
    assert.equal(hit.deltaObserved,true,c.id);
    const unchanged=observeOutwardImports(c.path,c.source,c.source);
    assert.equal(unchanged.present,true,c.id);
    assert.equal(unchanged.added,false,c.id);
  }
});
test("authored negative conditions do not assert outward dependencies",()=>{
  const negatives=[
    ["src/orders/assembly/bootstrap.ts",'import {gateway} from "../integration/gateway";\n'],
    ["src/orders/domain/price.test.ts",'import {gateway} from "../integration/gateway";\n'],
    ["vendor/src/orders/domain/price.ts",'import {gateway} from "../integration/gateway";\n'],
    ["src/orders/domain/price.ts",'import ts from "typescript";\n'],
    ["src/orders/helpers.ts",'import {gateway} from "./integration/gateway";\n'],
  ] as const;
  for(const [path,source] of negatives){
    const result=observeOutwardImports(path,source+base,base);
    assert.equal(result.present,false,path);assert.equal(result.added,false,path);
  }
  assert.equal(roleInPath("src/orders/domain/price.ts"),"domain");
  assert.equal(roleInPath("src/orders/assembly/bootstrap.ts"),"assembly");
});
test("unknown aliases, dynamic modules, partial parses and missing source never become negative proof",()=>{
  const p="src/orders/domain/price.ts";
  const cases=[
    ['import x from "@/integration/client";\n',"unresolved_import_alias"],
    ['const x=import("../integration/client");\n',"dynamic_import_uninspected"],
    ['import {\n',"partial_source_parse"],
  ] as const;
  for(const [source,reason] of cases){
    const r=observeOutwardImports(p,source+base,base);
    assert.equal(r.present,false);
    assert.equal(r.deltaObserved,false);
    assert.ok(r.unknownReasons.includes(reason),reason);
  }
  assert.ok(observeOutwardImports(p,undefined,base).unknownReasons.includes("proposed_source_unavailable"));
});
