// Mechanical check of author.json against segments.json (no judgement).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { FACT_KINDS, OBSERVABILITY } from "./lib.mjs";

const FIXTURE_TOKENS = /\b(orders?-service|OrderStateError|UnknownRegionError|quoteForCart|getTaxRate|withCustomer|SHP-001|PRC-TAX|ORD-CANCEL|loyalty|PLT-\d+)\b/i;
export function check(dir) {
  const errors = [], warnings = [];
  const segs = JSON.parse(readFileSync(join(dir, "segments.json"), "utf8")).segments;
  let a;
  try { a = JSON.parse(readFileSync(join(dir, "author.json"), "utf8")); } catch (e) { return { ok: false, errors: ["author.json missing or invalid JSON: " + e.message], warnings, stats: {} }; }
  const src = readFileSync(join(dir, "source.convention.yaml"), "utf8");
  for (const f of ["rule_id", "title", "given", "when", "then", "why"]) if (typeof a[f] !== "string" || !a[f].trim()) errors.push("missing field " + f);
  for (const f of ["prefer", "avoid", "unless", "evidence", "verifier_detail", "audit", "sharedNodes", "additions", "trace"]) if (!Array.isArray(a[f])) errors.push("field " + f + " must be an array");
  if (errors.length) return { ok: false, errors, warnings, stats: {} };
  if (!a.prefer.length) warnings.push("no prefer entries");
  if (!a.avoid.length) warnings.push("no avoid entries");
  if (!a.evidence.length) errors.push("no evidence entries");
  const act = a.activation ?? {};
  if (!Array.isArray(act.facts) || !act.facts.length) errors.push("activation.facts empty");
  for (const f of act.facts ?? []) {
    if (!FACT_KINDS.includes(f.fact)) errors.push("unknown activation fact kind: " + f.fact);
    if (!OBSERVABILITY.includes(f.observability)) errors.push("bad observability on " + f.fact);
  }
  if (!(act.fires?.length >= 1)) errors.push("activation.fires needs >=1 example");
  if (!(act.doesNotFire?.length >= 1)) errors.push("activation.doesNotFire needs >=1 example");
  // Trace coverage.
  const ids = new Set(segs.map(s => s.id)), seen = new Map();
  const shared = new Set(a.sharedNodes.map(n => n.id));
  for (const t of a.trace) {
    if (!ids.has(t.seg)) { errors.push("trace references unknown segment " + t.seg); continue; }
    if (seen.has(t.seg)) warnings.push("segment traced twice: " + t.seg);
    seen.set(t.seg, t);
    const dests = Array.isArray(t.dest) ? t.dest : [t.dest];
    if (!dests.length) errors.push(t.seg + ": empty dest");
    for (const d of dests) {
      const m = String(d).match(/^(identity|activation|given|when|then|why|audit|structure|dropped|(prefer|avoid|unless|evidence|verifier_detail)\[(\d+)\]|shared:(.+))$/);
      if (!m) { errors.push(t.seg + ": invalid dest " + d); continue; }
      if (m[2] && !(Number(m[3]) < a[m[2]].length)) errors.push(t.seg + ": " + d + " index out of range");
      if (m[4] && !shared.has(m[4])) errors.push(t.seg + ": shared node not declared " + m[4]);
      if (d === "dropped" && !(t.note && t.note.length >= 15)) errors.push(t.seg + ": dropped without a reason");
    }
  }
  for (const s of segs) if (!seen.has(s.id) && !s.autoDest) errors.push("segment not traced: " + s.id);
  // Overfitting lint (tokens not present in the source).
  const coder = [a.given, a.when, a.then, ...a.prefer, ...a.avoid, ...a.unless, a.why].join("\n");
  for (const m of coder.matchAll(new RegExp(FIXTURE_TOKENS, "gi"))) if (!src.includes(m[0])) warnings.push("possible overfit token: " + m[0]);
  const KNOWN = ["policy.phase-loop", "policy.agent-conduct", "policy.strict-disposition", "context.repo-topology.layers", "context.repo-topology.idioms"];
  for (const n of a.sharedNodes) if (!KNOWN.includes(n.id)) warnings.push("new shared node id (needs dedup review): " + n.id);
  const dropped = a.trace.filter(t => (Array.isArray(t.dest) ? t.dest : [t.dest]).includes("dropped")).length;
  const stats = { segments: segs.length, traced: seen.size, auto: segs.filter(s => s.autoDest && !seen.has(s.id)).length, dropped,
    coderChars: coder.length, sourceChars: src.length, sharedNodes: a.sharedNodes.length, additions: a.additions.length,
    needsNewObserver: (act.facts ?? []).filter(f => f.observability !== "observable_now").map(f => f.fact) };
  if (stats.coderChars > 1200) warnings.push("coder-facing text " + stats.coderChars + " chars (> 1200)");
  return { ok: errors.length === 0, errors, warnings, stats };
}
if (process.argv[1] === new URL(import.meta.url).pathname) console.log(JSON.stringify(check(process.argv[2]), null, 2));
