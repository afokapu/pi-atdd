// PLT-132: full source-locked graph reconciliation regression
// Acceptance: acc:pi-atdd:PLT-132-01-graph-inventory
// Acceptance: acc:pi-atdd:PLT-132-02-typed-reconciliation
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bundledSources, canonicalRuleId, loadCatalog, packageRoot, resolveContext } from "../src/catalog.ts";
import { ReasoningSession } from "../src/reasoning-context.ts";

function fullCatalog() {
  const sources = bundledSources();
  const graph = loadCatalog(sources, packageRoot, { today: "2026-11-23" });
  const registry = JSON.parse(readFileSync(join(packageRoot, "conventions/relationship-reconciliation.json"), "utf8"));
  return { graph, registry, sources };
}
function resultFor(rule: string) {
  const { graph } = fullCatalog();
  const session = new ReasoningSession(graph, [{ id: "plt-132-probe", always: true, operations: ["task"], rules: [rule] }]);
  return session.observe({scope: "plt-132:" + rule, task: "Source-qualified graph activation",
    operation: "task", origin: "pi-event", provenance: "PLT-132/test-controlled-entry"});
}

test("all 44 baseline graph references are adjudicated without changing the 522 authored edges", () => {
  const { graph, registry, sources } = fullCatalog();
  assert.equal(graph.rules.size, 376);
  assert.equal(graph.edges.length, 522);
  assert.equal(graph.unresolvedEdges.length, 0, "an unexpected endpoint must not slip past the pinned ledger");
  assert.equal(graph.externalEdges.length, 32, "external is NOT locally satisfied");
  assert.equal(graph.termEdges.length, 2);
  assert.equal(registry.baseline.rawUnresolved, 44);
  assert.equal(registry.baseline.legacyAliasEdges + registry.baseline.termEdges + registry.baseline.externalEdges, 44);
  assert.equal(registry.external.length, 32);
  assert.equal(graph.externalEdges.filter(e => e.kind === "external-normative-source").length, 14);
  assert.equal(graph.externalEdges.filter(e => e.kind === "external-realization").length, 18);
  assert.equal(registry.source.sha256, sources.find(s => s.id === "ATDD-Bun")!.sha256);
  assert.equal(canonicalRuleId(graph, "planner.acceptance.complete"), "planner.acceptance.well-formed");
  for (const ext of graph.externalEdges) {
    assert.equal(graph.rules.has(ext.source) && graph.rules.has(ext.target), false);
    assert.match(ext.providerRevision, /^[a-f0-9]{40}$/);
    assert.match(ext.providerBlobSha, /^[a-f0-9]{40}$/);
    assert.ok(ext.providerPath.endsWith("/" + ext.providerRuleId + ".convention.yaml"));
  }
});

test("the source-authorized acceptance alias has exact mandatory closure, not fabricated equivalence", () => {
  const r = resultFor("planner.acceptance.complete");
  const active = r.activations.map(a => a.id);
  assert.ok(active.includes("planner.acceptance.well-formed"));
  assert.ok(active.includes("planner.acceptance.abstract-fields-required"));
  assert.ok(active.includes("planner.acceptance.given-when-then-structure"));
  assert.ok(active.includes("planner.acceptance.harness-vocabulary"));
  assert.ok(active.includes("planner.acceptance.signal-telemetry-naming"));
  assert.equal(r.status, "matched");
});

test("term-qualified relationships retain their exact authored target and projected term", () => {
  const { graph } = fullCatalog();
  const termRefs = graph.termEdges.map(e => [e.originalTarget, e.target, e.targetTerm]);
  assert.deepEqual(termRefs.sort(), [
    ["planner.acceptance.harness#harness_type", "planner.acceptance.harness", "harness"],
    ["planner.acceptance.harness-vocabulary#harness_code", "planner.acceptance.harness-vocabulary", "harness_code"],
  ].sort());
  const r = resultFor("planner.desired-outcome.must-have-smoke-acceptance");
  const active = r.activations.map(a => a.id);
  assert.ok(active.includes("planner.acceptance.harness"));
  assert.ok(active.includes("planner.acceptance.harness-vocabulary"));
  assert.equal(r.gaps.length, 0);
});

test("cross-profile requires closes while other edge kinds do not become prerequisites", () => {
  const tester = resultFor("tester.e2e.exposed-journey-e2e-coverage");
  assert.ok(tester.activations.some(a => a.id === "planner.journey.definition"));
  const proof = tester.activations.find(a => a.id === "planner.journey.definition")!.requiredPath;
  assert.ok(proof.some(e => e.source === "tester.e2e.exposed-journey-e2e-coverage"
    && e.target === "planner.journey.definition" && e.type === "requires" && e.constraint === "mandatory"));
  const shared = resultFor("shared.convention.propose");
  assert.ok(shared.activations.some(a => a.id === "shared.convention.propose"));
  assert.ok(!shared.activations.some(a => a.id === "shared.tracker.issue-mandatory"),
    "runs_alongside must not be coerced into requires");
});

test("external mandatory requirements fail closed, never self-resolve or silently pass", () => {
  const { graph } = fullCatalog();
  const ext = graph.externalEdges.find(e => e.source === "coder.architecture.dependency-flow"
    && e.target === "coder.design.hierarchy-import");
  assert.ok(ext);
  assert.equal(ext!.kind, "external-realization");
  assert.equal(graph.rules.has(ext!.target), false);
  const r = resultFor("coder.architecture.dependency-flow");
  assert.equal(r.status, "incomplete");
  assert.ok(r.gaps.some(g => g.missingId === "coder.design.hierarchy-import"));
  const noSelf = graph.edges.filter(e => e.type === "requires"
    && e.constraint === "mandatory" && e.source === e.target);
  assert.equal(noSelf.length, 0);
  assert.throws(() => resolveContext(graph,
    [{ id:"external-closure", always:true, rules:["coder.architecture.dependency-flow"] }],
    "External prerequisite cannot be marked satisfied", [], "task"), /unresolved mandatory dependency/);
});

test("all fully internal mandatory relationships are acyclic and provider-neutral", () => {
  const { graph } = fullCatalog();
  const local = graph.edges.filter(e => e.type === "requires" && e.constraint === "mandatory"
    && graph.rules.has(e.source) && graph.rules.has(e.target));
  assert.equal(local.length, 269);
  const next = new Map<string,string[]>();
  for (const e of local) next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
  const done = new Set<string>(), walking = new Set<string>();
  const visit = (id:string) => {
    assert.ok(!walking.has(id), "mandatory cycle at " + id);
    if(done.has(id)) return;
    walking.add(id);
    for(const to of next.get(id) ?? []) visit(to);
    walking.delete(id);
    done.add(id);
  };
  for (const id of graph.rules.keys()) visit(id);
});
