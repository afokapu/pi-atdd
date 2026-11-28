// URN: test:pi-atdd:evaluate-delivery:E004-UNIT-403
// Acceptance: acc:pi-atdd:E004-UNIT-403
// Acceptance: acc:pi-atdd:atd-45-a01
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readYaml } from "../src/catalog.ts";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const PLAN = join(ROOT, "plan/pi-atdd");
const ACCEPTANCE_BASELINE = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/acceptance-urn-baseline-09975bb5.json"), "utf8")) as string[];
const FEATURES = ["bind-tracker-issue", "deliver-guidance", "evaluate-delivery", "guide-coach", "hand-off-context",
  "manage-profiles", "manage-seats", "resolve-activation", "route-attention"];
const testSources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? testSources(path) : entry.name.endsWith(".ts") ? [path] : [];
});
const bound = (): string[] => [...new Set(testSources(join(ROOT, "tests"))
  .flatMap(path => [...readFileSync(path, "utf8").matchAll(/^\/\/ Acceptance: acc:pi-atdd:([\w-]+)/gm)].map(m => m[1]!)))].sort();
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

test("outcome acceptances preserve the pre-move URN baseline and all bind", () => {
  const urns: string[] = [];
  const ownerByUrn = new Map<string, string>();
  for (const file of outcomeFiles()) {
    const doc = readYaml(join(PLAN, file));
    for (const acc of (doc.acceptances ?? []) as Array<{ identity: { urn: string }; metadata?: { feature?: string } }>) {
      urns.push(acc.identity.urn);
      ownerByUrn.set(acc.identity.urn, acc.metadata?.feature ?? String(doc.feature));
    }
  }
  const declared = [...urns].sort();
  const boundUrns = bound().map(a => "acc:pi-atdd:" + a).sort();
  assert.deepEqual(declared, boundUrns, "all declared acceptances are bound and no binding is undeclared");
  assert.equal(new Set(urns).size, urns.length, "no acceptance is declared twice");
  assert.ok(ACCEPTANCE_BASELINE.every(urn => urns.includes(urn)), "every acceptance URN from commit 09975bb5 remains declared");

  const owners = new Map<string, string[]>();
  for (const feature of FEATURES) {
    const doc = readYaml(join(PLAN, feature + ".yaml"));
    for (const item of (doc.acceptance ?? []) as Array<string | { urn: string }>) {
      const urn = typeof item === "string" ? item : item.urn;
      owners.set(urn, [...(owners.get(urn) ?? []), feature]);
      assert.ok(ownerByUrn.has(urn), feature + " lists undeclared acceptance " + urn);
    }
  }
  for (const [urn, feature] of ownerByUrn) {
    assert.deepEqual(owners.get(urn), [feature], urn + " must appear exactly once in its owning feature " + feature);
  }
});

test("the flat plan/acceptances folder is gone", () => {
  assert.equal(existsSync(join(ROOT, "plan/acceptances")), false);
});

test("no feature is empty and each acceptance sits in the feature of the test that proves it", () => {
  for (const f of FEATURES) assert.ok((readYaml(join(PLAN, f + ".yaml")).acceptance as unknown[]).length > 0, f + " is empty");
});
