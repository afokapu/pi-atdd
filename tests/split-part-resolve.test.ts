// PLT-119: each legacy split-part id resolves, through the catalog, to a loaded rule: the loaded parent (option 2).
// URN: test:pi-atdd:PLT-119:A1-001
// Acceptance: acc:pi-atdd:plt-119-a1-001
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalRuleId, loadCatalog, loadConfig, resolveLegacyReference, type Catalog } from "../src/catalog.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const aliasDoc = JSON.parse(readFileSync(join(ROOT, "conventions/aliases.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(ROOT, "conventions-sidecar/manifest.json"), "utf8"));

function catalog(): Catalog {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-split-"));
  try { return loadCatalog(loadConfig(cwd).sources, cwd); } finally { rmSync(cwd, { recursive: true, force: true }); }
}

test("Acceptance-01: each of the 46 legacy split-part ids resolves to a loaded rule", () => {
  const c = catalog();
  const olds = Object.keys(aliasDoc.splitParts);
  assert.equal(olds.length, 46);
  for (const old of olds) {
    const id = canonicalRuleId(c, old);
    assert.ok(c.rules.has(id), old + " -> " + id + " is not a loaded rule");
    assert.equal(resolveLegacyReference(c, old).convention?.id, id, old);
  }
});

test("each split part resolves to its own loaded parent, as the sidecar manifest records it", () => {
  const c = catalog();
  const parentOfPart = new Map<string, string>();
  for (const [parent, s] of Object.entries<any>(manifest.splits)) for (const p of s.parts) parentOfPart.set(p, parent);
  for (const [old, part] of Object.entries<string>(aliasDoc.splitParts))
    assert.equal(canonicalRuleId(c, old), parentOfPart.get(part), old);
});

test("Acceptance-02: the loaded rule count is unchanged", () => {
  assert.equal(catalog().rules.size, 376);
});
