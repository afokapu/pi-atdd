/**
 * PLT-79: generate prereg.json BEFORE any scored trial. Pins the base, the
 * pi-atdd fix commit and snapshot digests, the evaluator MANIFEST digest, the
 * models, the tasks, the primary metric and threshold, exclusion rules and the
 * counterbalanced schedule. Usage: node prereg.mjs <E>
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sha256File } from "./pi-run.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const [E] = process.argv.slice(2);
const EV = join(E, "../plt-79-evaluator");
const BASE = readFileSync(join(E, "base/BASE_SHA"), "utf8").trim();
const tasks = JSON.parse(readFileSync(join(HERE, "../tasks.json"), "utf8"));
const models = JSON.parse(readFileSync(join(HERE, "../models.json"), "utf8"));
const runnable = tasks.tasks.filter(t => !t.status).map(t => t.taskId);
const weak = Object.entries(models.models).filter(([, m]) => m.role === "weak").map(([k]) => k);
const ref = Object.entries(models.models).filter(([, m]) => m.role === "reference").map(([k]) => k);

// Deterministic counterbalancing: LCG seeded from the base SHA (fixed before outcomes exist).
let seed = parseInt(BASE.slice(0, 8), 16) >>> 0;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const shuffle = (xs) => xs.map(x => [rand(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
const blocks = [[], [], []];
for (const modelKey of weak) for (const taskId of runnable) {
  const firstGraph = rand() < 0.5;
  const orders = [firstGraph ? ["graph", "baseline"] : ["baseline", "graph"], firstGraph ? ["baseline", "graph"] : ["graph", "baseline"],
    rand() < 0.5 ? ["graph", "baseline"] : ["baseline", "graph"]];
  orders.forEach((order, r) => blocks[r].push({ kind: "pair", modelKey, taskId, replicate: r + 1, order }));
}
shuffle(runnable.flatMap(taskId => ref.map(modelKey => ({ kind: "reference", modelKey, taskId, replicate: 1, order: ["baseline"] }))))
  .forEach((x, i) => blocks[i % 3].push(x));
const units = blocks.flatMap(b => shuffle(b));
const total = units.reduce((n, u) => n + u.order.length, 0);
const ids = shuffle(Array.from({ length: total }, (_, i) => i + 1));
const schedule = [];
units.forEach(u => u.order.forEach(condition => {
  const n = ids[schedule.length];
  schedule.push({ seq: schedule.length + 1, trialId: "w" + String(n).padStart(3, "0"), modelKey: u.modelKey, role: models.models[u.modelKey].role,
    taskId: u.taskId, replicate: u.replicate, condition, unit: u.kind === "pair" ? u.modelKey + "/" + u.taskId + "/r" + u.replicate : "ref/" + u.taskId });
}));

const ver = (cmd, a) => execFileSync(cmd, a, { encoding: "utf8" }).trim().split("\n")[0];
const calib = Object.fromEntries(readdirSync(join(E, "calibration")).map(d => {
  const v = JSON.parse(readFileSync(join(E, "calibration", d, "verdict.json"), "utf8"));
  return [v.provider + "/" + v.model, { status: v.status, byTool: v.byTool, fileEffectVerified: v.fileEffectVerified, contentCorrect: v.contentCorrect }];
}));
const pilots = (() => {
  const d = join(E, "pilots"); if (!existsSync(d)) return [];
  return readdirSync(d).sort().map(id => {
    const t = JSON.parse(readFileSync(join(d, id, "trial.json"), "utf8"));
    const ev = existsSync(join(d, id, "evaluation.json")) ? JSON.parse(readFileSync(join(d, id, "evaluation.json"), "utf8")) : null;
    return { pilotId: id, modelKey: t.modelKey, taskId: t.taskId, condition: t.condition, accepted: ev?.accepted ?? null,
      oracle: ev?.oracleMechanical?.status ?? null, verdict: ev?.verdict ?? null, scored: false };
  });
})();
const SNAP = join(E, "pi-atdd-extension-snapshot");
const prereg = {
  schema: "pi-atdd/d008-weak-lift/preregistration/v1", issue: "PLT-79", parent: "PLT-69 / D008", followUpOf: "PLT-78",
  createdAt: new Date().toISOString(),
  hypothesis: "For the same weak model, settings, tools, task and exact base revision, automatically injected source-locked pi-atdd graph guidance (condition B, fixed extension) increases the rate of independently accepted changes relative to no injection (condition A), closing part of the gap to a strong reference model, without increasing false greens.",
  conditions: { A_baseline: "Pi with --no-extensions (no pi-atdd)", B_graph: "identical flags plus exactly `-e <frozen pi-atdd snapshot of the fix commit>/extensions/atdd.ts`", reference: "strong model, condition A, once per task (reference ceiling, not a tested condition)" },
  baseRevision: BASE,
  piAtdd: { fixCommit: readFileSync(join(E, "base/PI_ATDD_COMMIT"), "utf8").trim(), tree: readFileSync(join(E, "base/PI_ATDD_TREE"), "utf8").trim(),
    fixPullRequest: "https://github.com/afokapu/pi-atdd/pull/5",
    extensionSha256: sha256File(join(SNAP, "extensions/atdd.ts")), activationSha256: sha256File(join(SNAP, "src/pi-activation.ts")),
    shellTargetsSha256: sha256File(join(SNAP, "src/shell-targets.ts")), renderSha256: sha256File(join(SNAP, "src/render-reasoning.ts")),
    selectorsSha256: sha256File(join(SNAP, "selectors/default.yaml")), catalogLockSha256: sha256File(join(SNAP, "vendor/catalog.lock.json")) },
  runtime: { pi: ver(join(HERE, "../../../node_modules/.bin/pi"), ["--version"]), node: process.version, jj: ver("jj", ["--version"]) },
  piFlags: "--mode json --approve --no-session --no-mcp --no-skills --no-prompt-templates --no-context-files --no-themes --no-extensions [-e ext] --provider P --model M --thinking T (default built-in tools: read,bash,edit,write)",
  models: models.models, modelSelection: models.selectionRule, calibration: calib,
  evaluator: {
    principal: "openai-codex/gpt-6.1-sol, separate fresh Pi sessions (--no-session --no-mcp --no-context-files --no-skills --no-extensions); owner-delegated AI principal named by the coordinator, NOT a human and not separately credentialed (it runs under the same operator machine's Pi login)",
    owns: "<evidence>/plt-79-evaluator/ (held-out oracle, reviewer rubric, references, validation, acceptance manifests, MANIFEST.json); verdicts in plt-79-evaluator-verdicts/",
    manifestSha256: sha256File(join(EV, "MANIFEST.json")),
    acceptanceManifestsSha256: sha256File(join(EV, "acceptance-manifests.json")),
    operatorBlindness: "the operator does not read oracle, rubric, reference or evaluator session contents until all scored runs and verdicts are done; it uses only hashes, mechanical pass/fail counts and verdict files",
  },
  tasks: { file: "tasks.json", sha256: sha256File(join(HERE, "../tasks.json")), runnable, unrun: tasks.tasks.filter(t => t.status).map(t => ({ taskId: t.taskId, status: t.status, reason: t.reason })) },
  outcomeDefinition: {
    accepted: "verifyTrial integrity valid (clean, exact HEAD, base ancestor, only allowed paths, evaluator manifest) AND visible acceptance passes AND the evaluator's held-out oracle passes (mechanical run) AND the evaluator's blind verdict is ACCEPT",
    falseGreen: "the evaluator judges that the coder report claims success AND the held-out oracle does not pass",
    validRun: "exact base, >=1 real Pi tool execution, evaluator verdict parsed. A coder timeout or loop is a VALID, NOT ACCEPTED run. A provider/infrastructure failure with 0 tool executions is INVALID and may be retried once under a new trial id (both kept).",
    graphScoring: "a graph (B) run is scored as graph only if the activation audit is TARGET_BEFORE_RELEVANT_EDIT (target rule delivered to the model before the first successful change to a target-relevant path) or VACUOUS_NO_RELEVANT_EDIT (no target-relevant path changed). Otherwise (TARGET_AFTER_RELEVANT_EDIT, TARGET_NEVER_DELIVERED, UNDETERMINED) it is reported separately and excluded from the primary B rate; an intention-to-treat B rate including them is secondary.",
  },
  primaryMetric: {
    rates: "rate_A = accepted/valid A runs; rate_B = accepted/graph-scored B runs; rate_ref = accepted/valid reference runs; pooled over both weak models and all runnable tasks, also per weak model and per task",
    D: "D = rate_B - rate_A (pooled)",
    gapClosed: "G = (rate_B - rate_A) / (rate_ref - rate_A); undefined (no measurable gap) when rate_ref - rate_A < 0.05",
  },
  threshold: {
    BENEFIT: "D >= +0.15 AND false-green rate_B <= false-green rate_A + 0.05",
    REGRESSION: "D <= -0.15 OR false-green rate_B >= false-green rate_A + 0.15",
    NO_OBSERVED_BENEFIT: "otherwise",
    INCOMPLETE: "if fewer than 3 valid replicates per condition exist for more than one model x task cell after exclusions, or a weak model cannot be run",
    INVALID: "if harness premises fail (base mismatch, evaluator MANIFEST mismatch, condition leakage)",
    descriptive: "per-model and per-task D, gap closed, Fisher exact two-sided p for pooled A vs B (descriptive only, not a decision rule)",
    overallD008: "D008 overall stays INCOMPLETE regardless of this verdict: T4-COORD is not run (PLT-66) and the evaluator is an owner-delegated AI principal, not a human or separately credentialed authority",
  },
  secondary: ["false greens", "input/output/cache tokens", "cost (USD as reported by Pi)", "wall time", "injected guidance tokens", "real tool executions", "blocked edits", "activation audit status"],
  design: { replicates: 3, cells: weak.length * runnable.length, scoredCoderSessions: schedule.length, perCell: "3 replicates x {A, B}; replicate 1 order seeded, replicate 2 reversed, replicate 3 seeded", reference: ref.length * runnable.length + " sessions (once per task)" },
  budgets: { coderTimeoutMs: 20 * 60_000, evaluatorTimeoutMs: 20 * 60_000, maxScoredCoderSessions: 80, concurrency: "up to 4 coder sessions and 3 evaluator sessions at once, dispatched in schedule order",
    stopRules: "stop a trial at 20 min (valid, not accepted); on provider rate limits pause and resume; on persistent provider failure record failed attempts and report the cell INCOMPLETE; never re-run a trial in place" },
  counterbalancing: "LCG PRNG seeded with parseInt(baseRevision[0:8],16): per-cell condition order (replicate 2 reverses replicate 1), unit order within replicate blocks, reference placement and opaque trial ids",
  pilotsDisclosure: { note: "UNSCORED weak-baseline difficulty pilots run before preregistration; excluded from all scoring", pilots },
  schedule,
  evidence: { raw: "local only (operator machine), not committed", curated: "experiments/d008-weak-lift/results/" },
};
writeFileSync(join(HERE, "../prereg.json"), JSON.stringify(prereg, null, 2) + "\n");
console.log(JSON.stringify({ BASE, total: schedule.length, evaluatorManifest: prereg.evaluator.manifestSha256, first: schedule.slice(0, 6) }, null, 1));
