// Acceptance: acc:pi-atdd:PLT-84-SN-003
// Swap test: a differently structured fixture, only the profile changes, zero rule or selector edits.
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { loadCatalog, loadConfig, resolveContext } from "../src/catalog.ts";
import { loadProfile } from "../src/profile.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const catalog = loadCatalog(loadConfig(ROOT).sources, ROOT);
const bun = loadProfile(join(ROOT, "profiles/stacks/atdd-bun.json"));
const hex = loadProfile(join(ROOT, "tests/fixtures/swap/ts-hexagon.profile.json"));

// Each situation is role-level. The path is the same situation written in each fixture's own layout.
const SITUATIONS: { role: string; bun: string; hex: string; fires: string[]; doesNotFire: string[] }[] = [
  { role: "domain", bun: "src/pricing/domain/price.ts", hex: "app/core/price.ts", fires: ["coder.architecture.hierarchy-import", "coder.phase.discipline"], doesNotFire: ["tester.acceptance.binding-declared", "coder.security.missing-auth"] },
  { role: "integration", bun: "src/pricing/integration/repo.ts", hex: "app/adapters/repo.ts", fires: ["coder.architecture.hierarchy-import"], doesNotFire: ["coder.phase.discipline"] },
  { role: "application", bun: "src/pricing/application/quote.ts", hex: "app/usecases/quote.ts", fires: ["coder.phase.discipline"], doesNotFire: ["coder.architecture.hierarchy-import"] },
  { role: "boundary", bun: "src/pricing/routes/quote.ts", hex: "app/http/quote.ts", fires: ["coder.security.missing-auth"], doesNotFire: ["coder.architecture.hierarchy-import"] },
  { role: "unit_test", bun: "tests/price.test.ts", hex: "spec/price.test.ts", fires: ["tester.acceptance.binding-declared"], doesNotFire: ["coder.architecture.hierarchy-import"] },
  { role: "e2e_test", bun: "e2e/checkout.ts", hex: "journeys/checkout.ts", fires: ["tester.acceptance.binding-declared"], doesNotFire: ["coder.security.missing-auth"] },
];
const ids = (profile: typeof bun, path: string) => {
  const c = loadConfig(ROOT, profile);
  return new Set(resolveContext(catalog, c.selectors, "", [path], "edit", 100).matchingIds);
};

test("SN-003: the same role-level situations activate the same rules under both profiles", () => {
  for (const s of SITUATIONS) {
    const b = ids(bun, s.bun), h = ids(hex, s.hex);
    for (const r of s.fires) { assert.ok(b.has(r), s.role + " bun fires " + r); assert.ok(h.has(r), s.role + " hexagon fires " + r); }
    for (const r of s.doesNotFire) { assert.ok(!b.has(r), s.role + " bun does not fire " + r); assert.ok(!h.has(r), s.role + " hexagon does not fire " + r); }
    assert.deepEqual([...b].sort(), [...h].sort(), s.role + ": identical activation set");
  }
});

test("SN-003: a path in the other fixture's layout activates nothing (the profile, not the rule, decides)", () => {
  assert.equal(ids(hex, "src/pricing/domain/price.ts").has("coder.architecture.hierarchy-import"), false);
  assert.equal(ids(bun, "app/core/price.ts").has("coder.architecture.hierarchy-import"), false);
});

test("SN-003: the rules and selectors are identical across the swap (zero rule edits)", () => {
  const a = loadConfig(ROOT, bun), b = loadConfig(ROOT, hex);
  assert.deepEqual(a.sources, b.sources);
  assert.deepEqual(a.selectors.map(s => [s.id, s.rules]), b.selectors.map(s => [s.id, s.rules]));
});
