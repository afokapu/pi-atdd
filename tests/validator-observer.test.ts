// ATD-22 OBS-004: original source validator, not simulated tool output.
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {loadCatalog,loadConfig} from "../src/catalog.ts";
import {ReasoningSession} from "../src/reasoning-context.ts";
import {validateImportBoundary,IMPORT_BOUNDARY_DETECTOR} from "../src/validator-observer.ts";

const path="src/orders/domain/price.ts";
const revision="f".repeat(40);
const bad='import {service} from "../integration/gateway";\nexport const value=1;\n';
test("real source validator emits detector/file/revision and exact-content identity",()=>{
  const first=validateImportBoundary(path,bad,revision);
  assert.equal(first.status,"finding");
  assert.equal(first.detectorId,IMPORT_BOUNDARY_DETECTOR);
  assert.equal(first.findings.length,1);
  const hit=first.findings[0]!;
  assert.equal(hit.file,path);
  assert.equal(hit.revision,revision);
  assert.equal(hit.detectorId,IMPORT_BOUNDARY_DETECTOR);
  assert.match(hit.evidenceId,/^sha:[0-9a-f]{64}$/);
  assert.equal(validateImportBoundary(path,bad,revision).findings[0]?.evidenceId,hit.evidenceId);
  assert.notEqual(validateImportBoundary(path,bad+"// changed\n",revision).findings[0]?.evidenceId,
    hit.evidenceId,"same HEAD with changed worktree bytes cannot reuse a stale detector receipt");
});
test("valid source negatives and unknowns never manufacture findings",()=>{
  const clean=validateImportBoundary(path,'import {a} from "../domain/a";\n',revision);
  assert.equal(clean.status,"clean");assert.equal(clean.findings.length,0);
  const alias=validateImportBoundary(path,'import {a} from "@/integration/a";\n',revision);
  assert.equal(alias.status,"unknown");
  assert.ok(alias.missingReasons.includes("unresolved_import_alias"));
  assert.equal(alias.findings.length,0);
  const parse=validateImportBoundary(path,"import {",revision);
  assert.equal(parse.status,"unknown");
  assert.ok(parse.missingReasons.includes("partial_source_parse"));
  const missing=validateImportBoundary(path,undefined,revision);
  assert.equal(missing.status,"unknown");
  assert.equal(validateImportBoundary(path,bad).status,"unknown","without trusted revision no finding exists");
  assert.equal(validateImportBoundary(path,bad,"user-claimed-revision").findings.length,0);
});
test("real validator sees application to presentation without inventing domain import",()=>{
  const invalid='import {Card} from "../presentation/Card";\n';
  const input=validateImportBoundary("src/orders/application/use.ts",invalid,revision);
  assert.equal(input.status,"finding");
  assert.equal(input.findings[0]?.code,"outward_layer_import");
  assert.equal(input.findings[0]?.detectorId,IMPORT_BOUNDARY_DETECTOR);
});
test("non-source files do not receive source-architecture findings",()=>{
  const testFile=validateImportBoundary("tests/price.test.ts",bad,revision);
  assert.equal(testFile.status,"clean");assert.equal(testFile.findings.length,0);
  const vendor=validateImportBoundary("vendor/orders/domain/price.ts",bad,revision);
  assert.equal(vendor.status,"clean");assert.equal(vendor.findings.length,0);
});

test("real validator receipts independently activate the source-locked reviewer reasoner",()=>{
  const cwd=mkdtempSync(join(tmpdir(),"pi-atdd-live-validator-review-"));
  try{
    const config=loadConfig(cwd),catalog=loadCatalog(config.sources,cwd);
    const session=new ReasoningSession(catalog,config.selectors);
    for(const [file,source,expectedRule] of [
      [path,bad,"pi-atdd.typed-detector-architecture-review"],
      ["src/orders/application/use.ts",'import {Card} from "../presentation/Card";\\n',
        "pi-atdd.typed-detector-outward-review"],
    ] as const){
      const run=validateImportBoundary(file,source,revision);
      assert.equal(run.status,"finding");
      const scope="validator-review:"+file;
      const result=session.observe({scope,task:"Inspect a source boundary",path:file,
        operation:"review",origin:"detector-result",
        provenance:"actual deterministic source validator",
        revision,findings:run.findings});
      const matched=result.activations.find(x=>x.id==="coder.architecture.hierarchy-import");
      assert.ok(matched,"validator finding must map to canonical architecture guidance");
      const proof=JSON.stringify(matched.proof);
      assert.ok(proof.includes(expectedRule),expectedRule);
      assert.ok(proof.includes(run.detectorId),"review proof needs the real detector identifier");
      assert.ok(proof.includes(run.findings[0]!.evidenceId),"proof needs exact source-byte identity");
      const removed=session.retractScope(scope);
      assert.ok(removed.includes("coder.architecture.hierarchy-import"));
      assert.equal(session.engine.query("active",[scope,"coder.architecture.hierarchy-import"]).status,
        "unknown","retracted validator evidence must not survive review");
    }
  }finally{rmSync(cwd,{recursive:true,force:true});}
});
