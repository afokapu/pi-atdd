// Lossless split of conventions that cannot hold one obligation:
// splitter (anthropic) -> mechanical split check -> split auditor (openai-codex) -> reviewer (kimi), up to N rounds.
// Usage: node run-split.mjs <listfile> [--concurrency 5] [--rounds 3]
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, appendFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FLEET, FACT_KINDS, OBSERVABILITY, runPi, usageOf } from "./lib.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const conc = Number(opt("--concurrency", 5)), maxRounds = Number(opt("--rounds", 3));
const ids = readFileSync(args[0], "utf8").split(/\s+/).filter(Boolean);
const OUT = join(FLEET, "runs-split");
const log = (m) => { const l = new Date().toISOString() + " " + m; console.log(l); appendFileSync(join(FLEET, "split.log"), l + "\n"); };
const audience = (id) => /^coder\./.test(id) ? "coder (implements source code)" : /^planner\./.test(id) ? "planner (authors plans, wagons, WMBTs, acceptances, docs)" : "agent";
const J = (p) => JSON.parse(readFileSync(p, "utf8"));

export function splitCheck(dir) {
  const errors = [], warnings = [];
  let s; try { s = J(join(dir, "split.json")); } catch (e) { return { ok: false, errors: ["split.json missing/invalid: " + e.message], warnings }; }
  const segs = J(join(dir, "segments.json")).segments, graph = J(join(dir, "graph.json"));
  const src = s.source_rule_id;
  if (!Array.isArray(s.parts) || !s.parts.length) return { ok: false, errors: ["no parts"], warnings };
  const partIds = new Set();
  for (const p of s.parts) {
    if (!p.rule_id?.startsWith(src + ".") && !(s.parts.length === 1 && p.rule_id === src)) errors.push("part id must be <source>.<suffix>: " + p.rule_id);
    if (partIds.has(p.rule_id)) errors.push("duplicate part id " + p.rule_id); partIds.add(p.rule_id);
    for (const f of ["title", "given", "when", "then", "why"]) if (typeof p[f] !== "string" || !p[f].trim()) errors.push(p.rule_id + ": missing " + f);
    for (const f of ["prefer", "avoid", "unless", "evidence", "verifier_detail", "audit", "additions"]) if (!Array.isArray(p[f])) errors.push(p.rule_id + ": " + f + " must be an array");
    for (const f of p.activation?.facts ?? []) { if (!FACT_KINDS.includes(f.fact)) errors.push(p.rule_id + ": unknown fact " + f.fact); if (!OBSERVABILITY.includes(f.observability)) errors.push(p.rule_id + ": bad observability"); }
    if (!(p.activation?.facts?.length && p.activation?.fires?.length && p.activation?.doesNotFire?.length)) errors.push(p.rule_id + ": activation facts/fires/doesNotFire required");
  }
  const shared = new Set((s.sharedNodes ?? []).map(n => n.id)), seen = new Set();
  for (const t of s.trace ?? []) {
    seen.add(t.seg);
    for (const d of (Array.isArray(t.dest) ? t.dest : [t.dest])) {
      const m = String(d).match(/^(?:(audit|structure|dropped)|shared:(.+)|([^:]+):(identity|activation|given|when|then|why|title|(prefer|avoid|unless|evidence|verifier_detail|audit|additions)(?:\[(\d+)\])?))$/);
      if (!m) { errors.push(t.seg + ": invalid dest " + d); continue; }
      if (m[2] && !shared.has(m[2])) errors.push(t.seg + ": undeclared shared " + m[2]);
      if (m[3]) { const p = s.parts.find(x => x.rule_id === m[3]); if (!p) errors.push(t.seg + ": unknown part " + m[3]); else if (m[5] && m[6] !== undefined && !(Number(m[6]) < (p[m[5]] ?? []).length)) errors.push(t.seg + ": " + d + " index out of range"); }
      if (m[1] === "dropped" && !(t.note?.length >= 15)) errors.push(t.seg + ": dropped without reason");
    }
  }
  for (const g of segs) if (!seen.has(g.id) && !g.autoDest) errors.push("segment not traced: " + g.id);
  for (const e of graph) if (!(s.edgeRemap ?? []).some(r => r.original?.source_ref === e.source_ref && r.original?.target_ref === e.target_ref && r.original?.type === e.type)) errors.push("existing edge not remapped: " + e.source_ref + " -" + e.type + "-> " + e.target_ref);
  for (const e of s.edges ?? []) if (![...partIds].includes(e.source) && ![...partIds].includes(e.target)) warnings.push("edge not touching any part: " + e.source + "->" + e.target);
  const chars = s.parts.map(p => [p.given, p.when, p.then, ...p.prefer, ...p.avoid, ...p.unless, p.why].join("\n").length);
  return { ok: errors.length === 0, errors, warnings, stats: { parts: s.parts.length, segments: segs.length, partChars: chars, sourceChars: readFileSync(join(dir, "source.convention.yaml"), "utf8").length } };
}

