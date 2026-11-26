// URN: test:pi-atdd:conventions-sidecar:E001-UNIT-002
// Acceptance: acc:pi-atdd:E001-UNIT-002
// The frozen convention sidecar stays pinned to the canonical YAML it was derived from.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SIDECAR = join(ROOT, "conventions-sidecar");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const manifest = JSON.parse(readFileSync(join(SIDECAR, "manifest.json"), "utf8"));
const aliases: Record<string, string> = JSON.parse(readFileSync(join(ROOT, "conventions/aliases.json"), "utf8")).aliases;

test("every frozen sidecar is pinned to the current canonical source and to its own digest", () => {
  const drift: string[] = [];
  for (const [id, e] of Object.entries<any>(manifest.entries)) {
    if (sha(join(ROOT, e.sourcePath)) !== e.sourceSha256) drift.push("source changed: " + id);
    if (sha(join(SIDECAR, e.file)) !== e.sidecarSha256) drift.push("sidecar edited without re-audit: " + id);
    assert.equal(e.auditVerdict, "PASS", id);
  }
  assert.deepEqual(drift, [], "re-run the lossless-move audit for drifted conventions (tools/convention-fleet)");
});

test("every sidecar traces every source segment and carries one obligation", () => {
  for (const [id, e] of Object.entries<any>(manifest.entries)) {
    const c = JSON.parse(readFileSync(join(SIDECAR, e.file), "utf8"));
    if (e.legacyId) {
      assert.equal(c.rule_id, e.legacyId, id + ": frozen sidecar keeps its legacy id");
      assert.equal(aliases[c.rule_id], id, id + ": legacy id resolves to the manifest key");
    } else assert.equal(c.rule_id, id, id + ": package-authored sidecar uses its own id");
    assert.ok(typeof c.then === "string" && c.then.trim(), id + ": then");
    assert.ok(Array.isArray(c.trace) && c.trace.length > 0, id + ": trace");
    assert.ok(c.activation?.fires?.length && c.activation?.doesNotFire?.length, id + ": activation examples");
  }
});

test("shared nodes referenced by sidecars exist", () => {
  for (const [id, e] of Object.entries<any>(manifest.entries)) {
    const c = JSON.parse(readFileSync(join(SIDECAR, e.file), "utf8"));
    for (const n of c.sharedNodes ?? []) assert.ok(existsSync(join(SIDECAR, "shared", n.id + ".json")), id + " -> " + n.id);
  }
});

test("every split is pinned, has one obligation per part, and its alias resolves to all parts", () => {
  const overlay = JSON.parse(readFileSync(join(SIDECAR, "graph-overlay.json"), "utf8"));
  for (const [id, e] of Object.entries<any>(manifest.splits ?? {})) {
    assert.equal(sha(join(ROOT, e.sourcePath)), e.sourceSha256, "source changed: " + id);
    assert.equal(sha(join(SIDECAR, e.file)), e.sidecarSha256, "split edited without re-audit: " + id);
    const s = JSON.parse(readFileSync(join(SIDECAR, e.file), "utf8"));
    for (const p of s.parts) assert.ok(typeof p.then === "string" && p.then.trim(), p.rule_id + ": then");
    assert.deepEqual([...overlay.aliases[e.legacyId]].sort(), s.parts.map((p: any) => p.rule_id).sort(), id + ": alias");
    assert.deepEqual([...e.legacyParts].sort(), s.parts.map((p: any) => p.rule_id).sort(), id + ": legacy parts");
  }
  assert.equal(manifest.counts.coveredSources, 358, "every canonical convention is covered by a frozen rewrite or a split");
});
