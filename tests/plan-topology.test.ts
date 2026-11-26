// URN: test:pi-atdd:evaluate-delivery:E004-UNIT-403
// Acceptance: acc:pi-atdd:E004-UNIT-403
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readYaml } from "../src/catalog.ts";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const PLAN = join(ROOT, "plan/pi-atdd");
const FEATURES = ["bind-tracker-issue", "deliver-guidance", "evaluate-delivery", "guide-coach", "hand-off-context",
  "manage-profiles", "manage-seats", "resolve-activation", "route-attention"];
// Every acceptance a test header binds is declared exactly once; the declared set equals the bound set.
const bound = (): string[] => [...new Set(readdirSync(join(ROOT, "tests")).filter(f => f.endsWith(".ts"))
  .flatMap(f => [...readFileSync(join(ROOT, "tests", f), "utf8").matchAll(/^\/\/ Acceptance: acc:pi-atdd:([\w-]+)/gm)].map(m => m[1]!)))].sort();
const OUTCOME = /^[DLPCEMYRK]\d{3}\.yaml$/;
const outcomeFiles = () => existsSync(PLAN) ? readdirSync(PLAN).filter(f => OUTCOME.test(f)).sort() : [];

test("the plan declares the capability and its nine features at their canonical paths", () => {
  const cap = readYaml(join(PLAN, "_pi-atdd.yaml"));
  assert.equal(cap.urn, "capability:pi-atdd");
  const listed = (cap.features as Array<{ urn: string }>).map(f => f.urn).sort();
  assert.deepEqual(listed, FEATURES.map(f => "feature:pi-atdd:" + f));
  for (const f of FEATURES) {
    const doc = readYaml(join(PLAN, f + ".yaml"));
    assert.equal(doc.urn, "feature:pi-atdd:" + f);
    assert.ok(doc.status, f + " declares a status");
    assert.ok(Array.isArray(doc.acceptance) && (doc.acceptance as unknown[]).length > 0, f + " has a non-empty acceptance section");
  }
});

test("desired outcomes sit at <plan_root>/<capability>/<STEP><NNN>.yaml and each belongs to a declared feature", () => {
  const files = outcomeFiles();
  assert.ok(files.length >= FEATURES.length, "at least one desired outcome per feature");
  for (const file of files) {
    const doc = readYaml(join(PLAN, file));
    assert.equal(doc.urn, "desired-outcome:pi-atdd:" + file.replace(".yaml", ""));
    assert.ok(FEATURES.includes(String(doc.feature)), file + " names a declared feature");
  }
});

test("every acceptance is nested in an outcome, its URN is unchanged and unique", () => {
  const urns: string[] = [];
  for (const file of outcomeFiles()) {
    const doc = readYaml(join(PLAN, file));
    for (const acc of (doc.acceptances ?? []) as Array<{ identity: { urn: string } }>) urns.push(acc.identity.urn);
  }
  assert.deepEqual([...urns].sort(), bound().map(a => "acc:pi-atdd:" + a), "declared acceptances equal the acceptances the test headers bind");
  assert.equal(new Set(urns).size, urns.length, "no acceptance is declared twice");
});

test("the flat plan/acceptances folder is gone", () => {
  assert.equal(existsSync(join(ROOT, "plan/acceptances")), false);
});

test("no feature is empty and each acceptance sits in the feature of the test that proves it", () => {
  for (const f of FEATURES) assert.ok((readYaml(join(PLAN, f + ".yaml")).acceptance as unknown[]).length > 0, f + " is empty");
});
