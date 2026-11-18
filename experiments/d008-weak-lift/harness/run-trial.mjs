/**
 * PLT-79: run ONE coder trial in a fresh disposable JJ/Git repository cloned from
 * the single immutable base. Condition A (baseline): no extensions. Condition B
 * (graph): the frozen pi-atdd extension snapshot (fix commit) via `-e`.
 * Everything else is identical. Reference runs (strong model) are condition A.
 *
 * Usage: node run-trial.mjs <E> <trialId>                       (scheduled, from prereg.json)
 *        node run-trial.mjs <E> <pilotId> --pilot <modelKey> <taskId> [--graph]   (UNSCORED difficulty pilot / activation smoke)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runPi, summarizeEvents, sha256, sha256File } from "./pi-run.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const args = process.argv.slice(2);
const [E, trialId] = args;
const pilotAt = args.indexOf("--pilot");
const tasks = JSON.parse(readFileSync(join(HERE, "../tasks.json"), "utf8"));
const models = JSON.parse(readFileSync(join(HERE, "../models.json"), "utf8")).models;
const BASE = readFileSync(join(E, "base/BASE_SHA"), "utf8").trim();
let spec;
if (pilotAt >= 0) {
  const [modelKey, taskId] = args.slice(pilotAt + 1);
  // Difficulty pilots are baseline; `--graph` marks an UNSCORED harness/activation smoke.
  spec = { trialId, taskId, modelKey, condition: args.includes("--graph") ? "graph" : "baseline", pilot: true, timeoutMs: 20 * 60_000 };
} else {
  const prereg = JSON.parse(readFileSync(join(HERE, "../prereg.json"), "utf8"));
  if (prereg.baseRevision !== BASE) throw new Error("base mismatch with preregistration");
  spec = prereg.schedule.find(s => s.trialId === trialId);
  if (!spec) throw new Error("trial not preregistered: " + trialId);
  spec = { ...spec, timeoutMs: prereg.budgets.coderTimeoutMs };
}
const model = models[spec.modelKey];
if (!model) throw new Error("unknown model key " + spec.modelKey);
const task = tasks.tasks.find(t => t.taskId === spec.taskId && !t.status);
if (!task) throw new Error("unknown/unrunnable task " + spec.taskId);
const dir = join(E, spec.pilot ? "pilots" : "trials", trialId);
if (existsSync(dir)) throw new Error("trial directory exists; trials are never re-run in place: " + dir);
mkdirSync(dir, { recursive: true });
const ws = join(dir, "ws");
const env = { ...process.env, JJ_USER: "D008 harness", JJ_EMAIL: "d008-harness@example.invalid", JJ_PAGER: "cat", JJ_EDITOR: "true" };
const jj = (...a) => execFileSync("jj", a, { cwd: ws, env, encoding: "utf8" }).trim();
const git = (...a) => execFileSync("git", a, { cwd: ws, encoding: "utf8" }).trim();

// 1. Fresh clone at the exact base; remove the remote so no path back to the base repo remains.
execFileSync("jj", ["git", "clone", "--colocate", join(E, "base/repo"), ws], { env, stdio: "ignore" });
jj("new", BASE);
jj("git", "remote", "remove", "origin");
const parent = jj("log", "-r", "@-", "--no-graph", "-T", "commit_id");
if (parent !== BASE || git("rev-parse", "HEAD") !== BASE) throw new Error("INVALID_HARNESS: trial not at exact base");
const tracked = git("ls-files").split("\n").filter(Boolean);
const baseDigests = Object.fromEntries(tracked.map(f => [f, sha256File(join(ws, f))]));

// 2. Agent.
const prompt = tasks.promptTemplate.replace("{taskId}", task.taskId).replace("{task}", task.task)
  .replace("{acceptanceId}", task.acceptanceId).replace("{gwt}", task.gwt)
  .replace("{allowedPaths}", task.allowedPaths.join(", ")).replace("{visibleTest}", task.visibleTests.join(" "));
const graph = spec.condition === "graph";
const SNAP = join(E, "pi-atdd-extension-snapshot");
const run = await runPi({ cwd: ws, outJsonl: join(dir, "coder.jsonl"), outStderr: join(dir, "coder.stderr"),
  timeoutMs: spec.timeoutMs, provider: model.provider, model: model.model, thinking: model.thinking,
  graph, prompt, extension: graph ? join(SNAP, "extensions/atdd.ts") : undefined });
const { events_, ...summary } = summarizeEvents(readFileSync(join(dir, "coder.jsonl"), "utf8"));

// 3. Activation audit. Receipts = any text delivered to the model by pi-atdd: custom
// messages, blocked-call reasons, and reconciliation attached to tool results.
const { shellWriteTargets } = await import(join(SNAP, "src/shell-targets.ts"));
const ruleIds = (t) => [...new Set([...t.matchAll(/Convention ([a-z0-9_.-]+) —/g)].map(m => m[1]))];
const resultText = (r) => typeof r === "string" ? r : JSON.stringify(r ?? "");
const receipts = [];
events_.forEach((e, i) => {
  if (e.type === "message_end" && typeof e.message?.customType === "string" && e.message.customType.startsWith("pi-atdd")) {
    const text = String(e.message.content);
    receipts.push({ index: i, kind: e.message.customType, text });
  }
  if (e.type === "tool_execution_end") {
    const text = resultText(e.result);
    if (/ATDD (contextual preflight|shell-write preflight|post-tool|POST-TOOL|applicability|graph reasoning)|Convention [a-z0-9_.-]+ —/.test(text))
      receipts.push({ index: i, kind: (typeof e.durationMs === "number" ? "tool_result:" : "tool_call-block:") + e.toolName, text });
  }
});
const starts = new Map(events_.flatMap((e, i) => e.type === "tool_execution_start" ? [[e.toolCallId, { i, e }]] : []));
const relevant = task.targetRelevantPaths.includes("*") ? task.allowedPaths : task.targetRelevantPaths;
const norm = (p) => String(p ?? "").replace(/^\.\//, "").replace(ws + "/", "");
/** Successful tool executions that changed (or plausibly changed) a target-relevant path. */
const relevantChanges = [];
events_.forEach((e, i) => {
  if (e.type !== "tool_execution_end" || typeof e.durationMs !== "number") return;
  const start = starts.get(e.toolCallId)?.e;
  const a = start?.args ?? {};
  if ((e.toolName === "edit" || e.toolName === "write") && !e.isError && relevant.includes(norm(a.path)))
    relevantChanges.push({ index: i, via: e.toolName, path: norm(a.path) });
  if (e.toolName === "bash") {
    const text = resultText(e.result);
    const observed = relevant.filter(p => text.includes("Changed file " + p + ":"));
    const statically = (typeof a.command === "string" ? shellWriteTargets(a.command) : []).map(norm).filter(p => relevant.includes(p));
    const hit = [...new Set([...observed, ...statically])];
    if (hit.length) relevantChanges.push({ index: i, via: "bash", path: hit.join(","), detectedBy: observed.length ? "post-tool-observation" : "static-command" });
  }
});
const diffPaths = (() => { try { return execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: ws, encoding: "utf8" }).split("\n").filter(Boolean).map(l => l.slice(3)); } catch { return []; } })();
const relevantChangedInResult = diffPaths.some(p => relevant.includes(p));
const firstRelevant = relevantChanges[0]?.index ?? null;
const targetReceipts = receipts.filter(r => ruleIds(r.text).includes(task.targetRule));
const targetFirst = targetReceipts[0]?.index ?? null;
let activation;
if (!graph) activation = "N/A_BASELINE";
else if (firstRelevant === null && !relevantChangedInResult) activation = "VACUOUS_NO_RELEVANT_EDIT";
else if (firstRelevant === null) activation = "UNDETERMINED_CHANGE_NOT_LOCATED";
else if (targetFirst !== null && targetFirst < firstRelevant) activation = "TARGET_BEFORE_RELEVANT_EDIT";
else if (targetFirst !== null) activation = "TARGET_AFTER_RELEVANT_EDIT";
else activation = "TARGET_NEVER_DELIVERED";
summary.graphActivation = {
  status: activation,
  scoredAsGraph: graph && (activation === "TARGET_BEFORE_RELEVANT_EDIT" || activation === "VACUOUS_NO_RELEVANT_EDIT"),
  targetRule: task.targetRule, relevantPaths: relevant,
  firstRelevantChange: relevantChanges[0] ?? null, relevantChangedInResult,
  targetFirstReceiptIndex: targetFirst,
  receipts: receipts.map(r => ({ index: r.index, kind: r.kind, chars: r.text.length, estTokens: Math.ceil(r.text.length / 4), ruleIds: ruleIds(r.text), sha256: sha256(r.text) })),
  deliveredRuleIds: [...new Set(receipts.flatMap(r => ruleIds(r.text)))],
  injectedChars: receipts.reduce((n, r) => n + r.text.length, 0),
  injectedEstTokens: receipts.reduce((n, r) => n + Math.ceil(r.text.length / 4), 0),
  unknownFacts: [...new Set(receipts.flatMap(r => [...r.text.matchAll(/Unknown context facts \(NOT assumed false\): ([^\n"\\]+)/g)].map(m => m[1])))],
};
summary.bashCommands = events_.filter(e => e.type === "tool_execution_start" && e.toolName === "bash").map(e => e.args?.command);
summary.toolPaths = events_.filter(e => e.type === "tool_execution_start" && ["read", "edit", "write", "ls", "find", "grep"].includes(e.toolName)).map(e => e.toolName + ":" + (e.args?.path ?? ""));

// 4. Harness snapshot of the agent's working copy as an immutable result revision.
const statusBefore = jj("status");
jj("commit", "-m", "trial result");
const result = jj("log", "-r", "@-", "--no-graph", "-T", "commit_id");
const resultParents = jj("log", "-r", "@-", "--no-graph", "-T", "parents.map(|c| c.commit_id()).join(\",\")");
const gitHead = git("rev-parse", "HEAD");
const changed = git("diff", "--name-only", BASE, result).split("\n").filter(Boolean);
const diff = git("diff", "--no-ext-diff", BASE, result);
writeFileSync(join(dir, "result.diff"), diff + "\n");
const protectedTouched = Object.keys(baseDigests).filter(f => !task.allowedPaths.includes(f) && (!existsSync(join(ws, f)) || sha256File(join(ws, f)) !== baseDigests[f]));
const record = {
  schema: "pi-atdd/d008-weak-lift/trial/v1", trialId, pilot: Boolean(spec.pilot), taskId: task.taskId,
  modelKey: spec.modelKey, role: model.role, replicate: spec.replicate ?? null, seq: spec.seq ?? null,
  condition: spec.condition, provider: model.provider, model: model.model, thinking: model.thinking,
  baseRevision: BASE, resultRevision: result, resultParents, gitHeadMatchesResult: gitHead === result,
  exactBase: resultParents === BASE, changedPaths: changed, unauthorizedChangedPaths: changed.filter(p => !task.allowedPaths.includes(p)),
  protectedFilesTouched: protectedTouched, diffSha256: sha256(diff + "\n"), promptSha256: sha256(prompt),
  jjStatusBeforeSnapshot: statusBefore.replaceAll(ws, "<ws>"),
  run, coder: summary,
};
writeFileSync(join(dir, "trial.json"), JSON.stringify(record, null, 2) + "\n");
writeFileSync(join(dir, "prompt.txt"), prompt);
console.log(JSON.stringify({ trialId, taskId: task.taskId, modelKey: spec.modelKey, condition: spec.condition, exit: run.exit, timedOut: run.timedOut,
  wallMs: run.wallMs, toolExecuted: summary.toolExecuted, byTool: summary.byTool, changed, activation, delivered: summary.graphActivation.deliveredRuleIds,
  stop: summary.stopReasons.at(-1), errors: summary.errorMessages.slice(0, 2) }));
