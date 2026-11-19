// PLT-80 lossless-move fleet: author (anthropic) -> mechanical check -> independent
// auditor (openai-codex) -> up to N revision rounds. One isolated workdir per convention.
// Usage: node run-fleet.mjs <rule_id,...|@listfile> [--concurrency 3] [--rounds 2]
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { FLEET, VENDOR, YAML, segment, runPi, usageOf, sha256 } from "./lib.mjs";
import { check } from "./check.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const conc = Number(opt("--concurrency", 3)), maxRounds = Number(opt("--rounds", 2));
const AUTHOR = { provider: "anthropic", model: "claude-opus-5-5", thinking: "medium", tools: "read,write,ls" };
const AUDITOR = { provider: "openai-codex", model: "gpt-6.1-sol", thinking: "medium", tools: "read,write,ls" };
const list = args[0].startsWith("@") ? readFileSync(args[0].slice(1), "utf8").split(/\s+/).filter(Boolean) : args[0].split(",");
const files = (d) => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : [p]; });
const index = Object.fromEntries(files(VENDOR).filter(f => f.endsWith(".convention.yaml")).map(f => [f.split("/").pop().replace(".convention.yaml", ""), f]));
const graph = YAML.parse(readFileSync(join(VENDOR, "atdd-bun/relationships.yaml"), "utf8"));
const RUNS = join(FLEET, "runs");
const revise = args.includes("--revise");
const TAG = opt("--tag", "b1");
const ngFile = join(FLEET, "shared-notgeneric-" + TAG + ".json");
const notGeneric = existsSync(ngFile) ? JSON.parse(readFileSync(ngFile, "utf8")) : {};
/** Who acts on the convention; "coder-facing" fields are written for this reader. */
const audience = (id) => /^(coder\.|atdd-bun\.topology|traceability\.source)/.test(id) ? "coder (implements source code)"
  : /^(tester\.|traceability\.test)/.test(id) ? "tester (writes and binds tests)"
  : /^(planner\.|atdd-bun\.planner|traceability\.plan)/.test(id) ? "planner (authors plans, wagons, WMBTs, acceptances, docs)"
  : /^(atdd-workflow|atdd-flow)/.test(id) ? "workflow agent (driver/coordinator managing branches, handovers and integration)"
  : /^atdd-bun\.review/.test(id) ? "reviewer agent (judges submissions)" : "agent configuring ATDD profiles";
const log = (m) => { const l = new Date().toISOString() + " " + m; console.log(l); appendFileSync(join(FLEET, "fleet.log"), l + "\n"); };

