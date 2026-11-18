/**
 * Generate the preregistration (prereg.json) and evaluator-owned acceptance manifests
 * (manifests.json) BEFORE any scored trial. Usage: node prereg.mjs <E>
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { acceptanceManifestDigest } from "../../../src/effectiveness.ts";
import { sha256File, sha256 } from "./pi-run.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const [E] = process.argv.slice(2);
const EV = join(E, "../plt-78-evaluator");
const BASE = readFileSync(join(E, "base/BASE_SHA"), "utf8").trim();
const tasks = JSON.parse(readFileSync(join(HERE, "../tasks.json"), "utf8"));
const files = (d) => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : [p]; });
const oracleSha256 = Object.fromEntries(readdirSync(join(EV, "oracle")).map(f => [f, sha256File(join(EV, "oracle", f))]));
const referenceSha256 = Object.fromEntries(files(join(EV, "reference")).map(f => [relative(join(EV, "reference"), f), sha256File(f)]));
const runnable = tasks.tasks.filter(t => !t.status);

const manifests = {}, digests = {};
for (const t of runnable) {
  const policyDigest = sha256(JSON.stringify({ oracle: t.oracle, oracleSha256: oracleSha256[t.oracle], rubric: t.rubric }));
  manifests[t.taskId] = { schema: "pi-atdd/acceptance-manifest/v1", id: "d008-local/" + t.taskId, taskId: t.taskId,
    baseRevision: BASE, acceptanceIds: [t.acceptanceId], testTargets: t.visibleTests,
    allowedChangedPaths: t.allowedPaths, policyDigest, runner: "node" };
  digests[t.taskId] = acceptanceManifestDigest(manifests[t.taskId]);
}
writeFileSync(join(HERE, "../manifests.json"), JSON.stringify({ schema: "pi-atdd/d008-local/manifests/v1",
  authority: "operator-pinned via this preregistration commit; NOT an independently authenticated evaluator",
  manifests, digests, oracleSha256, regressionTargets: ["tests/orders/get-order.test.ts"] }, null, 2) + "\n");

// Deterministic counterbalancing: PRNG seeded from the base SHA (fixed before outcomes exist).
let seed = parseInt(BASE.slice(0, 8), 16) >>> 0;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const models = {
  weak: { provider: "anthropic", model: "claude-haiku-4-5", thinking: "low" },
  strong: { provider: "anthropic", model: "claude-opus-5-5", thinking: "low" },
};
const pairs = [];
for (const tier of ["weak", "strong"]) for (const t of runnable) {
  const graphFirst = rand() < 0.5;
  pairs.push({ tier, taskId: t.taskId, order: graphFirst ? ["graph", "baseline"] : ["baseline", "graph"] });
}
// Smoke pair (weak x T1-SEC) runs first; remaining pairs in a seeded random order.
const smoke = pairs.find(p => p.tier === "weak" && p.taskId === "T1-SEC");
const rest = pairs.filter(p => p !== smoke).map(p => [rand(), p]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
const ordered = [smoke, ...rest];
const ids = Array.from({ length: ordered.length * 2 }, (_, i) => i + 1).map(n => [rand(), n]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
const schedule = [];
ordered.forEach((p, i) => p.order.forEach((condition, j) => schedule.push({
  seq: schedule.length + 1, trialId: "t" + String(ids[i * 2 + j]).padStart(2, "0"), pairId: "p" + String(i + 1).padStart(2, "0"),
  smoke: i === 0, tier: p.tier, taskId: p.taskId, condition })));

const ver = (cmd, a) => execFileSync(cmd, a, { encoding: "utf8" }).trim().split("\n")[0];
const calib = (p, m) => JSON.parse(readFileSync(join(E, "calibration", p + "__" + m, "verdict.json"), "utf8"));
const prereg = {
  schema: "pi-atdd/d008-local/preregistration/v1", issue: "PLT-78", parent: "PLT-69 / D008",
  createdAt: new Date().toISOString(),
  hypothesis: "For the same model, settings, tools, task and exact base revision, automatically injected source-locked pi-atdd graph guidance (condition B) increases the number of independently accepted changes relative to no injection (condition A), without increasing false-green claims.",
  conditions: { baseline: "Pi with --no-extensions (no pi-atdd)", graph: "identical flags plus exactly `-e <frozen pi-atdd extension snapshot>/extensions/atdd.ts`" },
  baseRevision: BASE,
  piAtdd: { commit: readFileSync(join(E, "base/PI_ATDD_COMMIT"), "utf8").trim(), tree: readFileSync(join(E, "base/PI_ATDD_TREE"), "utf8").trim(),
    extensionSha256: sha256File(join(E, "pi-atdd-extension-snapshot/extensions/atdd.ts")),
    selectorsSha256: sha256File(join(E, "pi-atdd-extension-snapshot/selectors/default.yaml")),
    catalogLockSha256: sha256File(join(E, "pi-atdd-extension-snapshot/vendor/catalog.lock.json")) },
  runtime: { pi: ver(join(HERE, "../../../node_modules/.bin/pi"), ["--version"]), node: process.version, jj: ver("jj", ["--version"]) },
  piFlags: "--mode json --approve --no-session --no-mcp --no-skills --no-prompt-templates --no-context-files --no-themes --no-extensions [-e ext] --provider P --model M --thinking T (default built-in tools: read,bash,edit,write)",
  models, reviewer: { provider: "openai-codex", model: "gpt-6.1-sol", thinking: "medium", tools: "read,bash,grep,find,ls",
    blinding: "opaque submission id; no condition label; coder report redacted of ATDD/convention identifiers; diff shown verbatim (leakage scanned and reported)" },
  calibration: Object.fromEntries([["anthropic", "claude-haiku-4-5"], ["anthropic", "claude-haiku-5-5"], ["anthropic", "claude-opus-5-5"], ["openai-codex", "gpt-6.1-sol"], ["openai-codex", "gpt-5.6-luna"]]
    .map(([p, m]) => { const v = calib(p, m); return [p + "/" + m, { status: v.status, byTool: v.byTool, fileEffectVerified: v.fileEffectVerified, contentCorrect: v.contentCorrect }]; })),
  reviewerCalibration: (() => { try { const d = join(E, "reviews-reference"); return readdirSync(d).map(b => { const r = JSON.parse(readFileSync(join(d, b, "review.json"), "utf8")); return { reference: r.trialId, verdict: r.verdict?.verdict, toolExecuted: r.toolExecuted }; }); } catch { return []; } })(),
  tierRationale: "weak = smallest calibrated tool-capable candidate (claude-haiku-4-5; it executed real tools but produced an incorrect calibration value); strong = claude-opus-5-5. Both coders on the anthropic provider; reviewer on a different provider (openai-codex).",
  tasksSha256: sha256File(join(HERE, "../tasks.json")), fixtureTreeNote: "fixture/ in this directory is byte-identical to the base revision tree",
  manifestsSha256: sha256File(join(HERE, "../manifests.json")), manifestDigests: digests,
  oracleSha256, referenceSha256,
  oracleDisclosure: "Held-out oracle and reference solutions are kept outside every trial and outside this repository until all trials finish; only their SHA-256 digests are committed here, the files are published afterwards.",
  outcomeDefinition: {
    accepted: "integrity valid (verifyTrial: clean, exact HEAD, base ancestor, only allowed paths) AND visible acceptance passes AND held-out oracle passes AND blind reviewer verdict ACCEPT",
    falseGreen: "blind reviewer judges the coder report claims success AND held-out oracle fails",
  },
  threshold: {
    unit: "matched pair (same tier, task, base); 6 pairs = 2 tiers x 3 runnable tasks",
    net: "net = sum over valid pairs of (graph accepted - baseline accepted)",
    BENEFIT: "net >= +2 AND graph false-greens <= baseline false-greens",
    REGRESSION: "net <= -2 OR graph false-greens >= baseline false-greens + 2",
    NO_OBSERVED_BENEFIT: "otherwise",
    overall: "Overall D008 verdict is INCOMPLETE if any preregistered prerequisite is missing (independent evaluator authentication, T4-COORD unrun, either tier unqualified or invalid pair); the observed directional result is still reported. INVALID if the harness premises fail.",
    caveat: "n = 6 single-replicate pairs; this threshold is a decision rule for this pilot, not a statistical significance test.",
  },
  budgets: { coderTimeoutMs: 20 * 60_000, reviewerTimeoutMs: 15 * 60_000, maxScoredCoderSessions: 12, maxReviewerSessions: 12,
    stopRules: "stop and report if a trial loops, exceeds the timeout, or a provider rate-limits; failed attempts are preserved, never re-run in place" },
  counterbalancing: "LCG PRNG seeded with parseInt(baseRevision[0:8],16): per-pair condition order, pair order after the smoke pair, and opaque trial ids",
  schedule,
  unrunScenarios: tasks.tasks.filter(t => t.status).map(t => ({ taskId: t.taskId, status: t.status, reason: t.reason })),
  evidence: { raw: "local only (operator machine), not committed", curated: "experiments/d008-local/results/" },
};
writeFileSync(join(HERE, "../prereg.json"), JSON.stringify(prereg, null, 2) + "\n");
console.log(JSON.stringify({ BASE, digests, schedule }, null, 1));
