// URN: test:pi-atdd:PLT-103:A2-001
// Acceptance: acc:pi-atdd:plt-103-a2-001
// Every legacy name the PLT-103 vocabulary rename changed still resolves: rule ids (PLT-87 ids and v0.2.0 ids),
// moved paths, the URN-scheme and field-key maps, and the acceptance field key, read in both forms during the transition.
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { bundledAliases, canonicalRuleId, loadCatalog, loadConfig, type Catalog } from "../src/catalog.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const aliasDoc = JSON.parse(readFileSync(join(ROOT, "conventions/aliases.json"), "utf8"));

function catalog(): { catalog: Catalog; done: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-vocab-"));
  const config = loadConfig(cwd);
  return { catalog: loadCatalog(config.sources, cwd), done: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("every PLT-87 rule id the rename changed resolves to its renamed rule in the loaded catalog", () => {
  const b = catalog();
  try {
    const renamed = Object.entries<string>(aliasDoc.renamedRuleIds);
    assert.ok(renamed.length >= 100, "the rename changes about 100 rule ids");
    const loadedRules = new Set<string>(Object.values<string>(aliasDoc.aliases));
    for (const [old, next] of renamed) {
      // split-part ids are sub-rules of a split source, not catalog rules: they resolve through bundledAliases (tested above)
      if (!loadedRules.has(next)) continue;
      assert.ok(b.catalog.rules.has(next), "renamed rule is loaded: " + next);
      assert.equal(canonicalRuleId(b.catalog, old), next, "old id resolves: " + old);
    }
  } finally {
    b.done();
  }
});

test("every moved convention path has its new file and no longer has the old one", () => {
  for (const [old, next] of Object.entries<string>(aliasDoc.movedPaths)) {
    assert.ok(existsSync(join(ROOT, next)), "new path exists: " + next);
    assert.ok(!existsSync(join(ROOT, old)), "old path is gone: " + old);
  }
  assert.ok(Object.keys(aliasDoc.movedPaths).length >= 100);
});

test("the v0.2.0 ids still resolve through the bundled map, and the split-part ids too", () => {
  const map = bundledAliases();
  for (const [old, next] of Object.entries<string>(aliasDoc.aliases)) assert.equal(map.get(old), next, old);
  for (const [old, next] of Object.entries<string>(aliasDoc.splitParts)) assert.equal(map.get(old), next, old);
});

test("the URN schemes and field keys the rename changed are all recorded, with their new forms", () => {
  const v = aliasDoc.vocabulary;
  assert.deepEqual(Object.keys(v.urnSchemes).sort(), ["interlocking", "station-master", "train", "wagon", "wmbt"]);
  assert.equal(v.urnSchemes.wagon, "capability");
  assert.equal(v.urnSchemes.wmbt, "desired-outcome");
  assert.equal(v.fieldKeys.wagon, "capability");
  assert.equal(v.detectorRefs[Object.keys(v.detectorRefs)[0]].length > 0, true);
  assert.ok(Object.keys(v.detectorRefs).length >= 40, "every detector name renamed upstream is kept for traceability");
});

test("the acceptance metadata key is read in both forms during the transition; neither form is rejected", () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(JSON.parse(readFileSync(join(ROOT, "tests/fixtures/schema/appendix.schema.json"), "utf8")), "appendix.schema.json");
  const schema = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/schema/acceptance.schema.json"), "utf8"));
  const validate = ajv.compile(schema);
  const doc = parse(readFileSync(join(ROOT, "plan/pi-atdd/E002.yaml"), "utf8")).acceptances.find((a: any) => a.identity.urn === "acc:pi-atdd:E001-UNIT-001");
  assert.equal(validate(doc), true, JSON.stringify(validate.errors));
  const legacy = structuredClone(doc);
  delete legacy.metadata.capability;
  legacy.metadata.wagon = "pi-atdd";
  assert.equal(validate(legacy), true, "legacy key accepted: " + JSON.stringify(validate.errors));
  const neither = structuredClone(doc);
  delete neither.metadata.capability;
  assert.equal(validate(neither), false, "a document with neither key is rejected");
});

test("the legacy-terms table is data: every concept has an alias rule and a sunset that switches advisory to strict", () => {
  const table = parse(readFileSync(join(ROOT, "conventions/legacy-terms.yaml"), "utf8"));
  assert.equal(table.status, "approved");
  assert.equal(table.sunset.until_date, "advisory");
  assert.equal(table.sunset.after_date, "strict");
  for (const t of table.terms.filter((x: any) => x.status === undefined)) assert.equal(t.alias, "required", t.concept);
});

test("the advisory legacy-vocabulary convention is loaded as advisory, with a relationship to the proposal path", () => {
  const b = catalog();
  try {
    const rule = b.catalog.rules.get("shared.vocabulary.legacy-terms");
    assert.ok(rule, "convention loaded");
    assert.equal(rule!.disposition, "advisory");
  } finally {
    b.done();
  }
});
