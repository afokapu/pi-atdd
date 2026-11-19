import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bundledSources, digestSource, loadCatalog, resolveContext, type Selector } from "../src/catalog.ts";

// PLT-98: every bundled source is pinned by id, kind, revision (where upstream) and digest,
// in vendor/catalog.lock.json, not by a count. Rule and edge totals change whenever a
// convention lands, so they are reported, not asserted. Since PLT-87 the bundled Bun/Flow
// snapshots are profile-first and no longer byte-identical to upstream; upstream checkouts
// are reported for information only.
const upstream = {
  bun: resolve(process.argv[2] || ".cache-sources/atdd-bun"),
  flow: resolve(process.argv[3] || ".cache-sources/atdd-flow"),
};
const lock = JSON.parse(readFileSync(resolve("vendor/catalog.lock.json"), "utf8")) as {
  sources: Array<{ id: string; kind: string; revision?: string; sha256: string }>;
};
const bundled = bundledSources();
assert.deepEqual(
  bundled.map(s => [s.id, s.kind, s.revision ?? null, s.sha256]),
  lock.sources.map(s => [s.id, s.kind, s.revision ?? null, s.sha256]),
  "bundledSources() must match the pinned set in vendor/catalog.lock.json",
);
assert.deepEqual(bundled.map(s => s.id), ["ATDD-Bun", "ATDD-Flow", "pi-atdd"]);
for (const source of bundled) {
  assert.equal(digestSource(source.path, source.kind), source.sha256, source.id + " bundle must match its pinned digest");
}
const catalog = loadCatalog(bundled, process.cwd());
for (const id of [
  "reviewer.reconciliation.behavioral", "reviewer.inspectability.owner",
  "coach.workflow.lifecycle", "shared.convention.propose",
]) assert.ok(catalog.rules.has(id), "missing canonical rule " + id);
const selectors: Selector[] = [
  { id: "review", terms: ["behavioral review"], rules: ["reviewer.reconciliation.behavioral"] },
  { id: "flow", terms: ["coordinator"], rules: ["coach.workflow.lifecycle"] },
];
const ctx = resolveContext(catalog, selectors, "coordinator integration branch", [], "task");
assert.ok(ctx.matchingIds.includes("coach.workflow.lifecycle"));
console.log(JSON.stringify({
  status: "ok",
  bundled: bundled.map(s => ({ id: s.id, revision: s.revision ?? null, sha256: s.sha256 })),
  upstreamDigestInfo: {
    "ATDD-Bun": digestSource(upstream.bun, "bun"),
    "ATDD-Flow": digestSource(upstream.flow, "flow"),
    note: "informational: bundles are profile-first since PLT-87 and not byte-identical to upstream",
  },
  conventions: catalog.rules.size, relationships: catalog.edges.length,
  unresolvedExternalReferences: catalog.unresolvedEdges.map(e => e.source + " -> " + e.target),
  provenance: catalog.provenance,
}, null, 2));
