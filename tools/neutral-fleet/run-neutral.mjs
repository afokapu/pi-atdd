// PLT-84 stage 1: re-derive the pilot against the closed profile vocabulary, under PLT-87 ids.
// Copied from plt-80-proposal/fleet/run-neutral.mjs (run-neutral.pilot.mjs); changes: new ids, rule.json,
// vocabulary.yaml input, vocabulary check, runs-stage1 output.
// deriver (pi-claude-cli) -> neutrality lint + coverage check -> auditor (openai-codex) -> up to N rounds -> reviewer (kimi).
// Usage: node run-neutral.mjs <listfile> [--concurrency 5] [--rounds 3]
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, renameSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { FLEET, REPO, runPi, usageOf, sha256 } from "./lib.mjs";
const VOC = await import(join(REPO, "src/profile-vocabulary.ts"));
const VOCAB = VOC.loadVocabulary();

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const conc = Number(opt("--concurrency", 5)), maxRounds = Number(opt("--rounds", 3));
const ids = readFileSync(args[0], "utf8").split(/\s+/).filter(Boolean);
const OUT = join(FLEET, "runs-stage1");
const SIDECAR = join(REPO, "conventions-sidecar");
const manifest = JSON.parse(readFileSync(join(SIDECAR, "manifest.json"), "utf8"));
const log = (m) => { const l = new Date().toISOString() + " " + m; console.log(l); appendFileSync(join(FLEET, "stage1.log"), l + "\n"); };
const J = (p) => JSON.parse(readFileSync(p, "utf8"));
const LEAK = /\b(bun|bunx|bun:|node:|deno|npm|pnpm|yarn|typescript|javascript|tsx?|jsx?|htmx|playwright|vitest|jest|python|pytest|fastapi|django|express\.js|expressjs|fastify|koa|hono|react|vue|svelte|package\.json|tsconfig|lockfile\s*\(bun)\b|\.(ts|tsx|js|mjs|py|go|java|rb)\b|(^|[\s`(])(src|tests?|e2e|plan|lib)\/|\*\*\/|<(source|test|plan|e2e)_root>/i;
const ROLE_FACTS = ["role", "operation", "change", "phase", "finding", "file_kind", "task_term", "task_has_acceptance"];

export function neutralCheck(dir) {
  const errors = [], warnings = [];
  let n; try { n = J(join(dir, "neutral.json")); } catch (e) { return { ok: false, errors: ["neutral.json missing/invalid: " + e.message], warnings }; }
  const b = J(join(dir, "bun.json")), c = n.core ?? {}, rule = J(join(dir, "rule.json"));
  if (n.rule_id !== rule.rule_id) errors.push("rule_id must be the PLT-87 id " + rule.rule_id + ", got " + n.rule_id);
  for (const f of ["title", "given", "when", "then", "why"]) if (typeof c[f] !== "string" || !c[f].trim()) errors.push("core." + f + " missing");
  for (const f of ["prefer", "avoid", "unless", "evidence"]) if (!Array.isArray(c[f])) errors.push("core." + f + " must be an array");
  if (errors.length) return { ok: false, errors, warnings };
  const coreText = [c.title, c.given, c.when, c.then, ...c.prefer, ...c.avoid, ...c.unless, c.why, ...c.evidence, ...(c.activation?.fires ?? []), ...(c.activation?.doesNotFire ?? [])];
  for (const t of coreText) { const m = String(t).match(LEAK); if (m) errors.push("neutrality leak '" + m[0] + "' in: " + String(t).slice(0, 120)); }
  for (const f of c.activation?.facts ?? []) { if (!ROLE_FACTS.includes(f.fact)) errors.push("core activation fact must be role-level, got " + f.fact); for (const v of f.values ?? []) { const m = String(v).match(LEAK); if (m) errors.push("neutrality leak in activation value: " + v); } }
  if (!(c.activation?.facts?.length && c.activation?.fires?.length && c.activation?.doesNotFire?.length)) errors.push("core activation facts/fires/doesNotFire required");
  const items = ["given", "when", "then", "why", ...["prefer", "avoid", "unless", "evidence", "verifier_detail"].flatMap(f => (b[f] ?? []).map((_, i) => f + "[" + i + "]")), ...(b.activation?.facts ?? []).map((_, i) => "activation.facts[" + i + "]")];
  const classified = new Set((n.classification ?? []).map(x => x.item));
  for (const it of items) if (!classified.has(it)) errors.push("Bun item not classified: " + it);
  const required = new Set(items);
  for (const x of n.classification ?? []) for (const a of x.as ?? []) if (!/^(core:(given|when|then|why|title|verification|(prefer|avoid|unless|evidence|verification)\[\d+\]|activation(\.facts\[\d+\])?)|profile:.+|bunOnly)$/.test(a)) (required.has(x.item) ? errors : warnings).push(x.item + ": invalid target " + a);
  const keys = new Set((n.profileRequirements ?? []).map(p => p.key));
  const proposed = new Map((n.proposedKeys ?? []).map(p => [p.key, p]));
  for (const p of n.profileRequirements ?? []) {
    if (typeof p.bunValue !== "string" || !p.bunValue.trim()) errors.push("profile key " + p.key + ": bunValue missing");
    if (VOC.isVocabularyKey(p.key, VOCAB)) continue;
    if (!proposed.has(p.key)) errors.push("profile key not in vocabulary and not proposed: " + p.key);
  }
  for (const [k, p] of proposed) {
    for (const pr of VOC.proposalProblems(k, VOCAB)) errors.push("proposed key " + k + ": " + pr);
    if (!p.whyNoExistingKey?.trim()) errors.push("proposed key " + k + ": whyNoExistingKey missing");
  }
  for (const x of n.classification ?? []) for (const a of x.as ?? []) if (a.startsWith("profile:") && !keys.has(a.slice(8))) errors.push(x.item + ": profile key not declared " + a);
  return { ok: errors.length === 0, errors, warnings, stats: { bunItems: items.length, coreChars: coreText.join("\n").length, bunChars: [b.title, b.given, b.when, b.then, ...(b.prefer ?? []), ...(b.avoid ?? []), ...(b.unless ?? []), b.why, ...(b.evidence ?? [])].join("\n").length, bunOnly: (n.bunOnly ?? []).length, profileKeys: keys.size, proposedKeys: proposed.size, keys: [...keys].sort() } };
}

async function one(id) {
  const dir = join(OUT, id); mkdirSync(dir, { recursive: true });
  let prior = null;
  if (existsSync(join(dir, "result.json"))) {
    if (!process.argv.includes("--revise")) { log("SKIP " + id); return; }
    prior = J(join(dir, "result.json")); if (prior.status === "PASS") { log("SKIP pass " + id); return; }
    renameSync(join(dir, "result.json"), join(dir, "result-r" + prior.rounds.length + ".json"));
  }
  const e = manifest.entries[id]; if (!e) { log("SKIP not a frozen single rewrite: " + id); return; }
  copyFileSync(join(SIDECAR, e.file), join(dir, "bun.json"));
  writeFileSync(join(dir, "rule.json"), JSON.stringify({ rule_id: id, legacyId: e.legacyId ?? id }, null, 2));
  copyFileSync(VOC.VOCABULARY_PATH, join(dir, "vocabulary.yaml"));
  copyFileSync(join(REPO, e.sourcePath), join(dir, "source.convention.yaml"));
  const bunSha = sha256(readFileSync(join(dir, "bun.json")));
  if (bunSha !== e.sidecarSha256) throw new Error("bun.json differs from frozen sidecar: " + id);
  const rounds = prior ? [...prior.rounds] : []; let feedback = prior ? { audit: existsSync(join(dir, "neutral-audit.json")) ? J(join(dir, "neutral-audit.json")) : null, note: "item list now also includes verifier_detail[i]; classify them" } : null;
  const firstRound = rounds.length + 1, lastRound = rounds.length + maxRounds;
  for (let r = firstRound; r <= lastRound; r++) {
    if (feedback) writeFileSync(join(dir, "feedback.json"), JSON.stringify(feedback, null, 2));
    if (existsSync(join(dir, "neutral.json"))) renameSync(join(dir, "neutral.json"), join(dir, "neutral-prev.json"));
    rmSync(join(dir, "neutral-audit.json"), { force: true });
    const prompt = readFileSync(join(FLEET, "NEUTRALIZER.md"), "utf8") + (feedback ? "\n\nREVISION ROUND " + r + ": previous output is neutral-prev.json; fix every item in feedback.json and write a complete new neutral.json." : "");
    await runPi({ cwd: dir, provider: "pi-claude-cli", model: "claude-opus-5-5", thinking: "medium", tools: "read,write,ls", prompt, out: join(dir, "neutral-r" + r + ".jsonl") });
    const ua = usageOf(join(dir, "neutral-r" + r + ".jsonl"));
    const ck = neutralCheck(dir); writeFileSync(join(dir, "neutral-check.json"), JSON.stringify(ck, null, 2));
    if (existsSync(join(dir, "neutral.json"))) copyFileSync(join(dir, "neutral.json"), join(dir, "neutral-r" + r + ".json"));
    let audit = null, uv = null;
    if (ck.ok) {
      await runPi({ cwd: dir, provider: "openai-codex", model: "gpt-6.1-sol", thinking: "medium", tools: "read,write,ls", prompt: readFileSync(join(FLEET, "NEUTRAL_AUDITOR.md"), "utf8"), out: join(dir, "neutral-audit-r" + r + ".jsonl") });
      uv = usageOf(join(dir, "neutral-audit-r" + r + ".jsonl"));
      try { audit = J(join(dir, "neutral-audit.json")); copyFileSync(join(dir, "neutral-audit.json"), join(dir, "neutral-audit-r" + r + ".json")); } catch {}
    }
    const verdict = audit?.verdict ?? (ck.ok ? "AUDIT_UNPARSED" : "CHECK_FAILED");
    rounds.push({ round: r, deriver: ua, check: { ok: ck.ok, errors: ck.errors.length }, auditor: uv, verdict });
    log(id + " round " + r + ": check=" + (ck.ok ? "ok" : "FAIL(" + ck.errors.length + ")") + " audit=" + (audit?.verdict ?? "-") + (audit ? " usefulness=" + audit.usefulness?.score : ""));
    if (verdict === "PASS") break;
    feedback = { mechanicalErrors: ck.errors, audit };
  }
  // Third-party review of the final core.
  const rp = `You are a third-party reviewer (different provider). Read bun.json (authoritative ATDD-Bun rewrite; its rule_id is the legacy id, rule.json has the current id), neutral.json (derived stack-neutral core) and neutral-audit.json. Do not modify them. Answer: (1) is the core faithful to bun.json (no weaker/stronger obligation)? (2) does the core leak any stack/path? (3) imagine a Python/Django codebase with the same roles: could an agent apply core + the Bun rewrite as a reference example correctly? score 1-5. Write review-neutral.json: {"rule_id":"...","faithful":true,"leaks":[],"pythonTransferScore":1,"risks":["..."],"agreeWithAuditor":true,"summary":"..."}. Reply REVIEWED.`;
  await runPi({ cwd: dir, provider: "kimi-coding", model: "k3.1-pro", thinking: "medium", tools: "read,write,ls", prompt: rp, out: join(dir, "review-neutral.jsonl") });
  let rv = null; try { rv = J(join(dir, "review-neutral.json")); } catch {}
  writeFileSync(join(dir, "result.json"), JSON.stringify({ rule_id: id, status: rounds.at(-1).verdict, bunSidecarSha256: bunSha, rounds, stats: neutralCheck(dir).stats,
    review: rv && { faithful: rv.faithful, leaks: rv.leaks, pythonTransferScore: rv.pythonTransferScore, agreeWithAuditor: rv.agreeWithAuditor },
    cost: rounds.reduce((s, x) => s + (x.deriver?.cost || 0) + (x.auditor?.cost || 0), 0) + usageOf(join(dir, "review-neutral.jsonl")).cost }, null, 2));
  log(id + " done: " + rounds.at(-1).verdict + " review faithful=" + rv?.faithful + " python=" + rv?.pythonTransferScore);
}
export async function recheck(id) {
  const dir = join(OUT, id), r = J(join(dir, "result.json"));
  if (r.status !== "CHECK_FAILED") return;
  const ck = neutralCheck(dir); writeFileSync(join(dir, "neutral-check.json"), JSON.stringify(ck, null, 2));
  log(id + " recheck (checker fix): " + (ck.ok ? "ok" : "FAIL " + ck.errors.join(" | ").slice(0, 200)));
  if (!ck.ok) return;
  rmSync(join(dir, "neutral-audit.json"), { force: true });
  const n = r.rounds.length;
  await runPi({ cwd: dir, provider: "openai-codex", model: "gpt-6.1-sol", thinking: "medium", tools: "read,write,ls", prompt: readFileSync(join(FLEET, "NEUTRAL_AUDITOR.md"), "utf8"), out: join(dir, "neutral-audit-r" + n + "-recheck.jsonl") });
  let audit = null; try { audit = J(join(dir, "neutral-audit.json")); } catch {}
  r.rounds.at(-1).recheck = { reason: "checker bug fixed (activation.facts / verification targets; 'express' as English verb); same neutral.json re-audited", verdict: audit?.verdict ?? "AUDIT_UNPARSED" };
  r.status = audit?.verdict ?? "AUDIT_UNPARSED"; r.stats = ck.stats;
  writeFileSync(join(dir, "result.json"), JSON.stringify(r, null, 2));
  log(id + " recheck audit=" + r.status + " usefulness=" + audit?.usefulness?.score);
}
if (process.argv.includes("--recheck")) { for (const id of ids) await recheck(id); process.exit(0); }
if (process.argv[1] === new URL(import.meta.url).pathname) {
  log("neutral start: " + ids.length);
  const q = [...ids]; let busy = 0;
  await new Promise(fin => { const pump = () => { while (busy < conc && q.length) { busy++; one(q.shift()).catch(e => log("ERROR " + e.message)).finally(() => { busy--; pump(); }); } if (!q.length && !busy) fin(); }; pump(); });
  log("neutral done");
}