async function one(id) {
  const src = index[id]; if (!src) { log("SKIP unknown " + id); return; }
  const dir = join(RUNS, id); mkdirSync(dir, { recursive: true });
  let prev = null;
  if (revise) {
    if (!existsSync(join(dir, "result.json"))) { log("SKIP no prior run " + id); return; }
    if (existsSync(join(dir, "result-" + TAG + ".json"))) { log("SKIP already revised " + id); return; }
    const { renameSync } = await import("node:fs");
    for (const f of ["result", "audit", "review", "check"]) if (existsSync(join(dir, f + ".json"))) renameSync(join(dir, f + ".json"), join(dir, f + "-" + TAG + ".json"));
    prev = JSON.parse(readFileSync(join(dir, "result-" + TAG + ".json"), "utf8"));
  } else if (existsSync(join(dir, "result.json"))) { log("SKIP done " + id); return; }
  const text = readFileSync(src, "utf8");
  copyFileSync(src, join(dir, "source.convention.yaml"));
  const { segments } = segment(text);
  writeFileSync(join(dir, "segments.json"), JSON.stringify({ rule_id: id, sourceSha256: sha256(text), segments }, null, 2));
  writeFileSync(join(dir, "graph.json"), JSON.stringify((graph.edges ?? []).filter(e => e.source_ref === id || e.target_ref === id), null, 2));
  const rounds = prev ? [...prev.rounds] : [];
  let feedback = null;
  if (prev) {
    const J = (f) => existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8")) : null;
    feedback = { revisionReason: TAG + " revision: fix every open auditor finding, every third-party reviewer usability risk, and return rule-specific content wrongly moved into shared nodes",
      audit: J("audit-" + TAG + ".json"), thirdPartyReview: J("review-" + TAG + ".json"), sharedNodeItemsThatBelongInThisRule: notGeneric[id] ?? [] };
    copyFileSync(join(dir, "author.json"), join(dir, "author-" + TAG + ".json"));
  }
  const first = rounds.length + 1;
  for (let r = first; r < first + maxRounds; r++) {
    if (feedback) writeFileSync(join(dir, "feedback.json"), JSON.stringify(feedback, null, 2));
    const ap = readFileSync(join(FLEET, "AUTHOR.md"), "utf8") + "\n\nAUDIENCE for this convention: " + audience(id) + ". Write given/when/then/prefer/avoid/unless/why for THIS reader (the schema calls them coder-facing fields)." + (feedback ? "\n\nREVISION ROUND " + r + ": your previous version is author-prev.json; read feedback.json and fix every item; write a complete new author.json." : "");
    const { rmSync, renameSync } = await import("node:fs");
    if (existsSync(join(dir, "author.json"))) renameSync(join(dir, "author.json"), join(dir, "author-prev.json"));
    rmSync(join(dir, "audit.json"), { force: true });
    const ra = await runPi({ cwd: dir, ...AUTHOR, prompt: ap, out: join(dir, "author-r" + r + ".jsonl") });
    const ua = usageOf(join(dir, "author-r" + r + ".jsonl"));
    const ck = check(dir); writeFileSync(join(dir, "check.json"), JSON.stringify(ck, null, 2));
    if (existsSync(join(dir, "author.json"))) copyFileSync(join(dir, "author.json"), join(dir, "author-r" + r + ".json"));
    let audit = null, uv = null;
    if (ck.ok) {
      const rv = await runPi({ cwd: dir, ...AUDITOR, prompt: readFileSync(join(FLEET, "AUDITOR.md"), "utf8"), out: join(dir, "audit-r" + r + ".jsonl") });
      uv = usageOf(join(dir, "audit-r" + r + ".jsonl"));
      try { audit = JSON.parse(readFileSync(join(dir, "audit.json"), "utf8")); copyFileSync(join(dir, "audit.json"), join(dir, "audit-r" + r + ".json")); } catch { audit = null; }
    }
    rounds.push({ round: r, author: { exit: ra.code, ...ua }, check: { ok: ck.ok, errors: ck.errors.length, warnings: ck.warnings }, auditor: uv, verdict: audit?.verdict ?? (ck.ok ? "AUDIT_UNPARSED" : "CHECK_FAILED") });
    log(id + " round " + r + ": check=" + (ck.ok ? "ok" : "FAIL(" + ck.errors.length + ")") + " audit=" + (audit?.verdict ?? "-"));
    if (audit?.verdict === "PASS") break;
    feedback = { mechanicalErrors: ck.errors, mechanicalWarnings: ck.warnings, audit };
  }
  const last = rounds.at(-1);
  writeFileSync(join(dir, "result.json"), JSON.stringify({ rule_id: id, status: last.verdict, rounds, stats: check(dir).stats,
    cost: rounds.reduce((s, x) => s + (x.author.cost || 0) + (x.auditor?.cost || 0), 0) }, null, 2));
}
const queue = [...list]; let busy = 0;
log("fleet start: " + list.length + " conventions, concurrency " + conc);
await new Promise(done => { const pump = () => { while (busy < conc && queue.length) { busy++; one(queue.shift()).catch(e => log("ERROR " + e.message)).finally(() => { busy--; queue.length || busy ? pump() : done(); }); } if (!queue.length && !busy) done(); }; pump(); });
log("fleet done");
