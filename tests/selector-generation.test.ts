// URN: test:pi-atdd:activation-selectors:E004-UNIT-401
// Acceptance: acc:pi-atdd:E004-UNIT-401
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog, loadConfig, resolveContext, readYaml } from "../src/catalog.ts";
import { generateSelectors, loadPolicy, renderGenerated } from "../src/selector-generation.ts";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const config = loadConfig(ROOT);
const catalog = loadCatalog(config.sources, ROOT);
const policy = loadPolicy(join(ROOT, "selectors/generation-policy.yaml"));
const generate = () => generateSelectors({ neutralRoot: join(ROOT, "conventions-neutral"), policy,
  ruleIds: new Set(catalog.rules.keys()), profile: config.profile,
  edges: catalog.edges, unresolvedEdges: catalog.unresolvedEdges });
const generated = generate();
const ids = (task: string, path: string, operation: string) =>
  resolveContext(catalog, config.selectors, task, [path], operation, 100).matchingIds;

test("the committed generated selectors equal a fresh generation (no hand edits, no drift)", () => {
  assert.equal(readFileSync(join(ROOT, "selectors/generated.yaml"), "utf8"), renderGenerated(generated.selectors));
});

test("every neutral rule with an observable file-kind fact is generated or reported, never dropped", () => {
  const r = generated.report;
  const accounted = new Set([...generated.selectors.flatMap(s => s.rules), ...r.notInCatalog, ...r.noMappableFact, ...r.blockedByUnresolved]);
  for (const id of r.withObservableFileKind) assert.ok(accounted.has(id), "silently dropped: " + id);
  assert.ok(r.withObservableFileKind.length > 200, "the generator must see the observable facts");
});

test("an edit of a plan, source or test file activates its topology rule, with roots taken from the profile", () => {
  assert.ok(ids("update", "plan/x/_x.yaml", "edit").includes("shared.topology.plan-location"));
  assert.ok(ids("update", "src/capabilities/x/features/y/z.ts", "edit").includes("shared.topology.source-location"));
  assert.ok(ids("update", "tests/x.test.ts", "edit").includes("tester.topology.test-location"));
  // the requires links pull plan-location in behind source and test location
  assert.ok(ids("update", "src/capabilities/x/features/y/z.ts", "edit").includes("shared.topology.plan-location"));
});

test("e2e-location reaches e2e files at edit, and plan files only at review (a plan edit is not an e2e change)", () => {
  const e2e = "tester.topology.e2e-location";
  assert.ok(!ids("update", "plan/x/_x.yaml", "edit").includes(e2e), "a plan edit must not carry the e2e rule");
  assert.ok(!ids("update", "plan/x/_x.yaml", "edit").includes("planner.journey.definition"));
  assert.ok(ids("update", "e2e/journeys/checkout.journey.test.ts", "edit").includes(e2e));
  assert.ok(ids("update", "e2e/journeys/checkout.journey.test.ts", "create").includes(e2e));
  assert.ok(ids("update", "plan/x/_x.yaml", "review").includes(e2e), "the reviewer still receives it for a changed plan file");
});

test("the edit-time page stays small enough to deliver in one page", () => {
  for (const p of ["plan/x/_x.yaml", "src/capabilities/x/features/y/z.ts", "tests/x.test.ts"])
    assert.ok(ids("update", p, "edit").length <= 12, p + " must not flood the edit page");
});

test("the review operation reaches more of the generated set than an edit does", () => {
  const review = ids("review", "plan/x/_x.yaml", "review");
  assert.ok(review.length > ids("update", "plan/x/_x.yaml", "edit").length, "review sees more than edit");
  assert.ok(review.includes("shared.topology.plan-location"));
});

test("generation is deterministic and ids are unique", () => {
  const again = generate();
  assert.equal(renderGenerated(again.selectors), renderGenerated(generated.selectors));
  const seen = new Set(generated.selectors.map(s => s.id));
  assert.equal(seen.size, generated.selectors.length);
  assert.equal(readYaml(join(ROOT, "selectors/generated.yaml")).schema, "pi-atdd/selectors/v1");
});
