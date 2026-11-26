// URN: test:pi-atdd:model-tiers:PLT-97-ACC-1
// Acceptance: acc:pi-atdd:plt-97-acc-1
// Acceptance: acc:pi-atdd:plt-97-acc-2
// Acceptance: acc:pi-atdd:plt-97-acc-3
// Acceptance: acc:pi-atdd:plt-97-acc-4
// PLT-97 (Linear): 1 rules selected for every launching profile; 2 resolver (tier -> model per active
// family, tier-level and per-run override, fail-closed); 3 a seeded brief that hard-codes a model name is
// flagged; 4 no model names in the repo's rules. Criterion 5 (draft PR, green suite, nothing merged) is
// checked by the PR process, not by this file.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundledSources, digestSource, loadCatalog, loadConfig, PROFILES, resolveContext, rulesForProfile } from "../src/catalog.ts";
import {
  chooseTier, configuredModels, FORBIDDEN_PROVIDERS, lintBrief, loadTiers, parseTiers, resolveTier, ROLE_TIERS, TierError,
} from "../src/model-tier.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "tests/fixtures/model-tiers");
const tiers = () => loadTiers(join(FIX, "tiers.yaml"));
const RULES = ["shared.model.tier-by-role", "shared.model.names-only-tiers",
  "shared.model.escalate-after-two-failures", "shared.model.subscription-providers"];

