// PLT-103 review RETURN (PR #23, ced1167): each legacy surface must resolve at runtime, not only sit in data.
// Surfaces: URN schemes, field keys, detector refs, moved folders, identifiers in rule text, the advisory
// legacy-vocabulary activation and its sunset transition.
// URN: test:pi-atdd:PLT-103:A2-002
// Acceptance: acc:pi-atdd:plt-103-a2-002
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { loadCatalog, loadConfig, resolveContext, type Catalog, type Selector } from "../src/catalog.ts";
import {
  legacyTermsPhase, resolveDetectorRef, resolveFieldKey, resolveMovedPath, resolveUrnScheme, upstreamDetectorRef,
} from "../src/vocabulary.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const aliasDoc = JSON.parse(readFileSync(join(ROOT, "conventions/aliases.json"), "utf8"));

function bundled(): { catalog: Catalog; selectors: Selector[] } {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-vocab-surfaces-"));
  try {
    const config = loadConfig(cwd);
    return { catalog: loadCatalog(config.sources, cwd), selectors: config.selectors };
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

function filesUnder(dir: string, keep: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

// ---- URN schemes: the acceptance URN accepts the table form and the legacy form during the transition ----

function acceptanceValidator() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(JSON.parse(readFileSync(join(ROOT, "tests/fixtures/schema/appendix.schema.json"), "utf8")), "appendix.schema.json");
  return ajv.compile(JSON.parse(readFileSync(join(ROOT, "tests/fixtures/schema/acceptance.schema.json"), "utf8")));
}

test("URN: the acceptance schema reads the legacy train scheme and the table's user-system-flow scheme, both valid", () => {
  const validate = acceptanceValidator();
  const doc = parse(readFileSync(join(ROOT, "plan/pi-atdd/E002.yaml"), "utf8")).acceptances.find((a: any) => a.identity.urn === "acc:pi-atdd:E001-UNIT-001");
  for (const urn of ["acc:train:billing:pay:success", "acc:user-system-flow:billing:pay:success"]) {
    const d = structuredClone(doc);
    d.identity.urn = urn;
    assert.equal(validate(d), true, urn + " " + JSON.stringify(validate.errors));
  }
});

test("URN: no vendored or neutral URN uses the camel-case scheme userSystemFlow (the owner table is user-system-flow)", () => {
  const hits: string[] = [];
  for (const dir of ["vendor/atdd-bun/conventions", "conventions-neutral"]) {
    for (const file of filesUnder(join(ROOT, dir), f => /\.(yaml|json)$/.test(f))) {
      const text = readFileSync(file, "utf8");
      if (/\b(acc|test):userSystemFlow:/.test(text)) hits.push(relative(ROOT, file));
    }
  }
  assert.deepEqual(hits, []);
});

test("URN: each renamed scheme resolves to its table form", () => {
  assert.equal(resolveUrnScheme("train"), "user-system-flow");
  assert.equal(resolveUrnScheme("wagon"), "capability");
  assert.equal(resolveUrnScheme("interlocking"), "flow-router");
  assert.equal(resolveUrnScheme("wmbt"), "desired-outcome");
  assert.equal(resolveUrnScheme("station-master"), "journey-router");
  assert.equal(resolveUrnScheme("capability"), "capability", "a current scheme resolves to itself");
});

// ---- field keys: old names resolve; identifiers in rule text are valid code ----

test("field keys: old names resolve to the new key, including the flow-router id", () => {
  assert.equal(resolveFieldKey("wagon"), "capability");
  assert.equal(resolveFieldKey("interlockingId"), "flowRouterId");
  assert.equal(resolveFieldKey("train_id"), "user_system_flow_id");
  assert.equal(resolveFieldKey("flowRouterId"), "flowRouterId", "a current key resolves to itself");
});

test("identifiers: no hyphenated identifier ends in Id or Ids in vendored or neutral rule text", () => {
  const pattern = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+(?:Id|Ids)\b/g;
  const hits: string[] = [];
  for (const dir of ["vendor/atdd-bun/conventions", "conventions-neutral"]) {
    for (const file of filesUnder(join(ROOT, dir), f => /\.(yaml|json)$/.test(f))) {
      for (const m of readFileSync(file, "utf8").matchAll(pattern)) hits.push(relative(ROOT, file) + ": " + m[0]);
    }
  }
  assert.deepEqual(hits, []);
});

test("identifiers: the flow-router resolution model is valid TypeScript (flowRouterId, not flow-routerId)", () => {
  const text = readFileSync(join(ROOT, "vendor/atdd-bun/conventions/coder/flow-router/coder.flow-router.resolution-model-exists.convention.yaml"), "utf8");
  assert.match(text, /flowRouterId: string;/);
  assert.match(text, /userSystemFlowId: string;/);
  assert.doesNotMatch(text, /flow-routerId/);
});

// ---- detector names: kept for traceability to the upstream atdd-bun detectors, and resolved at runtime ----

test("detector refs: every renamed detector resolves to its new name and back to the upstream name", () => {
  const entries = Object.entries<string>(aliasDoc.vocabulary.detectorRefs);
  assert.ok(entries.length >= 40);
  for (const [upstream, current] of entries) {
    assert.equal(resolveDetectorRef(upstream), current, "old detector resolves: " + upstream);
    assert.equal(resolveDetectorRef(current), current, "current detector resolves to itself: " + current);
    assert.equal(upstreamDetectorRef(current), upstream, "current detector traces to upstream: " + current);
  }
});

// ---- folders: old paths resolve to the moved convention file, which is loaded ----

test("folders: each moved convention path resolves to its new path, and the new file is a loaded rule", () => {
  const b = bundled();
  const loadedFiles = new Set([...b.catalog.rules.values()].map(r => r.file));
  for (const [old, next] of Object.entries<string>(aliasDoc.movedPaths)) {
    assert.equal(resolveMovedPath(old), next, "old path resolves: " + old);
    if (next.startsWith("vendor/atdd-bun/")) {
      assert.ok(loadedFiles.has("ATDD-Bun/" + next.slice("vendor/atdd-bun/".length)), "moved file is loaded: " + next);
    }
  }
});

// ---- advisory activation and the sunset transition ----

test("advisory: the legacy-vocabulary convention is selected by legacy wording in a task and by an edit to a legacy-named file", () => {
  const b = bundled();
  const legacy = resolveContext(b.catalog, b.selectors, "Rename the wagon capability and the train flow in the docs", [], "task");
  assert.ok(legacy.matchingIds.includes("shared.vocabulary.legacy-terms"), "legacy wording activates the advisory");
  const unrelated = resolveContext(b.catalog, b.selectors, "Implement authorization on the orders route", [], "task");
  assert.ok(!unrelated.matchingIds.includes("shared.vocabulary.legacy-terms"), "unrelated task does not activate it");
  const legacyFile = resolveContext(b.catalog, b.selectors, "", ["plan/_trains/billing.yaml"], "edit");
  assert.ok(legacyFile.matchingIds.includes("shared.vocabulary.legacy-terms"), "an edit to a legacy-named file activates the advisory");
  const plainFile = resolveContext(b.catalog, b.selectors, "", ["src/orders/routes/create.ts"], "edit");
  assert.ok(!plainFile.matchingIds.includes("shared.vocabulary.legacy-terms"), "an edit to a plain file does not (v0.2.0 activation kept)");
});

test("sunset: the advisory switches to strict 60 days after the release date, and stays advisory before it or without one", () => {
  assert.equal(legacyTermsPhase({ release: null, today: "2026-11-21" }), "advisory", "no release date yet");
  assert.equal(legacyTermsPhase({ release: "2026-01-01", today: "2026-03-01" }), "advisory", "59 days after release");
  assert.equal(legacyTermsPhase({ release: "2026-01-01", today: "2026-03-02" }), "strict", "60 days after release");
  assert.equal(legacyTermsPhase({ release: "2026-01-01", today: "2027-01-01" }), "strict");
});

test("sunset: the mapping table's sunset is the same rule the transition function applies", () => {
  const table = parse(readFileSync(join(ROOT, "conventions/legacy-terms.yaml"), "utf8"));
  assert.equal(table.sunset.until_date, "advisory");
  assert.equal(table.sunset.after_date, "strict");
  assert.match(table.sunset.rule, /60 days after the release/);
  assert.equal(table.sunset.date, null, "the release date is set at release, not before");
  assert.equal(legacyTermsPhase({ release: table.sunset.date, today: "2026-11-21" }), "advisory");
});

