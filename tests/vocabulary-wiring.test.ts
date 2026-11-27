// PLT-103 review RETURN (PR #26, 31d3045): the vocabulary helpers are reached through the supported entry points
// (catalog loader, CLI), the detector refs report the pinned upstream name, and the advisory sunset is read by the
// production catalog and CLI. The activation limit for plain-file edits is stated and tested.
// URN: test:pi-atdd:PLT-103:A2-003
// Acceptance: acc:pi-atdd:plt-103-a2-003
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog, loadConfig, resolveContext, resolveLegacyReference, type Catalog, type CatalogOptions } from "../src/catalog.ts";
import { execute } from "../src/cli.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const LEGACY_RULE = "shared.vocabulary.legacy-terms";
const RELEASE = "2026-01-01"; // 2026-03-01 is day 59 after it, 2026-03-02 is day 60

function emptyRepo(): string { return mkdtempSync(join(tmpdir(), "pi-atdd-wiring-")); }

function catalogWith(options?: CatalogOptions): { catalog: Catalog; selectors: any[]; done: () => void } {
  const cwd = emptyRepo();
  const config = loadConfig(cwd);
  return {
    catalog: loadCatalog(config.sources, cwd, options),
    selectors: config.selectors,
    done: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

// ---- catalog loader: the sunset is read by the production catalog ----

test("sunset: the production catalog keeps the advisory on day 59 after the release date", () => {
  const b = catalogWith({ legacyRelease: RELEASE, today: "2026-03-01" });
  try {
    assert.equal(b.catalog.rules.get(LEGACY_RULE)!.disposition, "advisory");
  } finally { b.done(); }
});

test("sunset: the production catalog reports strict on day 60 after the release date", () => {
  const b = catalogWith({ legacyRelease: RELEASE, today: "2026-03-02" });
  try {
    assert.equal(b.catalog.rules.get(LEGACY_RULE)!.disposition, "strict");
  } finally { b.done(); }
});

test("sunset: no release date keeps the advisory, however late the date", () => {
  const b = catalogWith({ legacyRelease: null, today: "2030-01-01" });
  try {
    assert.equal(b.catalog.rules.get(LEGACY_RULE)!.disposition, "advisory");
  } finally { b.done(); }
});

test("sunset: by default the catalog reads the packaged table (release date null, so advisory)", () => {
  const b = catalogWith();
  try {
    assert.equal(b.catalog.rules.get(LEGACY_RULE)!.disposition, "advisory");
  } finally { b.done(); }
});

// ---- catalog loader: moved paths, old rule ids and detector refs resolve through the loaded catalog ----

test("catalog: an old convention path resolves to the loaded rule it moved to", () => {
  const b = catalogWith();
  try {
    const got = resolveLegacyReference(b.catalog,
      "vendor/atdd-bun/conventions/coder/interlocking/coder.interlocking.bilateral-binding.convention.yaml");
    assert.equal(got.kind, "path");
    assert.equal(got.current, "vendor/atdd-bun/conventions/coder/flow-router/coder.flow-router.bilateral-binding.convention.yaml", "the current path");
    assert.ok(got.convention, "the moved file is a loaded rule");
    assert.equal(got.convention!.id, "coder.flow-router.bilateral-binding");
    assert.match(got.convention!.file, /coder\/flow-router\/coder\.flow-router\.bilateral-binding\.convention\.yaml$/);
  } finally { b.done(); }
});

test("catalog: an old rule id resolves to the loaded rule", () => {
  const b = catalogWith();
  try {
    const got = resolveLegacyReference(b.catalog, "coder.interlocking.bilateral-binding");
    assert.equal(got.kind, "rule");
    assert.equal(got.convention?.id, "coder.flow-router.bilateral-binding");
  } finally { b.done(); }
});

test("catalog: a loaded rule reports the pinned upstream detector name and keeps the shipped name", () => {
  const b = catalogWith();
  try {
    const rule = b.catalog.rules.get("coder.flow-router.resolution-model-exists")!;
    assert.equal(rule.implementationRef, "coder.bun.interlocking-resolution-model-exists", "the pinned upstream name");
    assert.equal(rule.detectorRef, "coder.bun.flow-router-resolution-model-exists", "the name this repository ships");
  } finally { b.done(); }
});

// ---- CLI boundary: the resolve command reaches every helper ----

function run(argv: string[], options?: CatalogOptions): { output: any; status: number } {
  const repo = emptyRepo();
  try {
    return execute([...argv, "--repo", repo], options);
  } finally { rmSync(repo, { recursive: true, force: true }); }
}

test("CLI resolve: a legacy URN resolves to its current scheme", () => {
  const out = run(["resolve", "--ref", "acc:train:billing:pay:success"]);
  assert.equal(out.output.kind, "urn");
  assert.equal(out.output.current, "acc:user-system-flow:billing:pay:success");
  assert.equal(out.status, 0);
});

test("CLI resolve: a legacy field key resolves to its current key", () => {
  const out = run(["resolve", "--ref", "interlockingId"]);
  assert.equal(out.output.kind, "field");
  assert.equal(out.output.current, "flowRouterId");
});

test("CLI resolve: a legacy detector name reports the shipped name and the pinned upstream name, and its rule", () => {
  // The upstream detector name is also a v0.2.0 rule alias: the rule is reported, and the detector mapping beside it.
  const out = run(["resolve", "--ref", "coder.bun.interlocking-bilateral-binding"]);
  assert.equal(out.output.kind, "rule");
  assert.equal(out.output.rule, "coder.flow-router.bilateral-binding");
  assert.equal(out.output.detector.current, "coder.bun.flow-router-bilateral-binding");
  assert.equal(out.output.upstream, "coder.bun.interlocking-bilateral-binding");
});

test("CLI resolve: a shipped detector name reports its pinned upstream name", () => {
  const out = run(["resolve", "--ref", "coder.bun.flow-router-bilateral-binding"]);
  assert.equal(out.output.kind, "detector");
  assert.equal(out.output.current, "coder.bun.flow-router-bilateral-binding");
  assert.equal(out.output.upstream, "coder.bun.interlocking-bilateral-binding");
});

test("CLI resolve: an old convention path resolves to the loaded rule", () => {
  const out = run(["resolve", "--ref", "vendor/atdd-bun/conventions/coder/interlocking/coder.interlocking.bilateral-binding.convention.yaml"]);
  assert.equal(out.output.kind, "path");
  assert.equal(out.output.rule, "coder.flow-router.bilateral-binding");
  assert.equal(out.status, 0);
});

test("CLI resolve: a reference that is not a legacy name is unresolved, with exit 3", () => {
  const out = run(["resolve", "--ref", "no.such.rule"]);
  assert.equal(out.output.status, "unresolved");
  assert.equal(out.status, 3);
});

test("CLI resolve: a missing --ref is an error, never a silent pass", () => {
  assert.throws(() => execute(["resolve"]), /resolve needs --ref/);
});

// ---- CLI boundary: the context command applies the sunset with the same release date ----

function contextRule(day: string) {
  const repo = emptyRepo();
  try {
    const out = execute(["context", "--task", "Rename the wagon capability", "--repo", repo],
      { legacyRelease: RELEASE, today: day }).output as { rules: Array<{ id: string; disposition: string }> };
    return out.rules.find(r => r.id === LEGACY_RULE)?.disposition;
  } finally { rmSync(repo, { recursive: true, force: true }); }
}

test("CLI context: the advisory is a warning on day 59 and strict on day 60 after the release date", () => {
  assert.equal(contextRule("2026-03-01"), "advisory");
  assert.equal(contextRule("2026-03-02"), "strict");
});

// ---- activation limit: a plain-file edit with legacy wording (P2-a) ----

test("activation limit: an edit to a plain file such as README.md does not activate the advisory (tested limit)", () => {
  const b = catalogWith();
  try {
    const got = resolveContext(b.catalog, b.selectors, "", ["README.md"], "edit");
    assert.ok(!got.matchingIds.includes(LEGACY_RULE));
    const legacyName = resolveContext(b.catalog, b.selectors, "", ["plan/_trains/billing.yaml"], "edit");
    assert.ok(legacyName.matchingIds.includes(LEGACY_RULE), "a legacy-named path still activates it");
  } finally { b.done(); }
});

test("activation limit: the convention states the limit, so the rule text and the PR agree", () => {
  const text = readFileSync(join(ROOT, "catalog/pi-atdd/conventions/shared/vocabulary/shared.vocabulary.legacy-terms.convention.yaml"), "utf8");
  assert.match(text, /Activation limit/);
  assert.match(text, /README\.md/);
  assert.match(text, /never the file content/);
});

// ---- review RETURN 2 (PR #26, bd13b65): path resolution is gated by the mapping and the loaded catalog, not by suffix;
// current names resolve; the sunset reads a non-null release date from the table file ----

test("P2-a: an unmapped convention path that no loaded rule declares is unresolved (exit 3), not resolved", () => {
  const out = run(["resolve", "--ref", "vendor/atdd-bun/conventions/coder/example/no-such-rule.convention.yaml"]);
  assert.equal(out.output.status, "unresolved");
  assert.equal(out.output.rule, null);
  assert.equal(out.status, 3);
});

test("P2-a: a moved neutral JSON path (not a convention YAML) resolves to its current path, exit 0", () => {
  const out = run(["resolve", "--ref", "conventions-neutral/coder/interlocking/coder.interlocking.bilateral-binding.json"]);
  assert.equal(out.output.status, "resolved");
  assert.equal(out.output.kind, "path");
  assert.equal(out.output.current, "conventions-neutral/coder/flow-router/coder.flow-router.bilateral-binding.json");
  assert.equal(out.status, 0);
});

test("P2-a: a moved golden TXT path resolves to its current path, exit 0", () => {
  const out = run(["resolve", "--ref", "tests/golden/bun/coder.architecture.wagons-import.txt"]);
  assert.equal(out.output.status, "resolved");
  assert.equal(out.output.current, "tests/golden/bun/coder.architecture.capabilities-import.txt");
  assert.equal(out.status, 0);
});

test("P2-b: current names resolve to themselves: a URN, a field key and a rule id", () => {
  for (const [ref, kind] of [["acc:user-system-flow:billing:pay:success", "urn"], ["flowRouterId", "field"], ["capability:billing:pay", "urn"], ["coder.flow-router.bilateral-binding", "rule"]] as const) {
    const out = run(["resolve", "--ref", ref]);
    assert.equal(out.output.status, "resolved", ref);
    assert.equal(out.output.kind, kind, ref);
    assert.equal(out.output.current, ref, ref);
    assert.equal(out.status, 0, ref);
  }
});

test("P2-b: round trip: the current name of every old reference resolves to the same current name", () => {
  const oldRefs = [
    "acc:train:billing:pay:success", "train:billing:x", "interlockingId", "wagon",
    "coder.interlocking.bilateral-binding",
    "coder.bun.interlocking-bilateral-binding", "coder.bun.interlocking-resolution-model-exists",
    "vendor/atdd-bun/conventions/coder/interlocking/coder.interlocking.bilateral-binding.convention.yaml",
    "conventions-neutral/coder/interlocking/coder.interlocking.bilateral-binding.json",
    "tests/golden/bun/coder.architecture.wagons-import.txt",
  ];
  for (const old of oldRefs) {
    const first = run(["resolve", "--ref", old]);
    assert.equal(first.output.status, "resolved", old);
    const again = run(["resolve", "--ref", first.output.current]);
    assert.equal(again.output.status, "resolved", "current of " + old + " = " + first.output.current);
    assert.equal(again.output.current, first.output.current, old);
    assert.equal(again.status, 0, old);
  }
});

test("sunset: a non-null release date read from the mapping table (no legacyRelease override) gives strict on day 60", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-sunset-table-"));
  try {
    // Written as the owner would write it: an unquoted date, which the YAML parser reads as a string.
    const table = join(dir, "legacy-terms.yaml");
    writeFileSync(table, "schema: pi-atdd/legacy-terms/v1\nsunset:\n  date: 2026-01-01\n  until_date: advisory\n  after_date: strict\n");
    const cwd = emptyRepo();
    try {
      const config = loadConfig(cwd);
      const day59 = loadCatalog(config.sources, cwd, { legacyTerms: table, today: "2026-03-01" });
      const day60 = loadCatalog(config.sources, cwd, { legacyTerms: table, today: "2026-03-02" });
      assert.equal(day59.rules.get(LEGACY_RULE)!.disposition, "advisory", "day 59");
      assert.equal(day60.rules.get(LEGACY_RULE)!.disposition, "strict", "day 60");
    } finally { rmSync(cwd, { recursive: true, force: true }); }
    const repo = emptyRepo();
    try {
      const out = execute(["context", "--task", "Rename the wagon capability", "--repo", repo],
        { legacyTerms: table, today: "2026-03-02" }).output as { rules: Array<{ id: string; disposition: string }> };
      assert.equal(out.rules.find(r => r.id === LEGACY_RULE)?.disposition, "strict", "CLI context reads the table date");
    } finally { rmSync(repo, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
