/**
 * PLT-82: run ONE coder in a fresh clone of the immutable base, then snapshot the
 * working copy as an immutable result revision and record diff + metrics.
 * Usage: node run-coder.mjs <E> <runId> <provider> <model> <graph:0|1>
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const [E, runId, provider, model, graphFlag] = process.argv.slice(2);
const graph = graphFlag === "1";
const BASE = readFileSync(join(E, "base/BASE_SHA"), "utf8").trim();
const dir = join(E, "runs", runId);
if (existsSync(dir)) throw new Error("run dir exists; never re-run in place: " + dir);
mkdirSync(dir, { recursive: true });
const ws = join(dir, "ws");
const env = { ...process.env, JJ_USER: "PLT-82 harness", JJ_EMAIL: "plt82-harness@example.invalid", JJ_PAGER: "cat", JJ_EDITOR: "true" };
const jj = (...a) => execFileSync("jj", a, { cwd: ws, env, encoding: "utf8" }).trim();
const git = (...a) => execFileSync("git", a, { cwd: ws, encoding: "utf8" }).trim();
execFileSync("jj", ["git", "clone", "--colocate", join(E, "base/repo"), ws], { env, stdio: "ignore" });
jj("new", BASE);
jj("git", "remote", "remove", "origin");
if (jj("log", "-r", "@-", "--no-graph", "-T", "commit_id") !== BASE) throw new Error("INVALID_HARNESS: not at base");
const promptFile = join(E, "coder-prompt.txt");
const args = [join(HERE, "pi-session.mjs"), ws, join(dir, "coder"), provider, model, "medium", promptFile, "--timeout-min", "30"];
if (graph) args.push("--append", join(E, "conventions.md"));
const r = spawnSync(process.execPath, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
writeFileSync(join(dir, "driver.log"), r.stdout + "\n--stderr--\n" + r.stderr);
const statusBefore = jj("status");
jj("commit", "-m", "coder result");
const result = jj("log", "-r", "@-", "--no-graph", "-T", "commit_id");
const diff = git("diff", "--no-ext-diff", BASE, result);
writeFileSync(join(dir, "result.diff"), diff + "\n");
const changed = git("diff", "--name-status", BASE, result);
const s = JSON.parse(readFileSync(join(dir, "coder.summary.json"), "utf8"));
const record = { schema: "pi-atdd/plt-82/run/v1", runId, provider, model, thinking: "medium", condition: graph ? "graph" : "baseline",
  baseRevision: BASE, resultRevision: result, changed: changed.split("\n").filter(Boolean), jjStatusBeforeSnapshot: statusBefore.replaceAll(ws, "<ws>"),
  run: s.run, metrics: { turns: s.summary.assistantTurns, toolExecuted: s.summary.toolExecuted, toolErrors: s.summary.toolErrors, byTool: s.summary.byTool,
    usage: s.summary.usage, stopReasons: s.summary.stopReasons, errorMessages: s.summary.errorMessages }, finalReport: s.summary.finalText };
writeFileSync(join(dir, "run.json"), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({ runId, condition: record.condition, model, exit: s.run.exit, timedOut: s.run.timedOut, wallMs: s.run.wallMs, turns: record.metrics.turns, changed: record.changed.length }));
