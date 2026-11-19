// PLT-84: write the Bun golden snapshots from the FROZEN tag, not from the working tree.
// Usage: node --experimental-strip-types tools/neutral-fleet/golden-from-tag.ts <rule_id>...
// Reads each rule's legacy sidecar file at v0.2.0-bun-baseline (via jj) and renders its agent-facing text.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, renderSidecar } from "../../src/neutral-render.ts";

export const TAG = "v0.2.0-bun-baseline";
const manifest = JSON.parse(readFileSync(join(ROOT, "conventions-sidecar/manifest.json"), "utf8"));
for (const id of process.argv.slice(2)) {
  const e = manifest.entries[id];
  if (!e) throw new Error("not a frozen single rewrite: " + id);
  const frozen = execFileSync("jj", ["file", "show", "-r", TAG, "conventions-sidecar/" + e.file], { cwd: ROOT, encoding: "utf8" });
  const out = join(ROOT, "tests/golden/bun", id + ".txt");
  writeFileSync(out, renderSidecar(JSON.parse(frozen)));
  console.log("golden " + id + " <- " + TAG + ":" + e.file);
}
