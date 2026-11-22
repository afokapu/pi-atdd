// ATD-22 OBS-004: original source validator, not simulated tool output.
import test from "node:test";
import assert from "node:assert/strict";
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
test("non-source files do not receive source-architecture findings",()=>{
  const testFile=validateImportBoundary("tests/price.test.ts",bad,revision);
  assert.equal(testFile.status,"clean");assert.equal(testFile.findings.length,0);
  const vendor=validateImportBoundary("vendor/orders/domain/price.ts",bad,revision);
  assert.equal(vendor.status,"clean");assert.equal(vendor.findings.length,0);
});
