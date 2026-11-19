/**
 * PLT-85: run ONE coder in a fresh clone of the immutable PLT-82 base (same flags as PLT-82:
 * harness/pi-session.mjs from plt-82-qual-gap), then snapshot the result revision.
 * Arm A appends nothing, Arm B appends conventions.md (PLT-82 catalog), Arm C conventions-c.md.
 * Usage: node run-coder.mjs <E> <runId> <provider> <model> <arm:A|B|C>
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const SESSION = join(HERE, "../../plt-82-qual-gap/harness/pi-session.mjs");
const [E, runId, provider, model, arm] = process.argv.slice(2);
const APPEND = { A: null, B: "conventions.md", C: "conventions-c.md" };
if (!(arm in APPEND)) throw new Error("arm must be A, B or C");
const BASE = readFileSync(join(E, "base/BASE_SHA"), "utf8").trim();
const dir = join(E, "runs", runId);
if (existsSync(dir)) throw new Error("run dir exists; never re-run in place: " + dir);
mkdirSync(dir, { recursive: true });
const ws = join(dir, "ws");
const env = { ...process.env, JJ_USER: "PLT-85 harness", JJ_EMAIL: "plt85-harness@example.invalid", JJ_PAGER: "cat", JJ_EDITOR: "true" };
const jj = (...a) => execFileSync("jj", a, { cwd: ws, env, encoding: "utf8" }).trim();
const git = (...a) => execFileSync("git", a, { cwd: ws, encoding: "utf8" }).trim();
execFileSync("jj", ["git", "clone", "--colocate", join(E, "base/repo"), ws], { env, stdio: "ignore" });
jj("new", BASE);
jj("git", "remote", "remove", "origin");
if (jj("log", "-r", "@-", "--no-graph", "-T", "commit_id") !== BASE) throw new Error("INVALID_HARNESS: not at base");
const args = [SESSION, ws, join(dir, "coder"), provider, model, "medium", join(E, "coder-prompt.txt"), "--timeout-min", "30"];
if (APPEND[arm]) args.push("--append", join(E, APPEND[arm]));
const started = new Date().toISOString();
const r = spawnSync(process.execPath, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
writeFileSync(join(dir, "driver.log"), r.stdout + "\n--stderr--\n" + r.stderr);
const statusBefore = jj("status");
jj("commit", "-m", "coder result");
const result = jj("log", "-r", "@-", "--no-graph", "-T", "commit_id");
writeFileSync(join(dir, "result.diff"), git("diff", "--no-ext-diff", BASE, result) + "\n");
const changed = git("diff", "--name-status", BASE, result);
const s = JSON.parse(readFileSync(join(dir, "coder.summary.json"), "utf8"));
const errs = (s.summary.errorMessages ?? []).join(" ");
const quota = /429|quota|rate.?limit|usage limit|exceeded/i.test(errs + " " + (r.stderr ?? ""));
const record = { schema: "pi-atdd/plt-85/run/v1", runId, provider, model, thinking: "medium", arm, condition: { A: "none", B: "catalog", C: "catalog+gap" }[arm],
  baseRevision: BASE, resultRevision: result, startedAt: started, changed: changed.split("\n").filter(Boolean), jjStatusBeforeSnapshot: statusBefore.replaceAll(ws, "<ws>"),
  run: s.run, quotaSuspect: quota, metrics: { turns: s.summary.assistantTurns, toolExecuted: s.summary.toolExecuted, toolErrors: s.summary.toolErrors, byTool: s.summary.byTool,
    usage: s.summary.usage, stopReasons: s.summary.stopReasons, errorMessages: s.summary.errorMessages }, finalReport: s.summary.finalText };
writeFileSync(join(dir, "run.json"), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({ runId, arm, model, exit: s.run.exit, timedOut: s.run.timedOut, wallMs: s.run.wallMs, turns: record.metrics.turns, changed: record.changed.length, cost: s.summary.usage.cost, quota, errors: s.summary.errorMessages?.slice(0, 2) }));
