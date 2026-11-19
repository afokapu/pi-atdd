/**
 * Mechanical lint for the PLT-82 gap proposals (no judgement):
 * schema fields, activation vocabulary (tools/convention-fleet FACT_KINDS), one-sentence THEN,
 * coder-facing size, stack neutrality (PLT-84 SN-002 style) and overfit to the PLT-82 fixture.
 * Usage: node lint.mjs   (exit 1 on any error)
 */
import { readdirSync, readFileSync } from "node:fs";
import { FACT_KINDS, OBSERVABILITY } from "../../tools/convention-fleet/lib.mjs";

const DIR = new URL("./conventions/", import.meta.url).pathname;
const STACK = /\b(bun|deno|node(js)?|typescript|javascript|python|java|go(lang)?|rust|htmx|react|playwright|vitest|jest|express|fastify|sql(ite)?|postgres|promise|await|async)\b|\.(ts|tsx|js|py)\b|\b(src|lib|app|features|wagons|commons)\/|\/(domain|application|integration|presentation)\//i;
const OVERFIT = /\b(loyalty|points?|lots?|redeem|redemption|orders?|euros?|cents|tax(es)?|discounts?|LOY-\d+|orders-service|InMemory\w+|createApp|idempotencyKey|expiresAt)\b|€/i;
const ALLOWED_OVERFIT_IN_TERMS = /^(discount)$/i; // generic money vocabulary allowed in llm-judged task_term values only
let errors = 0;
const report = [];
for (const f of readdirSync(DIR).filter(f => f.endsWith(".json")).sort()) {
  const c = JSON.parse(readFileSync(DIR + f, "utf8")), e = [], w = [];
  for (const k of ["rule_id", "title", "given", "when", "then", "why"]) if (typeof c[k] !== "string" || !c[k].trim()) e.push("missing " + k);
  for (const k of ["prefer", "avoid", "unless", "evidence"]) if (!Array.isArray(c[k])) e.push(k + " must be an array");
  if (!c.evidence?.length) e.push("no evidence");
  if (c.scope !== "core") e.push("scope must be core");
  if (!c.activation?.fires?.length || !c.activation?.doesNotFire?.length) e.push("fires/doesNotFire required");
  for (const fa of c.activation?.facts ?? []) {
    if (!FACT_KINDS.includes(fa.fact)) e.push("unknown fact " + fa.fact);
    if (!OBSERVABILITY.includes(fa.observability)) e.push("bad observability " + fa.observability);
  }
  if ((c.then.match(/\.\s/g) || []).length) e.push("THEN has more than one sentence");
  const coder = [c.title, c.given, c.when, c.then, ...c.prefer, ...c.avoid, ...c.unless, c.why].join("\n");
  const all = coder + "\n" + [...c.evidence, ...c.activation.fires, ...c.activation.doesNotFire].join("\n");
  const s = all.match(STACK); if (s) e.push("stack/path token: " + s[0]);
  const o = all.match(OVERFIT); if (o) e.push("PLT-82 fixture token: " + o[0]);
  for (const fa of c.activation.facts) for (const v of fa.values) { const m = String(v).match(STACK); if (m) e.push("stack token in activation: " + v); const ov = String(v).match(OVERFIT); if (ov && !ALLOWED_OVERFIT_IN_TERMS.test(ov[0])) e.push("fixture token in activation: " + v); }
  if (coder.length > 1200) w.push("coder-facing " + coder.length + " chars (> 1200)");
  errors += e.length;
  report.push({ rule_id: c.rule_id, coderChars: coder.length, errors: e, warnings: w });
}
for (const r of report) console.log((r.errors.length ? "FAIL " : "ok   ") + r.rule_id.padEnd(46) + String(r.coderChars).padStart(5) + " chars " + [...r.errors, ...r.warnings].join("; "));
process.exit(errors ? 1 : 0);