async function one(id) {
  const dir = join(OUT, id); mkdirSync(dir, { recursive: true });
  if (existsSync(join(dir, "result.json"))) { log("SKIP " + id); return; }
  const R = join(FLEET, "runs", id);
  for (const f of ["source.convention.yaml", "segments.json", "graph.json"]) copyFileSync(join(R, f), join(dir, f));
  const pick = (...names) => names.map(n => join(R, n)).find(existsSync);
  copyFileSync(pick("author.json", "author-prev.json"), join(dir, "previous-author.json"));
  if (pick("audit.json")) copyFileSync(pick("audit.json"), join(dir, "previous-audit.json"));
  if (pick("review.json")) copyFileSync(pick("review.json"), join(dir, "previous-review.json"));
  const rounds = []; let feedback = null;
  for (let r = 1; r <= maxRounds; r++) {
    if (feedback) writeFileSync(join(dir, "feedback.json"), JSON.stringify(feedback, null, 2));
    if (existsSync(join(dir, "split.json"))) renameSync(join(dir, "split.json"), join(dir, "split-prev.json"));
    rmSync(join(dir, "split-audit.json"), { force: true });
    const prompt = readFileSync(join(FLEET, "SPLITTER.md"), "utf8") + "\n\nAUDIENCE: " + audience(id) + "." + (feedback ? "\n\nREVISION ROUND " + r + ": previous split is split-prev.json; fix every item in feedback.json and write a complete new split.json." : "");
    await runPi({ cwd: dir, provider: "anthropic", model: "claude-opus-5-5", thinking: "medium", tools: "read,write,ls", prompt, out: join(dir, "split-r" + r + ".jsonl") });
    const ua = usageOf(join(dir, "split-r" + r + ".jsonl"));
    const ck = splitCheck(dir); writeFileSync(join(dir, "split-check.json"), JSON.stringify(ck, null, 2));
    if (existsSync(join(dir, "split.json"))) copyFileSync(join(dir, "split.json"), join(dir, "split-r" + r + ".json"));
    let audit = null, uv = null;
    if (ck.ok) {
      await runPi({ cwd: dir, provider: "openai-codex", model: "gpt-6.1-sol", thinking: "medium", tools: "read,write,ls", prompt: readFileSync(join(FLEET, "SPLIT_AUDITOR.md"), "utf8"), out: join(dir, "split-audit-r" + r + ".jsonl") });
      uv = usageOf(join(dir, "split-audit-r" + r + ".jsonl"));
      try { audit = J(join(dir, "split-audit.json")); copyFileSync(join(dir, "split-audit.json"), join(dir, "split-audit-r" + r + ".json")); } catch {}
    }
    const verdict = audit?.verdict ?? (ck.ok ? "AUDIT_UNPARSED" : "CHECK_FAILED");
    rounds.push({ round: r, splitter: ua, check: { ok: ck.ok, errors: ck.errors.length }, auditor: uv, verdict, parts: ck.stats?.parts });
    log(id + " round " + r + ": check=" + (ck.ok ? "ok" : "FAIL(" + ck.errors.length + ")") + " parts=" + (ck.stats?.parts ?? "-") + " audit=" + (audit?.verdict ?? "-"));
    if (verdict === "PASS") break;
    feedback = { mechanicalErrors: ck.errors, audit };
  }
  writeFileSync(join(dir, "result.json"), JSON.stringify({ source_rule_id: id, status: rounds.at(-1).verdict, rounds, stats: splitCheck(dir).stats,
    cost: rounds.reduce((s, x) => s + (x.splitter?.cost || 0) + (x.auditor?.cost || 0), 0) }, null, 2));
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  log("split start: " + ids.length);
  const q = [...ids]; let busy = 0;
  await new Promise(fin => { const pump = () => { while (busy < conc && q.length) { busy++; one(q.shift()).catch(e => log("ERROR " + e.message)).finally(() => { busy--; pump(); }); } if (!q.length && !busy) fin(); }; pump(); });
  log("split done");
}
