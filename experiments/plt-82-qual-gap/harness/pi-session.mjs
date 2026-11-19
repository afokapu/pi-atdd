/**
 * PLT-82: one isolated Pi session in JSON mode. Reuses the PLT-79 harness helpers
 * (childEnv, summarizeEvents). Differences from PLT-79 piArgs: optional
 * --append-system-prompt (graph condition) and an explicit `-e` for the
 * pi-claude-cli provider extension (Claude models only; it registers the provider,
 * pi still owns prompt and tools).
 * Usage: node pi-session.mjs <cwd> <outPrefix> <provider> <model> <thinking> <promptFile> [--append <file>] [--timeout-min N]
 */
import { spawn } from "node:child_process";
import { createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { childEnv, summarizeEvents, PI_BIN, sha256 } from "../../d008-weak-lift/harness/pi-run.mjs";

const a = process.argv.slice(2);
const [cwd, outPrefix, provider, model, thinking, promptFile] = a;
const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const append = opt("--append");
const timeoutMs = Number(opt("--timeout-min") ?? 30) * 60_000;
const CLAUDE_EXT = homedir() + "/.pi/agents/forge/npm/node_modules/@saccolabs/pi-claude-cli/index.ts";
const prompt = readFileSync(promptFile, "utf8");
const args = ["--mode", "json", "--approve", "--no-session", "--no-mcp", "--no-skills", "--no-prompt-templates",
  "--no-context-files", "--no-themes", "--no-extensions"];
if (provider === "pi-claude-cli") args.push("-e", CLAUDE_EXT);
if (provider === "anthropic") throw new Error("anthropic provider is forbidden (use pi-claude-cli)");
if (append) args.push("--append-system-prompt", append);
args.push("--provider", provider, "--model", model, "--thinking", thinking, "--", prompt);
const env = { ...childEnv(), PI_CLAUDE_CLI_KEEPALIVE_MS: "0" };
const started = Date.now();
const out = createWriteStream(outPrefix + ".jsonl"), err = createWriteStream(outPrefix + ".stderr");
const child = spawn(PI_BIN, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.pipe(out); child.stderr.pipe(err);
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 10_000); }, timeoutMs);
child.on("close", (code, signal) => {
  clearTimeout(timer);
  out.end(() => {
    const { events_, ...s } = summarizeEvents(readFileSync(outPrefix + ".jsonl", "utf8"));
    const run = { exit: code, signal, timedOut, wallMs: Date.now() - started, provider, model, thinking,
      promptSha256: sha256(prompt), appendSystemPrompt: append ? { sha256: sha256(readFileSync(append)) } : null,
      argv: args.map(x => x === prompt ? "<prompt>" : x.replace(homedir(), "~")) };
    s.bashCommands = events_.filter(e => e.type === "tool_execution_start" && e.toolName === "bash").map(e => e.args?.command);
    s.toolPaths = events_.filter(e => e.type === "tool_execution_start" && e.toolName !== "bash").map(e => e.toolName + ":" + (e.args?.path ?? ""));
    writeFileSync(outPrefix + ".summary.json", JSON.stringify({ run, summary: s }, null, 2) + "\n");
    console.log(JSON.stringify({ exit: code, timedOut, wallMs: run.wallMs, turns: s.assistantTurns, tools: s.toolExecuted, usage: s.usage, stop: s.stopReasons.at(-1), errors: s.errorMessages.slice(0, 2) }));
  });
});
