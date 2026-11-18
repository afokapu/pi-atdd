import assert from "node:assert/strict";
import { resolve } from "node:path";
import { digestSource, loadCatalog, resolveContext, type SourceSpec, type Selector } from "../src/catalog.ts";

const bun = resolve(process.argv[2] || ".cache-sources/atdd-bun");
const flow = resolve(process.argv[3] || ".cache-sources/atdd-flow");
const sources: SourceSpec[] = [
  { id: "ATDD-Bun", path: bun, kind: "bun", revision: "5945d97e18310e7c862c08e73985400935d21346", sha256: digestSource(bun, "bun") },
  { id: "ATDD-Flow", path: flow, kind: "flow", revision: "2a66019a5ecf2b7a9f999ebfa04d04c9f548f19a", sha256: digestSource(flow, "flow") },
];
const catalog = loadCatalog(sources, process.cwd());
assert.equal(catalog.rules.size, 358, "Pinned Bun catalog has 356 rules and Flow has 2");
assert.equal(catalog.edges.length, 429, "Pinned Bun graph has 429 authored relationships");
for (const id of [
  "coder.bun.phase-discipline", "atdd-bun.review.behavioral-reconciliation",
  "atdd-bun.review.owner-inspectability", "atdd-flow.collaboration",
  "atdd-workflow.workflow.lifecycle",
]) assert.ok(catalog.rules.has(id), "missing canonical rule " + id);
const selectors: Selector[] = [
  { id: "review", terms: ["behavioral review"], rules: ["atdd-bun.review.behavioral-reconciliation"] },
  { id: "flow", terms: ["coordinator"], rules: ["atdd-workflow.workflow.lifecycle"] },
];
const ctx = resolveContext(catalog, selectors, "coordinator integration branch", [], "task");
assert.ok(ctx.matchingIds.includes("atdd-workflow.workflow.lifecycle"));
console.log(JSON.stringify({
  status: "ok", bunRevision: sources[0]!.revision, flowRevision: sources[1]!.revision,
  conventions: catalog.rules.size, relationships: catalog.edges.length,
  unresolvedExternalReferences: catalog.unresolvedEdges.map(e => e.source + " -> " + e.target),
  provenance: catalog.provenance,
}, null, 2));
