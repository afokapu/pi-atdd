/**
 * Run ONE coder trial in a fresh disposable JJ/Git repository cloned from the single
 * immutable base. Condition A (baseline): no extensions. Condition B (graph): the
 * frozen pi-atdd extension snapshot via `-e`. Everything else is identical.
 *
 * Usage: node run-trial.mjs <E> <trialId>            (reads schedule from prereg.json)
 *        node run-trial.mjs <E> <trialId> --reference <dir> --task <taskId>   (oracle validation; no model)
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { runPi, summarizeEvents, sha256, sha256File } from "./pi-run.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const args = process.argv.slice(2);
const [E, trialId] = args;
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const reference = opt("--reference");
const tasks = JSON.parse(readFileSync(join(HERE, "../tasks.json"), "utf8"));
const BASE = readFileSync(join(E, "base/BASE_SHA"), "utf8").trim();
let spec;
if (reference) spec = { trialId, taskId: opt("--task"), condition: "reference", reference };
else {
  const prereg = JSON.parse(readFileSync(join(HERE, "../prereg.json"), "utf8"));
  if (prereg.baseRevision !== BASE) throw new Error("base mismatch with preregistration");
  spec = prereg.schedule.find(s => s.trialId === trialId);
  if (!spec) throw new Error("trial not preregistered: " + trialId);
  spec = { ...spec, ...prereg.models[spec.tier], timeoutMs: prereg.budgets.coderTimeoutMs };
}
const task = tasks.tasks.find(t => t.taskId === spec.taskId);
const dir = join(E, reference ? "reference-trials" : "trials", trialId);
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

// 2. Agent (or reference application).
const prompt = tasks.promptTemplate.replace("{taskId}", task.taskId).replace("{task}", task.task)
  .replace("{acceptanceId}", task.acceptanceId).replace("{gwt}", task.gwt)
  .replace("{allowedPaths}", task.allowedPaths.join(", ")).replace("{visibleTest}", task.visibleTests.join(" "));
let run = null, summary = null;
if (reference) {
  const files = (d) => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : [p]; });
  for (const f of files(reference)) cpSync(f, join(ws, relative(reference, f)));
} else {
  run = await runPi({ cwd: ws, outJsonl: join(dir, "coder.jsonl"), outStderr: join(dir, "coder.stderr"),
    timeoutMs: spec.timeoutMs, provider: spec.provider, model: spec.model, thinking: spec.thinking,
    graph: spec.condition === "graph", prompt,
    extension: spec.condition === "graph" ? join(E, "pi-atdd-extension-snapshot/extensions/atdd.ts") : undefined });
  const { events_, ...s } = summarizeEvents(readFileSync(join(dir, "coder.jsonl"), "utf8"));
  summary = s;
  // Graph activation receipts: rule IDs actually delivered to the model, and whether before first edit.
  const atdd = [];
  events_.forEach((e, i) => {
    if (e.type === "message_end" && typeof e.message?.customType === "string" && e.message.customType.startsWith("pi-atdd"))
      atdd.push({ index: i, kind: e.message.customType, text: String(e.message.content) });
    if (e.type === "tool_execution_end" && e.isError && /ATDD/.test(JSON.stringify(e.result || "")))
      atdd.push({ index: i, kind: "tool_call-block:" + e.toolName, text: JSON.stringify(e.result) });
  });
  const ruleIds = (t) => [...new Set([...t.matchAll(/Convention ([a-z0-9_.-]+) —/g)].map(m => m[1]))];
  summary.graphActivation = {
    receipts: atdd.map(a => ({ index: a.index, kind: a.kind, chars: a.text.length, estTokens: Math.ceil(a.text.length / 4), ruleIds: ruleIds(a.text), sha256: sha256(a.text) })),
    deliveredRuleIds: [...new Set(atdd.flatMap(a => ruleIds(a.text)))],
    injectedChars: atdd.reduce((n, a) => n + a.text.length, 0),
    injectedEstTokens: atdd.reduce((n, a) => n + Math.ceil(a.text.length / 4), 0),
    firstReceiptIndex: atdd[0]?.index ?? null,
    deliveredBeforeFirstSuccessfulEdit: atdd.length > 0 && (summary.firstSuccessfulEditEventIndex < 0 || atdd[0].index < summary.firstSuccessfulEditEventIndex),
    targetRuleDelivered: atdd.some(a => ruleIds(a.text).includes(task.targetRule)),
    targetRuleDeliveredBeforeFirstSuccessfulEdit: atdd.some(a => ruleIds(a.text).includes(task.targetRule) && (summary.firstSuccessfulEditEventIndex < 0 || a.index < summary.firstSuccessfulEditEventIndex)),
    unknownFacts: [...new Set(atdd.flatMap(a => [...a.text.matchAll(/Unknown context facts \(NOT assumed false\): ([^\n]+)/g)].map(m => m[1])))],
  };
  // Commands the agent ran (to audit for access outside the trial workspace).
  summary.bashCommands = events_.filter(e => e.type === "tool_execution_start" && e.toolName === "bash").map(e => e.args?.command);
  summary.readPaths = events_.filter(e => e.type === "tool_execution_start" && ["read", "edit", "write", "ls", "find", "grep"].includes(e.toolName)).map(e => e.toolName + ":" + (e.args?.path ?? ""));
}

// 3. Harness snapshot of the agent's working copy as an immutable result revision.
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
  schema: "pi-atdd/d008-local/trial/v1", trialId, taskId: task.taskId, tier: spec.tier ?? null,
  condition: spec.condition, provider: spec.provider ?? null, model: spec.model ?? null, thinking: spec.thinking ?? null,
  baseRevision: BASE, resultRevision: result, resultParents, gitHeadMatchesResult: gitHead === result,
  exactBase: resultParents === BASE, changedPaths: changed, unauthorizedChangedPaths: changed.filter(p => !task.allowedPaths.includes(p)),
  protectedFilesTouched: protectedTouched, diffSha256: sha256(diff + "\n"), promptSha256: sha256(prompt),
  jjStatusBeforeSnapshot: statusBefore.replaceAll(ws, "<ws>"),
  run, coder: summary,
};
writeFileSync(join(dir, "trial.json"), JSON.stringify(record, null, 2) + "\n");
writeFileSync(join(dir, "prompt.txt"), prompt);
const { coder, ...brief } = record;
console.log(JSON.stringify({ ...brief, coder: coder && { toolExecuted: coder.toolExecuted, byTool: coder.byTool, blockedByAtdd: coder.blockedByAtdd, usage: coder.usage, graph: { delivered: coder.graphActivation.deliveredRuleIds, beforeEdit: coder.graphActivation.targetRuleDeliveredBeforeFirstSuccessfulEdit } } }));
