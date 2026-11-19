// Shared helpers for the PLT-80 lossless-move fleet (local proposal tooling).
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createWriteStream, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const HOME = process.env.HOME;
export const REPO = process.env.PI_ATDD_REPO || new URL("../..", import.meta.url).pathname;
export const VENDOR = join(REPO, "vendor");
export const PI = join(REPO, "node_modules/.bin/pi");
// Working area (runs, logs) defaults to ./.fleet next to the scripts; prompts are read from the script directory.
export const FLEET = process.env.FLEET_DIR || new URL(".", import.meta.url).pathname;
const require = createRequire(join(REPO, "package.json"));
export const YAML = require("yaml");
export const sha256 = (b) => createHash("sha256").update(b).digest("hex");

export const DESTS = ["identity", "activation", "given", "when", "then", "prefer", "avoid", "unless", "why", "evidence",
  "verifier_detail", "shared", "audit", "structure", "dropped"];
export const FACT_KINDS = ["layer", "operation", "path_glob", "file_kind", "change", "phase", "finding", "task_term", "task_has_acceptance", "language"];
export const OBSERVABILITY = ["observable_now", "needs_new_observer", "llm_judged"];

/** Deterministic segmentation of a canonical convention into addressable units. */
export function segment(yamlText) {
  const doc = YAML.parse(yamlText);
  const segs = [];
  const AUTO = /^(schema_version|rule_id|kind|status|metadata\.aliases|metadata\.introduced_in|implementation|source|parity)$/;
  const push = (path, text, autoDest = null) => {
    const t = String(text).trim();
    if (!t) return;
    segs.push({ id: "S" + String(segs.length + 1).padStart(3, "0"), path, text: t, ...(autoDest ? { autoDest } : {}) });
  };
  const splitProse = (s) => s.split(/(?<=[.!?])\s+(?=[A-Z`(*])/).map(x => x.trim()).filter(Boolean);
  const splitText = (path, s) => {
    for (const line of String(s).split("\n")) {
      const l = line.trim();
      if (!l) continue;
      if (/^[*\-•]\s/.test(l) || /^[A-Za-z ]+:$/.test(l) || /^\/\/|^[A-Za-z_]+:\s*async|^const |^\.\.\.|^}/.test(l)) push(path, l);
      else for (const p of splitProse(l)) push(path, p);
    }
  };
  const walk = (node, path) => {
    if (node === null || node === undefined) return;
    if (AUTO.test(path)) { push(path, typeof node === "object" ? JSON.stringify(node) : node, path === "rule_id" ? "identity" : "audit"); return; }
    if (Array.isArray(node)) node.forEach((x, i) => walk(x, path + "[" + i + "]"));
    else if (typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, path ? path + "." + k : k);
    else if (path === "name") push(path, node);
    else splitText(path, node);
  };
  walk(doc, "");
  return { doc, segments: segs };
}

export function runPi({ cwd, provider, model, thinking, tools, prompt, out, timeoutMs = 20 * 60_000 }) {
  const args = ["--mode", "json", "--approve", "--no-session", "--no-mcp", "--no-skills", "--no-prompt-templates",
    "--no-context-files", "--no-themes", "--no-extensions", "--tools", tools, "--provider", provider, "--model", model, "--thinking", thinking, "--", prompt];
  const env = { ...process.env, PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1" };
  for (const k of ["PI_SESSION_FILE", "PI_SESSION_ID", "PI_MODEL", "PI_PROVIDER", "PI_REASONING_LEVEL", "PI_CODING_AGENT"]) delete env[k];
  return new Promise(done => {
    const t0 = Date.now(), o = createWriteStream(out), c = spawn(PI, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    c.stdout.pipe(o); let err = ""; c.stderr.on("data", d => err += d);
    const timer = setTimeout(() => c.kill("SIGTERM"), timeoutMs);
    c.on("close", code => { clearTimeout(timer); o.end(); done({ code, wallMs: Date.now() - t0, stderrTail: err.slice(-500) }); });
  });
}
export function usageOf(jsonlPath) {
  const ev = readFileSync(jsonlPath, "utf8").split("\n").flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
  const a = ev.filter(e => e.type === "message_end" && e.message?.role === "assistant");
  const outside = ev.filter(e => e.type === "tool_execution_start").map(e => JSON.stringify(e.args ?? {}))
    .filter(s => /plt-79|plt-78|evaluator|Github|\.pi\/|\.\.\//.test(s)).length;
  return { turns: a.length, cost: a.reduce((s, e) => s + (e.message.usage?.cost?.total || 0), 0),
    tools: ev.filter(e => e.type === "tool_execution_end" && typeof e.durationMs === "number").length, outsideAccess: outside,
    stop: a.at(-1)?.message?.stopReason, error: a.at(-1)?.message?.errorMessage };
}