// ---- ACC-1: rules are authored, selected by launch wording, and delivered to every profile ----
test("PLT-97-ACC-1: the four shared.model rules load from the package and reach every profile", () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-model-rules-"));
  try {
    const { sources, selectors } = loadConfig(cwd);
    const catalog = loadCatalog(sources, cwd);
    for (const id of RULES) {
      const rule = catalog.rules.get(id);
      assert.ok(rule, id + " is loaded");
      assert.equal(rule.source, "pi-atdd");
      assert.equal(rule.disposition, "strict", id);
      assert.match(rule.statement, /\S/, id);
    }
    for (const profile of PROFILES) {
      for (const id of RULES) assert.ok(rulesForProfile(catalog, profile).includes(id), profile + " -> " + id);
    }
    const ctx = resolveContext(catalog, selectors, "Launch a sub-agent worker brief on the right model tier", [], "task");
    for (const id of RULES) assert.ok(ctx.matchingIds.includes(id), "selected for launching: " + id);
    const quiet = resolveContext(catalog, selectors, "Rename a local variable in the parser", [], "task");
    for (const id of RULES) assert.ok(!quiet.matchingIds.includes(id), "not selected for unrelated work: " + id);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("PLT-97-ACC-1: the policy states the owner rule (tiers by role, escalation, providers, no names)", () => {
  const text = (id: string) => readFileSync(join(ROOT, "catalog/pi-atdd/conventions/shared/model", id + ".convention.yaml"), "utf8")
    .replace(/\s+/g, " ");
  assert.match(text("shared.model.tier-by-role"), /planners?, testers?, coders? and bounded-task operators?.*low.*coordinators? and coach(es)?.*medium/i);
  assert.match(text("shared.model.tier-by-role"), /high.*xhigh.*explicit owner request.*named task/i);
  assert.match(text("shared.model.escalate-after-two-failures"), /two.*failures.*report/i);
  assert.match(text("shared.model.escalate-after-two-failures"), /Coach decides escalation up to .?medium.*high.*xhigh.*owner-only/i);
  assert.match(text("shared.model.subscription-providers"), /anthropic.*openai|per-token/i);
  assert.match(text("shared.model.subscription-providers"), /owner.?s call.*only through (the|its) Coach/i);
  assert.match(text("shared.model.names-only-tiers"), /never a model name/i);
});

// ---- ACC-2: resolver ----
test("PLT-97-ACC-2: a tier resolves to provider, model and thinking for the active family", () => {
  const t = tiers();
  assert.deepEqual(resolveTier(t, "low"), { tier: "low", family: "claude", provider: "pi-claude-cli",
    model: "fixture-low-claude", thinking: "high" });
  assert.equal(resolveTier(t, "medium").model, "fixture-medium-claude");
  assert.equal(resolveTier(t, "xhigh").thinking, "high");
  assert.equal(resolveTier(t, "low", { via: "glm" }).provider, "zai");
  assert.equal(resolveTier(t, "low", { via: "glm" }).model, "fixture-low-glm");
});

test("PLT-97-ACC-2: tier-level active overrides the file default for that tier only", () => {
  const t = tiers();
  assert.equal(resolveTier(t, "high").family, "codex", "high has its own active family");
  assert.equal(resolveTier(t, "high").provider, "openai-codex");
  assert.equal(resolveTier(t, "medium").family, "claude", "other tiers keep the top-level active");
});

test("PLT-97-ACC-2: per-run override (--via, then MODEL_TIERS_ACTIVE) beats tier-level and file defaults", () => {
  const t = tiers();
  assert.equal(resolveTier(t, "high", { via: "kimi" }).family, "kimi", "--via beats the tier active");
  assert.equal(resolveTier(t, "high", { env: { MODEL_TIERS_ACTIVE: "glm" } }).family, "glm", "env beats tier active");
  assert.equal(resolveTier(t, "low", { env: { MODEL_TIERS_ACTIVE: "glm" } }).family, "glm", "env beats file active");
  assert.equal(resolveTier(t, "high", { via: "claude", env: { MODEL_TIERS_ACTIVE: "glm" } }).family, "claude",
    "--via beats env");
  assert.equal(resolveTier(t, "low", { env: {} }).family, "claude", "no override falls back to file active");
});

test("PLT-97-ACC-2: the tiers file path comes from configuration, not from the code", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-atdd-tiers-"));
  try {
    const path = join(dir, "custom-tiers.yaml");
    writeFileSync(path, readFileSync(join(FIX, "tiers.yaml"), "utf8").replace("active: claude", "active: glm"));
    assert.equal(loadTiers(path).active, "glm");
    assert.equal(loadTiers(undefined, { MODEL_TIERS_FILE: path }).active, "glm", "MODEL_TIERS_FILE is honoured");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("PLT-97-ACC-2: fail closed on unknown tier, unknown family, missing model and forbidden provider", () => {
  const t = tiers();
  assert.throws(() => resolveTier(t, "ultra"), TierError, "unknown tier");
  assert.throws(() => resolveTier(t, "low", { via: "mistral" }), TierError, "unknown family via --via");
  assert.throws(() => resolveTier(t, "low", { env: { MODEL_TIERS_ACTIVE: "nope" } }), TierError, "unknown env family");
  const partial = parseTiers(`active: claude
providers:
  claude: { provider: pi-claude-cli }
  glm: { provider: zai }
tiers:
  low:
    claude: { model: fixture-low-claude, thinking: high }
`);
  assert.throws(() => resolveTier(partial, "low", { via: "glm" }), TierError, "tier has no model for that family");
  assert.throws(() => resolveTier(partial, "medium"), TierError, "tier is absent");
  for (const provider of ["anthropic", "openai"]) {
    assert.ok(FORBIDDEN_PROVIDERS.has(provider));
    const bad = parseTiers(`active: claude
providers:
  claude: { provider: ${provider} }
tiers:
  low:
    claude: { model: fixture-low-claude }
`);
    assert.throws(() => resolveTier(bad, "low"), TierError, provider + " is forbidden");
  }
  assert.throws(() => parseTiers("active: claude\ntiers: {}\n"), TierError, "providers are required");
  assert.throws(() => parseTiers("providers: {}\ntiers: {}\n"), TierError, "active family is required");
  assert.throws(() => parseTiers("active: [unclosed"), TierError, "malformed YAML");
  assert.throws(() => loadTiers(join(FIX, "does-not-exist.yaml")), TierError, "missing file");
});

test("PLT-97-ACC-2: role choice follows the owner rule and fails closed", () => {
  assert.deepEqual(ROLE_TIERS, { planner: "low", tester: "low", coder: "low", operator: "low",
    coach: "medium", coordinator: "medium" });
  for (const role of ["planner", "tester", "coder", "operator"]) assert.equal(chooseTier({ role }), "low", role);
  for (const role of ["coach", "coordinator"]) assert.equal(chooseTier({ role }), "medium", role);
  assert.throws(() => chooseTier({ role: "reviewer" }), TierError, "reviewer keeps its own configured model");
  assert.throws(() => chooseTier({ role: "wizard" }), TierError, "unknown role");
  // one tier per two reported failures; never silent
  assert.equal(chooseTier({ role: "coder", failures: 1 }), "low");
  assert.throws(() => chooseTier({ role: "coder", failures: 2, reported: false }), TierError, "silent escalation");
  assert.equal(chooseTier({ role: "coder", failures: 2, reported: true }), "medium");
  // high and xhigh only for an explicit owner request on a named task
  assert.throws(() => chooseTier({ role: "coder", failures: 4, reported: true }), TierError, "no owner request");
  assert.equal(chooseTier({ role: "coder", ownerRequest: { task: "PLT-97", tier: "high" } }), "high");
  assert.throws(() => chooseTier({ role: "coder", ownerRequest: { task: "", tier: "high" } }), TierError, "unnamed task");
  assert.throws(() => chooseTier({ role: "coder", ownerRequest: { task: "PLT-97", tier: "medium" } as any }), TierError,
    "owner request only for high/xhigh");
});

// ---- PLT-97 pins: ids and digests come from vendor/catalog.lock.json, never from counts ----
test("PLT-97-PINS: every locked source matches the bundled source and its shipped digest", () => {
  const lock = JSON.parse(readFileSync(join(ROOT, "vendor/catalog.lock.json"), "utf8")) as {
    sources: { id: string; sha256: string; revision?: string }[];
  };
  const bundled = bundledSources();
  assert.equal(bundled.length, lock.sources.length, "same source set");
  for (const locked of lock.sources) {
    const src = bundled.find(s => s.id === locked.id);
    assert.ok(src, locked.id + " is bundled");
    assert.equal(src.sha256, locked.sha256, locked.id + ": catalog.ts pin equals the lock");
    assert.equal(digestSource(src.path, src.kind), locked.sha256, locked.id + ": shipped files match the lock");
  }
});

// ---- ACC-3: a seeded brief that hard-codes a model name is flagged ----
test("PLT-97-ACC-3: a seeded brief that hard-codes a model name is flagged; a tier brief is not", () => {
  const hard = readFileSync(join(FIX, "brief-hardcoded.md"), "utf8");
  const clean = readFileSync(join(FIX, "brief-tiers.md"), "utf8");
  const found = lintBrief(hard, { models: configuredModels(tiers()) });
  const matches = found.map(f => f.match);
  assert.ok(matches.includes("fixture-low-claude"), "configured model id flagged");
  assert.ok(matches.some(m => /--provider pi-claude-cli/.test(m)), "--provider flag flagged");
  assert.ok(matches.includes("claude-haiku-5-5"), "model id pattern flagged without configuration");
  assert.ok(found.every(f => f.line >= 1), "findings carry line numbers");
  assert.deepEqual(lintBrief(clean, { models: configuredModels(tiers()) }), []);
});

// ---- ACC-4: no model names in the repo's rules ----
test("PLT-97-ACC-4: no convention file in the repository names a model", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".convention.yaml")) {
        const hits = lintBrief(readFileSync(p, "utf8"));
        if (hits.length) offenders.push(p + ": " + hits.map(h => h.match).join(", "));
      }
    }
  };
  for (const d of ["catalog", "conventions", "vendor"]) walk(join(ROOT, d));
  assert.deepEqual(offenders, []);
});
