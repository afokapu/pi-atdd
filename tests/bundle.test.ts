import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundledSources, digestSource, loadCatalog, loadConfig, resolveContext, GraphError } from "../src/catalog.ts";

// PLT-98 pin: ids, kinds, revisions and digests come from vendor/catalog.lock.json, never from counts.
const PINNED = JSON.parse(readFileSync(new URL("../vendor/catalog.lock.json", import.meta.url), "utf8")) as {
  sources: Array<{ id: string; kind: string; revision?: string; sha256: string }>;
};
const pinnedTuples = (list: Array<{ id: string; kind: string; revision?: string; sha256: string }>) =>
  list.map(s => [s.id, s.kind, s.revision ?? null, s.sha256]);
const COACH_RULE_IDS = [
  "coach.naming.instance-label", "coach.policy.action-tiers", "coach.policy.unclear-risk-higher-tier",
  "coach.policy.trivial-request", "coach.policy.decision-log", "coach.role.orchestrate-not-build",
];

test("bundled canonical Bun and Flow snapshots resolve offline without consumer configuration", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-bundled-"));
  try {
    const { sources, selectors } = loadConfig(cwd);
    assert.deepEqual(pinnedTuples(sources), pinnedTuples(PINNED.sources), "bundled sources are exactly the pinned set");
    assert.equal(sources[2]!.id, "pi-atdd");
    assert.equal(sources[0]!.revision, "5945d97e18310e7c862c08e73985400935d21346");
    assert.equal(sources[1]!.revision, "2a66019a5ecf2b7a9f999ebfa04d04c9f548f19a");
    for (const source of sources) assert.equal(digestSource(source.path, source.kind), source.sha256);
    const catalog = loadCatalog(sources, cwd);
    for (const id of ["shared.convention.propose", "shared.model.tier-by-role", "shared.model.names-only-tiers",
      "shared.model.escalate-after-two-failures", "shared.model.subscription-providers"]) assert.ok(catalog.rules.has(id), id);
    for (const id of COACH_RULE_IDS) assert.ok(catalog.rules.has(id), id);
    assert.ok(catalog.rules.has("reviewer.reconciliation.behavioral"));
    assert.deepEqual(catalog.unresolvedEdges.filter(e => e.sourceFile.startsWith("pi-atdd/")), [], "package-authored edges all resolve");
    assert.ok(catalog.unresolvedEdges.every(e => e.sourceFile.startsWith("ATDD-Bun/")), "unresolved references stay upstream-only");
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
    assert.deepEqual(sources.map(s => s.id), [...PINNED.sources.map(s => s.id), "custom-conventions"]);
    const catalog = loadCatalog(sources, cwd);
    assert.ok(catalog.rules.has("local.checkpoint"));
    // relative to the bundled catalog: exactly one added rule and one added edge, whatever the bundle totals are
    const base = loadCatalog(bundledSources(), cwd);
    assert.equal(catalog.rules.size, base.rules.size + 1);
    assert.equal(catalog.edges.length, base.edges.length + 1);
    const context = resolveContext(catalog, selectors, "checkpoint-signal", [], "task");
    assert.deepEqual(context.matchingIds, ["coach.collaboration.accountable-delegation", "local.checkpoint"]);
    writeFileSync(file, readFileSync(file, "utf8") + "\n# drift\n");
    assert.throws(() => loadCatalog(sources, cwd), GraphError);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
