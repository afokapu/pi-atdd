// PLT-84: write the Bun golden snapshots from the FROZEN tag, not from the working tree.
// Usage: node --experimental-strip-types tools/neutral-fleet/golden-from-tag.ts <rule_id>...
// Reads each rule's legacy sidecar file at v0.2.0-bun-baseline (via jj) and renders its agent-facing text.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, renderSidecar } from "../../src/neutral-render.ts";

export const TAG = "v0.2.0-bun-baseline";
export const PACKAGE_BASE = "47e2ba9ff0c0"; // main after PLT-87 (#10) and PR #13
const manifest = JSON.parse(readFileSync(join(ROOT, "conventions-sidecar/manifest.json"), "utf8"));
const partLegacy = Object.fromEntries(Object.entries<string>(JSON.parse(readFileSync(join(ROOT, "conventions/aliases.json"), "utf8")).splitParts ?? {}).map(([o, n]) => [n, o]));
const partOf: Record<string, any> = {};
for (const se of Object.values<any>(manifest.splits ?? {})) for (const p of se.parts) partOf[p] = se;
for (const id of process.argv.slice(2)) {
  const e = manifest.entries[id] ?? partOf[id];
  if (!e) throw new Error("not a frozen rewrite or split part: " + id);
  // The tag predates PLT-87; the sidecar file paths are unchanged (only manifest keys were re-keyed).
  // Package-authored rules (no legacyId, e.g. shared.convention.propose) did not exist at the tag; their frozen
  // sidecar was added by PLT-87 and is snapshotted from PACKAGE_BASE instead. This is stated in the log line.
  const rev = e.legacyId ? TAG : PACKAGE_BASE;
  let doc = JSON.parse(execFileSync("jj", ["file", "show", "-r", rev, "conventions-sidecar/" + e.file], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 }));
  if (!manifest.entries[id]) doc = doc.parts.find((p: any) => p.rule_id === partLegacy[id]);
  if (!doc) throw new Error("part missing at " + TAG + ": " + id);
  const out = join(ROOT, "tests/golden/bun", id + ".txt");
  writeFileSync(out, renderSidecar(doc));
  console.log("golden " + id + " <- " + rev + ":" + e.file);
}
