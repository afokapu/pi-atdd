// URN: test:pi-atdd:activation-selectors:E004-UNIT-401-pointers
// Acceptance: acc:pi-atdd:E004-UNIT-401
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPointers } from "../src/render-reasoning.ts";
import { loadCatalog, loadConfig } from "../src/catalog.ts";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const pointers = loadPointers();
const catalog = loadCatalog(loadConfig(ROOT).sources, ROOT);

test("every pointer names a catalog rule, starts with an imperative verb and keeps the path pattern", () => {
  assert.deepEqual(Object.keys(pointers).sort(), ["planner.capability.features", "shared.topology.plan-location",
    "shared.topology.source-location", "tester.test.carries-urn-identity", "tester.topology.e2e-location", "tester.topology.test-location"]);
  const pattern: Record<string, RegExp> = {
    "shared.topology.plan-location": /<plan_root>\/<capability>\/_<capability>\.yaml/,
    "shared.topology.source-location": /<source_root>\/<capability>\/features\/<feature>\//,
    "tester.topology.test-location": /<test_root>\/<capability>\/features\/<feature>\/\{unit,contract,integration\}\//,
    "planner.capability.features": /<plan_root>\/<capability>\/_features\.yaml/,
    "tester.test.carries-urn-identity": /\/\/ URN: test:\{capability\}:\{feature\}:\{ACCEPTANCE-ID\}/,
    "tester.topology.e2e-location": /<e2e_root>\/flow-routers\/<flow-router>\/<route>\.routes\.test\.ts/,
  };
  for (const [id, text] of Object.entries(pointers)) {
    assert.ok(catalog.rules.has(id), id + " is not in the catalog");
    assert.match(text, pattern[id]!, id + ": pointer lost its path pattern");
    assert.match(text, /^(Declare|Place|List|Add)\b/, id + ": a pointer starts with an imperative verb");
    assert.ok(text.length < 400, id + ": a pointer stays one short instruction");
  }
});

test("the convention statement still holds the location the pointer commands", () => {
  const stated = (id: string) => catalog.rules.get(id)!.statement;
  assert.ok(stated("shared.topology.plan-location").includes("<plan_root>/<capability>/_<capability>.yaml"));
  assert.ok(stated("shared.topology.source-location").includes("<source_root>/<capability>/features/<feature>/"));
  assert.ok(stated("tester.topology.test-location").includes("<test_root>/<capability>/features/<feature>/{unit,contract,integration}/"));
  assert.ok(stated("tester.test.carries-urn-identity").includes("// URN: test:{capability}:{feature}:{ACCEPTANCE-ID}"));
  assert.ok(catalog.rules.get("planner.capability.features")!.statement.includes("_features.yaml"));
  assert.ok(stated("tester.topology.e2e-location").includes("<e2e_root>/flow-routers/<flow-router>/<route>.routes.test.ts"));
});
