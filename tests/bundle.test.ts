import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundledSources, digestSource, loadCatalog, loadConfig, resolveContext, GraphError } from "../src/catalog.ts";

test("bundled canonical Bun and Flow snapshots resolve offline without consumer configuration", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-bundled-"));
  try {
    const { sources, selectors } = loadConfig(cwd);
    assert.equal(sources.length, 2);
    assert.equal(sources[0]!.revision, "5945d97e18310e7c862c08e73985400935d21346");
    assert.equal(sources[1]!.revision, "2a66019a5ecf2b7a9f999ebfa04d04c9f548f19a");
    for (const source of sources) assert.equal(digestSource(source.path, source.kind), source.sha256);
    const catalog = loadCatalog(sources, cwd);
    assert.equal(catalog.rules.size, 358);
    assert.equal(catalog.edges.length, 508);
    assert.equal(catalog.unresolvedEdges.length, 44);
    const review = resolveContext(catalog, selectors, "Final behavioral review", [], "task");
    assert.equal(review.status, "matched");
    assert.ok(review.matchingIds.includes("reviewer.reconciliation.behavioral"));
    assert.ok(review.matchingIds.includes("reviewer.inspectability.owner"));
    const workflow = resolveContext(catalog, selectors, "Jujutsu integration branch", [], "task");
    assert.ok(workflow.matchingIds.includes("coach.workflow.lifecycle"));
    const unmatched = resolveContext(catalog, selectors, "unrecognized-opaque-task", [], "task");
    assert.equal(unmatched.status, "unresolved");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("additional conventions and cross-source dependency edges can be added offline without altering bundled YAML", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-additional-"));
  try {
    mkdirSync(join(cwd, "extra/conventions"), { recursive: true });
    const file = join(cwd, "extra/conventions/local.checkpoint.convention.yaml");
    writeFileSync(file, [
      "schema_version: 1.1.0", "rule_id: local.checkpoint", "kind: policy", "status: active",
      "statement: Never lose work when handing over an agent session.", "content:",
      "  summary: Preserve exact handover evidence and recovery state.", ""
    ].join("\n"));
    writeFileSync(join(cwd, "extra/relationships.yaml"), [
      "schema_version: 1.0.0", "nodes:", "  - local.checkpoint", "edges:",
      "  - source_ref: local.checkpoint", "    target_ref: coach.collaboration.accountable-delegation",
      "    type: requires", "    constraint: mandatory", "    control: internal", ""
    ].join("\n"));
    const extensionSha = digestSource(join(cwd, "extra"), "extension");
    writeFileSync(join(cwd, "extras.yaml"), [
      "schema: pi-atdd/selectors/v1", "selectors:",
      "  - id: checkpoint", "    terms: [checkpoint-signal]",
      "    rules: [local.checkpoint]", ""
    ].join("\n"));
    writeFileSync(join(cwd, "atdd-pi.yaml"), [
      "schema: pi-atdd/config/v2", "extraSources:",
      "  - id: custom-conventions", "    path: extra", "    kind: extension",
      "    sha256: " + extensionSha, "extraSelectors: [extras.yaml]", ""
    ].join("\n"));
    const { sources, selectors } = loadConfig(cwd);
    assert.equal(sources.length, 3);
    const catalog = loadCatalog(sources, cwd);
    assert.equal(catalog.rules.size, 359);
    assert.equal(catalog.edges.length, 509);
    const context = resolveContext(catalog, selectors, "checkpoint-signal", [], "task");
    assert.deepEqual(context.matchingIds, ["coach.collaboration.accountable-delegation", "local.checkpoint"]);
    writeFileSync(file, readFileSync(file, "utf8") + "\n# drift\n");
    assert.throws(() => loadCatalog(sources, cwd), GraphError);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
