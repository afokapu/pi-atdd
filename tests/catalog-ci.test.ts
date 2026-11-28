// URN: test:pi-atdd:resolve-activation:atd-50-catalog-ci
// Acceptance: acc:pi-atdd:plt-98-a01
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { bundledSources, digestSource, loadCatalog, resolveContext, type Selector } from "../src/catalog.ts";

const root = new URL("../", import.meta.url);

test("CI runs offline catalog drift check without legacy checkouts or smoke script", () => {
  const workflow = readFileSync(new URL(".github/workflows/checks.yml", root), "utf8");
  const pkgText = readFileSync(new URL("package.json", root), "utf8");
  assert.doesNotMatch(workflow + pkgText, /atdd-bun|atdd-flow|smoke:catalog/i);
  assert.match(workflow, /npm run check/);
});

test("vendored lock pins sources, content and offline catalog resolution", () => {
  const lock = JSON.parse(readFileSync(new URL("vendor/catalog.lock.json", root), "utf8")) as {
    sources: Array<{ id: string; kind: string; revision?: string; sha256: string }>;
  };
  const bundled = bundledSources();
  const tuples = (sources: typeof lock.sources) => sources.map(s => [s.id, s.kind, s.revision ?? null, s.sha256]);
  assert.deepEqual(tuples(bundled), tuples(lock.sources));
  assert.deepEqual(bundled.map(s => s.id), ["ATDD-Bun", "ATDD-Flow", "pi-atdd"]);
  for (const s of bundled) assert.equal(digestSource(s.path, s.kind), s.sha256, s.id);
  const catalog = loadCatalog(bundled, process.cwd());
  for (const id of ["reviewer.reconciliation.behavioral", "reviewer.inspectability.owner",
    "coach.workflow.lifecycle", "shared.convention.propose"]) assert.ok(catalog.rules.has(id), id);
  const selectors: Selector[] = [
    { id: "review", terms: ["behavioral review"], rules: ["reviewer.reconciliation.behavioral"] },
    { id: "flow", terms: ["coordinator"], rules: ["coach.workflow.lifecycle"] },
  ];
  assert.ok(resolveContext(catalog, selectors, "coordinator integration branch", [], "task")
    .matchingIds.includes("coach.workflow.lifecycle"));
});
