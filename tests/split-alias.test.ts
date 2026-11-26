// URN: test:pi-atdd:PLT-103:A0-001
// Acceptance: acc:pi-atdd:plt-103-a0-001
// Every legacy split-part id (46, from the PLT-81 split sidecars) resolves at runtime to its profile-first part id.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bundledAliases, canonicalRuleId } from "../src/catalog.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(ROOT, "conventions-sidecar/manifest.json"), "utf8"));
const splitPairs: [string, string][] = Object.values<any>(manifest.splits).flatMap(e =>
  e.legacyParts.map((old: string, i: number) => [old, e.parts[i]] as [string, string]));

test("all 46 legacy split-part ids are in the split map and point at their new part ids", () => {
  assert.equal(splitPairs.length, 46);
  const aliases = bundledAliases();
  const missing = splitPairs.filter(([old]) => !aliases.has(old)).map(([old]) => old);
  assert.deepEqual(missing, [], "legacy split-part ids that do not resolve");
  for (const [old, next] of splitPairs) assert.equal(aliases.get(old), next, old);
});

test("a legacy split-part id resolves through canonicalRuleId to its new part id", () => {
  const catalog = { rules: new Map(), aliases: bundledAliases() };
  for (const [old, next] of splitPairs) assert.equal(canonicalRuleId(catalog, old), next, old);
});
