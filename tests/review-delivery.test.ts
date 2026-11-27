// URN: test:pi-atdd:activation-selectors:E004-UNIT-401-review-delivery
// Acceptance: acc:pi-atdd:E004-UNIT-401
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog, loadConfig, resolveContext } from "../src/catalog.ts";
import { loadPointers } from "../src/render-reasoning.ts";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const config = loadConfig(ROOT);
const catalog = loadCatalog(config.sources, ROOT);

test("review delivery is complete: paging through the context delivers every matched rule body", () => {
  const seen: string[] = [];
  let offset = 0, matched: string[] = [];
  for (let page = 0; page < 50; page++) {
    const ctx = resolveContext(catalog, config.selectors, "", ["plan/x/_x.yaml"], "review", 12, offset);
    matched = ctx.matchingIds;
    seen.push(...ctx.rules.map(r => r.id));
    if (ctx.nextOffset === null) break;
    assert.equal(ctx.truncated, true);
    assert.ok(ctx.nextOffset > offset, "paging must advance");
    offset = ctx.nextOffset;
  }
  assert.ok(matched.length > 12, "the review of a plan file matches more than one page");
  assert.deepEqual([...seen].sort(), [...matched].sort(), "delivered bodies equal matched ids");
  assert.ok(seen.includes("tester.topology.e2e-location"), "the reviewer receives e2e-location for a plan file");
});

test("the first page without an offset is unchanged, and an offset past the end is empty", () => {
  const first = resolveContext(catalog, config.selectors, "", ["plan/x/_x.yaml"], "review", 12);
  assert.equal(first.rules.length, 12);
  assert.equal(first.nextOffset, 12);
  const past = resolveContext(catalog, config.selectors, "", ["plan/x/_x.yaml"], "review", 12, 10_000);
  assert.deepEqual(past.rules, []);
  assert.equal(past.nextOffset, null);
});

test("the e2e pointer keeps the browser-spec exception of its convention", () => {
  const text = loadPointers()["tester.topology.e2e-location"]!;
  assert.match(text, /\.e2e\.ts/);
  assert.match(text, /UserSystemFlow|Journey:/);
  assert.match(text, /not .*Acceptance/i, "a browser spec uses the flow binding, not an Acceptance header");
});

test("plan pointers name <plan_root>, never a literal plan/ directory", () => {
  const p = loadPointers();
  for (const id of ["shared.topology.plan-location", "planner.capability.features"]) {
    assert.match(p[id]!, /<plan_root>\//, id);
    assert.doesNotMatch(p[id]!, /(^|[^_a-z])plan\//, id + " must not hard-code plan/");
  }
});
