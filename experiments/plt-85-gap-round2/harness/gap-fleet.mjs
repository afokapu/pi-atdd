/**
 * PLT-85 Arm C: author 5 NEW general conventions in the PLT-81 format with the PLT-81
 * author (pi-claude-cli/claude-opus-5-5) and auditor (openai-codex/gpt-6.1-sol) roles.
 * No canonical source exists, so there is no segment trace: the mechanical check covers
 * format + forbidden task tokens; the auditor covers format, generality, leakage,
 * decision-usefulness and spec coverage. Up to N rounds (author -> check -> audit).
 * Usage: node gap-fleet.mjs <outDir> [--rounds 3]
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, renameSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { childEnv, PI_BIN, sha256 } from "../../d008-weak-lift/harness/pi-run.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const P = join(HERE, "../prompts/gap-fleet");
const argv = process.argv.slice(2);
const OUT = argv[0];
const rounds = Number(argv[argv.indexOf("--rounds") + 1] || 3);
const CLAUDE_EXT = homedir() + "/.pi/agents/forge/npm/node_modules/@saccolabs/pi-claude-cli/index.ts";
const AUTHOR = { provider: "pi-claude-cli", model: "claude-opus-5-5", thinking: "medium" };
const AUDITOR = { provider: "openai-codex", model: "gpt-6.1-sol", thinking: "medium" };
const EXAMPLE = homedir() + "/forge-evidence/pi-atdd/plt-80-proposal/fleet/runs/coder.bun.security-missing-auth/author.json";
export const FORBIDDEN = /\b(loyalty|points?|lots?|redeem\w*|redemption\w*|rewards?|LOY-?\d*|orders?-service|PLT-\d+)\b/gi;
const FACT_KINDS = ["layer", "operation", "path_glob", "file_kind", "change", "phase", "finding", "task_term", "task_has_acceptance", "language"];
const OBS = ["observable_now", "needs_new_observer", "llm_judged"];
const log = (m) => { const l = new Date().toISOString() + " " + m; console.log(l); appendFileSync(join(OUT, "fleet.log"), l + "\n"); };

export const coderText = (a) => [a.title, a.given, a.when, a.then, ...a.prefer, ...a.avoid, ...a.unless, a.why].join("\n");
export function checkNew(dir, id) {
  const errors = [], warnings = [];
  let a; try { a = JSON.parse(readFileSync(join(dir, "author.json"), "utf8")); } catch (e) { return { ok: false, errors: ["author.json missing or invalid JSON: " + e.message], warnings }; }
  if (a.rule_id !== id) errors.push("rule_id must be " + id);
  for (const f of ["title", "given", "when", "then", "why"]) if (typeof a[f] !== "string" || !a[f].trim()) errors.push("missing field " + f);
  for (const f of ["prefer", "avoid", "unless", "evidence", "verifier_detail", "audit"]) if (!Array.isArray(a[f])) errors.push("field " + f + " must be an array");
  if (errors.length) return { ok: false, errors, warnings };
  if (!a.prefer.length) errors.push("no prefer entries");
  if (!a.avoid.length) errors.push("no avoid entries");
  if (!a.evidence.length) errors.push("no evidence entries");
  const act = a.activation ?? {};
  if (!act.facts?.length) errors.push("activation.facts empty");
  for (const f of act.facts ?? []) { if (!FACT_KINDS.includes(f.fact)) errors.push("unknown fact kind " + f.fact); if (!OBS.includes(f.observability)) errors.push("bad observability on " + f.fact); }
  if (!(act.fires?.length >= 1)) errors.push("activation.fires needs >=1 example");
  if (!(act.doesNotFire?.length >= 1)) errors.push("activation.doesNotFire needs >=1 example");
  const coder = coderText(a);
  for (const m of new Set([...[coder, ...a.evidence].join("\n").matchAll(FORBIDDEN)].map(m => m[0]))) errors.push("forbidden task-specific token in coder-facing/evidence text: " + m);
  if (coder.length > 1600) warnings.push("coder-facing text " + coder.length + " chars (> 1600)");
  return { ok: !errors.length, errors, warnings, stats: { coderChars: coder.length } };
}
function runPi(cwd, who, prompt, out) {
  const args = ["--mode", "json", "--approve", "--no-session", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-extensions"];
  if (who.provider === "pi-claude-cli") args.push("-e", CLAUDE_EXT);
  args.push("--tools", "read,write,ls", "--provider", who.provider, "--model", who.model, "--thinking", who.thinking, "--", prompt);
  return new Promise(done => {
    const t0 = Date.now(), o = createWriteStream(out), c = spawn(PI_BIN, args, { cwd, env: { ...childEnv(), PI_CLAUDE_CLI_KEEPALIVE_MS: "0" }, stdio: ["ignore", "pipe", "pipe"] });
    c.stdout.pipe(o); let err = ""; c.stderr.on("data", d => err += d);
    const timer = setTimeout(() => c.kill("SIGTERM"), 20 * 60_000);
    c.on("close", code => { clearTimeout(timer); o.end(() => done({ code, wallMs: Date.now() - t0, stderrTail: err.slice(-400), ...usageOf(out) })); });
  });
}
function usageOf(p) {
  const ev = readFileSync(p, "utf8").split("\n").flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
  const a = ev.filter(e => e.type === "message_end" && e.message?.role === "assistant");
  return { turns: a.length, cost: a.reduce((s, e) => s + (e.message.usage?.cost?.total || 0), 0), stop: a.at(-1)?.message?.stopReason, error: a.at(-1)?.message?.errorMessage };
}
const specs = Object.fromEntries(readFileSync(join(P, "specs.md"), "utf8").split(/<!-- spec: /).slice(1).map(s => { const [id, ...rest] = s.split(" -->"); return [id.trim(), rest.join(" -->").trim()]; }));

async function one(id) {
  const dir = join(OUT, id); mkdirSync(dir, { recursive: true });
  if (existsSync(join(dir, "result.json"))) { log("SKIP done " + id); return; }
  writeFileSync(join(dir, "spec.md"), specs[id] + "\n");
  copyFileSync(EXAMPLE, join(dir, "example.author.json"));
  const hist = []; let feedback = null;
  for (let r = 1; r <= rounds; r++) {
    if (feedback) writeFileSync(join(dir, "feedback.json"), JSON.stringify(feedback, null, 2));
    if (existsSync(join(dir, "author.json"))) renameSync(join(dir, "author.json"), join(dir, "author-prev.json"));
    rmSync(join(dir, "audit.json"), { force: true });
    const ap = readFileSync(join(P, "AUTHOR_NEW.md"), "utf8") + (feedback ? `\n\nREVISION ROUND ${r}: read feedback.json and author-prev.json; fix every item; write a complete new author.json.` : "");
    const ra = await runPi(dir, AUTHOR, ap, join(dir, `author-r${r}.jsonl`));
    const ck = checkNew(dir, id); writeFileSync(join(dir, "check.json"), JSON.stringify(ck, null, 2));
    if (existsSync(join(dir, "author.json"))) copyFileSync(join(dir, "author.json"), join(dir, `author-r${r}.json`));
    let audit = null, rv = null;
    if (ck.ok) {
      rv = await runPi(dir, AUDITOR, readFileSync(join(P, "AUDITOR_NEW.md"), "utf8"), join(dir, `audit-r${r}.jsonl`));
      try { audit = JSON.parse(readFileSync(join(dir, "audit.json"), "utf8")); copyFileSync(join(dir, "audit.json"), join(dir, `audit-r${r}.json`)); } catch {}
    }
    const verdict = audit?.verdict ?? (ck.ok ? "AUDIT_UNPARSED" : "CHECK_FAILED");
    hist.push({ round: r, author: ra, check: { ok: ck.ok, errors: ck.errors, warnings: ck.warnings }, auditor: rv, verdict });
    log(`${id} round ${r}: author exit=${ra.code} cost=${ra.cost.toFixed(3)} ${ra.error ?? ""} check=${ck.ok ? "ok" : "FAIL " + ck.errors.join("; ")} audit=${verdict}`);
    if (verdict === "PASS") break;
    feedback = { mechanicalErrors: ck.errors, mechanicalWarnings: ck.warnings, audit };
  }
  writeFileSync(join(dir, "result.json"), JSON.stringify({ rule_id: id, status: hist.at(-1).verdict, rounds: hist,
    authorJsonSha256: existsSync(join(dir, "author.json")) ? sha256(readFileSync(join(dir, "author.json"))) : null,
    cost: hist.reduce((s, x) => s + (x.author.cost || 0) + (x.auditor?.cost || 0), 0) }, null, 2));
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  mkdirSync(OUT, { recursive: true });
  log("gap fleet start: " + Object.keys(specs).join(", "));
  await Promise.all(Object.keys(specs).map(id => one(id).catch(e => log("ERROR " + id + " " + e.message))));
  log("gap fleet done");
}
