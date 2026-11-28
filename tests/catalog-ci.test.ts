// URN: test:pi-atdd:resolve-activation:atd-50-catalog-ci
// Acceptance: acc:pi-atdd:plt-98-a01
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bundledSources, digestSource, loadCatalog, loadConfig, resolveContext, type Selector } from "../src/catalog.ts";

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

test("offline additions resolve cross-source dependencies without changing pinned bundles", () => {
  const cwd = mkdtempSync(join(tmpdir(), "atd-50-extra-"));
  try {
    const bundled = bundledSources();
    const lock = JSON.parse(readFileSync(new URL("vendor/catalog.lock.json", root), "utf8")) as {
      sources: Array<{ id: string; sha256: string }>;
    };
    const checkPinned = () => {
      for (const source of bundled) {
        const pin = lock.sources.find(s => s.id === source.id);
        assert.ok(pin, source.id);
        assert.equal(digestSource(source.path, source.kind), pin.sha256, source.id);
      }
    };
    checkPinned();
    const baseline = loadCatalog(bundled, cwd);
    mkdirSync(join(cwd, "extra/conventions"), { recursive: true });
    writeFileSync(join(cwd, "extra/conventions/local.checkpoint.convention.yaml"), [
      "schema_version: 1.1.0", "rule_id: local.checkpoint", "kind: policy", "status: active",
      "statement: Never lose work when handing over an agent session.", "content:",
      "  summary: Preserve exact handover evidence and recovery state.", "",
    ].join("\n"));
    writeFileSync(join(cwd, "extra/relationships.yaml"), [
      "schema_version: 1.0.0", "nodes:", "  - local.checkpoint", "edges:",
      "  - source_ref: local.checkpoint", "    target_ref: coach.collaboration.accountable-delegation",
      "    type: requires", "    constraint: mandatory", "    control: internal", "",
    ].join("\n"));
    const extraSha = digestSource(join(cwd, "extra"), "extension");
    writeFileSync(join(cwd, "atdd-pi.yaml"), [
      "schema: pi-atdd/config/v2", "extraSources:", "  - id: local-extra", "    path: extra",
      "    kind: extension", "    sha256: " + extraSha, "",
    ].join("\n"));
    const { sources } = loadConfig(cwd);
    const catalog = loadCatalog(sources, cwd);
    assert.equal(catalog.rules.size, baseline.rules.size + 1);
    assert.equal(catalog.edges.length, baseline.edges.length + 1);
    const selectors: Selector[] = [{ id: "checkpoint", terms: ["checkpoint-signal"], rules: ["local.checkpoint"] }];
    assert.deepEqual(resolveContext(catalog, selectors, "checkpoint-signal", [], "task").matchingIds,
      ["coach.collaboration.accountable-delegation", "local.checkpoint"]);
    checkPinned();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
