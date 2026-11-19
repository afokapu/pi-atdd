import assert from "node:assert/strict";
import { resolve } from "node:path";
import { bundledSources, digestSource, loadCatalog, resolveContext, type SourceSpec, type Selector } from "../src/catalog.ts";

const bun = resolve(process.argv[2] || ".cache-sources/atdd-bun");
const flow = resolve(process.argv[3] || ".cache-sources/atdd-flow");
const sources: SourceSpec[] = [
  { id: "ATDD-Bun", path: bun, kind: "bun", revision: "5945d97e18310e7c862c08e73985400935d21346", sha256: digestSource(bun, "bun") },
  { id: "ATDD-Flow", path: flow, kind: "flow", revision: "2a66019a5ecf2b7a9f999ebfa04d04c9f548f19a", sha256: digestSource(flow, "flow") },
];
const bundled = bundledSources();
assert.equal(bundled.length, 2);
assert.equal(bundled[0]!.sha256, sources[0]!.sha256, "Bun bundle must be byte-identical to pinned upstream");
assert.equal(bundled[1]!.sha256, sources[1]!.sha256, "Flow bundle must be byte-identical to pinned upstream");
assert.equal(digestSource(bundled[0]!.path, "bun"), sources[0]!.sha256);
assert.equal(digestSource(bundled[1]!.path, "flow"), sources[1]!.sha256);
const catalog = loadCatalog(sources, process.cwd());
const offline = loadCatalog(bundled, process.cwd());
assert.equal(offline.rules.size, catalog.rules.size);
assert.deepEqual(offline.edges.map(e => [e.source, e.type, e.target]),
  catalog.edges.map(e => [e.source, e.type, e.target]));
assert.equal(catalog.rules.size, 358, "Pinned Bun catalog has 356 rules and Flow has 2");
assert.equal(catalog.edges.length, 508, "Pinned Bun graph has 508 authored relationships");
for (const id of [
  "coder.phase.discipline", "reviewer.reconciliation.behavioral",
  "reviewer.inspectability.owner", "coach.collaboration.accountable-delegation",
  "coach.workflow.lifecycle",
]) assert.ok(catalog.rules.has(id), "missing canonical rule " + id);
const selectors: Selector[] = [
  { id: "review", terms: ["behavioral review"], rules: ["reviewer.reconciliation.behavioral"] },
  { id: "flow", terms: ["coordinator"], rules: ["coach.workflow.lifecycle"] },
];
const ctx = resolveContext(catalog, selectors, "coordinator integration branch", [], "task");
assert.ok(ctx.matchingIds.includes("coach.workflow.lifecycle"));
console.log(JSON.stringify({
  status: "ok", bunRevision: sources[0]!.revision, flowRevision: sources[1]!.revision,
  conventions: catalog.rules.size, relationships: catalog.edges.length,
  unresolvedExternalReferences: catalog.unresolvedEdges.map(e => e.source + " -> " + e.target),
  provenance: catalog.provenance,
}, null, 2));
