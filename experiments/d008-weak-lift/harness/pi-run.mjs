/**
 * PLT-78 / D008-local: spawn one isolated Pi CLI process in JSON mode and capture
 * its raw event stream. Credentials are never read here; Pi uses the operator's
 * existing provider login from PI_CODING_AGENT_DIR.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const PI_BIN = resolve(REPO_ROOT, "node_modules/.bin/pi");
export const EXTENSION = resolve(REPO_ROOT, "extensions/atdd.ts");

export const sha256File = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** Environment for child Pi: strip the parent Pi session/model hints so nothing leaks across. */
export function childEnv() {
  const env = { ...process.env, PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1" };
  for (const k of ["PI_SESSION_FILE", "PI_SESSION_ID", "PI_MODEL", "PI_PROVIDER", "PI_REASONING_LEVEL", "PI_CODING_AGENT", "NODE_TEST_CONTEXT"]) delete env[k];
  return env;
}

/** Common isolation flags. Condition B adds exactly one `-e <pi-atdd extension>`. */
export function piArgs({ provider, model, thinking, tools, graph, prompt, extension }) {
  const args = ["--mode", "json", "--approve", "--no-session", "--no-mcp", "--no-skills",
    "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-extensions"];
  if (graph) args.push("-e", extension ?? EXTENSION);
  if (tools) args.push("--tools", tools);
  args.push("--provider", provider, "--model", model, "--thinking", thinking, "--", prompt);
  return args;
}

export function runPi({ cwd, outJsonl, outStderr, timeoutMs, ...opts }) {
  const args = piArgs(opts);
  return new Promise((done) => {
    const started = Date.now();
    const out = createWriteStream(outJsonl), err = createWriteStream(outStderr);
    const child = spawn(PI_BIN, args, { cwd, env: childEnv(), stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(out); child.stderr.pipe(err);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 10_000); }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      out.end(); err.end();
      done({ exit: code, signal, timedOut, wallMs: Date.now() - started,
        argv: args.map(a => a === opts.prompt ? "<prompt sha256:" + sha256(a) + ">" : a.replace(REPO_ROOT, "<pi-atdd>").replace(homedir(), "~")) });
    });
  });
}

/** Parse Pi JSONL into an auditable summary. Only top-level tool_execution_* events count. */
export function summarizeEvents(raw) {
  const events = raw.split(/\r?\n/).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
  const starts = events.filter(e => e.type === "tool_execution_start");
  const ends = events.filter(e => e.type === "tool_execution_end");
  const executed = ends.filter(e => typeof e.durationMs === "number");
  const notRun = ends.filter(e => typeof e.durationMs !== "number");
  const errors = executed.filter(e => e.isError);
  const assistant = events.filter(e => e.type === "message_end" && e.message?.role === "assistant");
  const usage = assistant.reduce((a, e) => {
    const u = e.message?.usage || {};
    a.input += u.input || 0; a.output += u.output || 0; a.cacheRead += u.cacheRead || 0; a.cacheWrite += u.cacheWrite || 0;
    a.cost += u.cost?.total || 0; return a;
  }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
  const customMessages = events.filter(e => e.type === "message_end" && e.message && e.message.role !== "assistant"
    && e.message.role !== "user" && e.message.role !== "toolResult");
  const text = (m) => Array.isArray(m?.content) ? m.content.filter(c => c.type === "text").map(c => c.text).join("\n") : (typeof m?.content === "string" ? m.content : "");
  // Fake tool calls: JSON-like tool invocations in assistant *text* (never counted as executions).
  const fakeToolText = assistant.filter(e => /"(?:name|tool)"\s*:\s*"(?:read|edit|write|bash)"/.test(text(e.message))).length;
  const blockedByExtension = ends.filter(e => e.isError && /ATDD/.test(JSON.stringify(e.result || "")));
  const firstEditIdx = events.findIndex(e => e.type === "tool_execution_end" && ["edit", "write"].includes(e.toolName) && !e.isError);
  return {
    events: events.length,
    toolStarts: starts.length, toolEnds: ends.length, toolExecuted: executed.length, toolNotRun: notRun.length,
    toolErrors: errors.length, blockedByAtdd: blockedByExtension.length,
    byTool: executed.reduce((a, e) => (a[e.toolName] = (a[e.toolName] || 0) + 1, a), {}),
    assistantTurns: assistant.length, usage,
    stopReasons: assistant.map(e => e.message?.stopReason),
    errorMessages: assistant.map(e => e.message?.errorMessage).filter(Boolean),
    fakeToolTextMessages: fakeToolText,
    customMessageTypes: customMessages.map(e => e.message.customType || e.message.role),
    firstSuccessfulEditEventIndex: firstEditIdx,
    finalText: text(assistant.at(-1)?.message).slice(0, 4000),
    events_: events,
  };
}
