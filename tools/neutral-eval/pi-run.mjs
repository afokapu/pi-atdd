// PLT-84 evaluation: spawn one isolated Pi process in JSON mode (adapted from the PLT-79 harness).
// Provider logins come from the operator's Pi setup. Claude is never used here; providers are subscriptions.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PI_BIN = process.env.PI_BIN || join(homedir(), "Github/worktrees/pi-atdd/plt-84-neutral/node_modules/.bin/pi");
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export function childEnv() {
  const env = { ...process.env, PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1" };
  for (const k of ["PI_SESSION_FILE", "PI_SESSION_ID", "PI_MODEL", "PI_PROVIDER", "PI_REASONING_LEVEL", "PI_CODING_AGENT", "NODE_TEST_CONTEXT"]) delete env[k];
  return env;
}
export function runPi({ cwd, outJsonl, outStderr, timeoutMs, provider, model, thinking, prompt, extension }) {
  if (provider === "anthropic") throw new Error("anthropic provider is forbidden (per-token billing); use a subscription provider");
  const args = ["--mode", "json", "--approve", "--no-session", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-extensions"];
  if (extension) args.push("-e", extension);
  args.push("--provider", provider, "--model", model, "--thinking", thinking, "--", prompt);
  return new Promise((done) => {
    const t0 = Date.now(), out = createWriteStream(outJsonl), err = createWriteStream(outStderr);
    const child = spawn(PI_BIN, args, { cwd, env: childEnv(), stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(out); child.stderr.pipe(err);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 10_000); }, timeoutMs);
    child.on("close", (code, signal) => { clearTimeout(timer); out.end(); err.end(); done({ exit: code, signal, timedOut, wallMs: Date.now() - t0 }); });
  });
}
export function summarizeEvents(raw) {
  const events = raw.split(/\r?\n/).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
  const ends = events.filter(e => e.type === "tool_execution_end");
  const executed = ends.filter(e => typeof e.durationMs === "number");
  const assistant = events.filter(e => e.type === "message_end" && e.message?.role === "assistant");
  const usage = assistant.reduce((a, e) => { const u = e.message?.usage || {}; a.input += u.input || 0; a.output += u.output || 0; a.cacheRead += u.cacheRead || 0; a.cost += u.cost?.total || 0; return a; }, { input: 0, output: 0, cacheRead: 0, cost: 0 });
  const text = (m) => Array.isArray(m?.content) ? m.content.filter(c => c.type === "text").map(c => c.text).join("\n") : (typeof m?.content === "string" ? m.content : "");
  const firstEdit = events.findIndex(e => e.type === "tool_execution_end" && ["edit", "write"].includes(e.toolName) && !e.isError);
  return { events: events.length, toolExecuted: executed.length, toolErrors: executed.filter(e => e.isError).length,
    byTool: executed.reduce((a, e) => (a[e.toolName] = (a[e.toolName] || 0) + 1, a), {}),
    turns: assistant.length, usage, stop: assistant.at(-1)?.message?.stopReason,
    errorMessages: assistant.map(e => e.message?.errorMessage).filter(Boolean), firstEditIndex: firstEdit,
    finalText: text(assistant.at(-1)?.message).slice(0, 3000), events_: events };
}
