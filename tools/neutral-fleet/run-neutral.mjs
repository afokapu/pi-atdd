// PLT-84: derive the stack-neutral core of each convention against the closed profile vocabulary, under PLT-87 ids.
// deriver (--deriver, default zai/glm-5.3) -> neutrality lint + coverage + vocabulary check -> auditor (openai-codex)
// -> up to N rounds -> optional fallback deriver (--fallback, budgeted by --fallback-ledger/--fallback-max) -> reviewer (kimi).
// Stops dequeuing and fails the run on the first quota / rate-limit error (owner rule: never switch provider silently).
// Usage: node run-neutral.mjs <listfile> --out <dir> [--deriver p/m] [--concurrency 10] [--rounds 3]
//          [--audit-cap 6] [--review-cap 4] [--fallback pi-claude-cli/claude-opus-5-5 --fallback-ledger <file> --fallback-max 20]
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, renameSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { FLEET, REPO, runPi, usageOf, sha256 } from "./lib.mjs";
const VOC = await import(join(REPO, "src/profile-vocabulary.ts"));
const VOCAB = VOC.loadVocabulary();
const LINT = await import(join(REPO, "src/neutral-lint.ts"));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const conc = Number(opt("--concurrency", 5)), maxRounds = Number(opt("--rounds", 3));
const split = (pm) => { const i = pm.indexOf("/"); return { provider: pm.slice(0, i), model: pm.slice(i + 1), id: pm }; };
const DERIVER = split(opt("--deriver", "zai/glm-5.3"));
const FALLBACK = opt("--fallback", null) ? split(opt("--fallback")) : null;
const LEDGER = opt("--fallback-ledger", null), FALLBACK_MAX = Number(opt("--fallback-max", 0));
const sem = (n) => { let busy = 0; const q = []; return async (fn) => { while (busy >= n) await new Promise(r => q.push(r)); busy++; try { return await fn(); } finally { busy--; q.shift()?.(); } }; };
const auditSlot = sem(Number(opt("--audit-cap", 6))), reviewSlot = sem(Number(opt("--review-cap", 4)));
let QUOTA = null;
// Owner rule (2026-11-19): a 429 that pi retries successfully is not a stop. Stop only on quota exhaustion,
// or when a call still fails on rate limits after backoff. Deriver concurrency is adaptive: start --deriver-start
// (3), +1 after --clean-stretch (5) consecutive deriver calls without any 429 (max --deriver-max 6), -1 at a 429.
const EXHAUSTED_RE = /insufficient (balance|quota)|quota (exceeded|exhausted)|usage limit|limit exceeded for (the )?(plan|package|subscription)|out of credits|billing|\b1113\b|resource package/i;
const RATE_RE = /\b429\b|rate.?limit|too many requests|\b1302\b/i;
const adaptive = (start, max, stretch) => {
  let limit = start, busy = 0, clean = 0; const q = [], hist = [];
  const wake = () => { while (busy < limit && q.length) { busy++; q.shift()(); } };
  return {
    get limit() { return limit; }, hist,
    async run(fn) { await new Promise(r => { q.push(r); wake(); }); try { return await fn(); } finally { busy--; wake(); } },
    report(saw429) {
      if (saw429) { clean = 0; if (limit > 1) { limit--; hist.push({ at: new Date().toISOString(), limit, why: "429" }); log("ADAPT deriver concurrency -> " + limit + " (429)"); } }
      else if (++clean >= stretch && limit < max) { clean = 0; limit++; hist.push({ at: new Date().toISOString(), limit, why: "clean" }); log("ADAPT deriver concurrency -> " + limit + " (clean stretch)"); wake(); }
    },
  };
};
const derivSlot = adaptive(Number(opt("--deriver-start", 3)), Number(opt("--deriver-max", 6)), Number(opt("--clean-stretch", 5)));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const count429 = (path) => { try { return (readFileSync(path, "utf8").match(/Rate limit reached|\b429:/g) ?? []).length; } catch { return 0; } };
async function pi(label, o, { adaptiveSlot = null, attempts = 3 } = {}) {
  for (let a = 1; a <= attempts; a++) {
    if (QUOTA) throw new Error("QUOTA stop in effect");
    const out = a === 1 ? o.out : o.out.replace(/\.jsonl$/, "-retry" + a + ".jsonl");
    const res = await runPi({ ...o, out }); const u = usageOf(out);
    const msg = [u?.error, res?.stderrTail].filter(Boolean).join(" | ");
    const n429 = count429(out); if (n429) u.retried429 = n429;
    if (adaptiveSlot) adaptiveSlot.report(n429 > 0);
    if (EXHAUSTED_RE.test(msg)) { QUOTA = label + ": " + msg.slice(0, 300); throw new Error("QUOTA " + QUOTA); }
    const failed = u.stop === "error" || u.turns === 0;
    if (!failed) { if (out !== o.out) copyFileSync(out, o.out); return { ...u, attempts: a }; }
    if (RATE_RE.test(msg) && a < attempts) { const wait = 60_000 * a; log("BACKOFF " + label + " attempt " + a + " still rate-limited; waiting " + wait / 1000 + "s"); await sleep(wait); continue; }
    if (RATE_RE.test(msg)) { QUOTA = label + ": rate-limited after " + attempts + " attempts with backoff: " + msg.slice(0, 200); throw new Error("QUOTA " + QUOTA); }
    log("WARN " + label + " ended without a normal stop: " + msg.slice(0, 200));
    return { ...u, attempts: a };
  }
}
const ids = readFileSync(args[0], "utf8").split(/\s+/).filter(Boolean);
const OUT = opt("--out", join(FLEET, "runs-stage1")); mkdirSync(OUT, { recursive: true });
const SIDECAR = join(REPO, "conventions-sidecar");
const manifest = JSON.parse(readFileSync(join(SIDECAR, "manifest.json"), "utf8"));
// Split parts (PLT-81 splits/, PLT-87 aliases.splitParts): new part id -> { split entry, legacy part id }.
const partLegacy = Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(REPO, "conventions/aliases.json"), "utf8")).splitParts ?? {}).map(([o, n]) => [n, o]));
const PARTS = {}; for (const se of Object.values(manifest.splits ?? {})) for (const p of se.parts) PARTS[p] = { se, legacy: partLegacy[p] };
const log = (m) => { const l = new Date().toISOString() + " " + m; console.log(l); appendFileSync(join(OUT, "fleet.log"), l + "\n"); };
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
  // Same lint as the repo test (src/neutral-lint.ts): also scans core.verification; artifact-kind prose allowed.
  for (const l of LINT.neutralityLeaks(c)) errors.push("neutrality leak " + l);
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
  const part = PARTS[id], e = manifest.entries[id] ?? part?.se;
  if (!e) { log("SKIP not a frozen rewrite or split part: " + id); return; }
  let bunSha;
  if (part) {
    // The realization is one part of a frozen split; the split file is pinned, the part is extracted verbatim.
    const splitBytes = readFileSync(join(SIDECAR, e.file));
    if (sha256(splitBytes) !== e.sidecarSha256) throw new Error("split differs from frozen sidecar: " + id);
    const p = JSON.parse(splitBytes.toString("utf8")).parts.find(x => x.rule_id === part.legacy);
    if (!p) throw new Error("part " + part.legacy + " not in " + e.file);
    writeFileSync(join(dir, "bun.json"), JSON.stringify(p, null, 2) + "\n");
    bunSha = e.sidecarSha256;
  } else {
    copyFileSync(join(SIDECAR, e.file), join(dir, "bun.json"));
    bunSha = sha256(readFileSync(join(dir, "bun.json")));
    if (bunSha !== e.sidecarSha256) throw new Error("bun.json differs from frozen sidecar: " + id);
  }
  writeFileSync(join(dir, "rule.json"), JSON.stringify({ rule_id: id, legacyId: part ? part.legacy : (e.legacyId ?? id), ...(part ? { splitOf: e.legacyId } : {}) }, null, 2));
  copyFileSync(VOC.VOCABULARY_PATH, join(dir, "vocabulary.yaml"));
  copyFileSync(join(REPO, e.sourcePath), join(dir, "source.convention.yaml"));
  const rounds = prior ? [...prior.rounds] : []; let feedback = prior ? { audit: existsSync(join(dir, "neutral-audit.json")) ? J(join(dir, "neutral-audit.json")) : null, note: "item list now also includes verifier_detail[i]; classify them" } : null;
  const firstRound = rounds.length + 1; let lastRound = rounds.length + maxRounds, deriver = DERIVER;
  for (let r = firstRound; r <= lastRound; r++) {
    if (feedback) writeFileSync(join(dir, "feedback.json"), JSON.stringify(feedback, null, 2));
    if (existsSync(join(dir, "neutral.json"))) renameSync(join(dir, "neutral.json"), join(dir, "neutral-prev.json"));
    rmSync(join(dir, "neutral-audit.json"), { force: true });
    const prompt = readFileSync(join(FLEET, "NEUTRALIZER.md"), "utf8") + (feedback ? "\n\nREVISION ROUND " + r + ": previous output is neutral-prev.json; fix every item in feedback.json and write a complete new neutral.json." : "");
    const dcall = () => pi(id + " deriver r" + r, { cwd: dir, provider: deriver.provider, model: deriver.model, thinking: "medium", tools: "read,write,ls", prompt, out: join(dir, "neutral-r" + r + ".jsonl") }, deriver === DERIVER ? { adaptiveSlot: derivSlot } : {});
    const ua = deriver === DERIVER ? await derivSlot.run(dcall) : await dcall();
    const ck = neutralCheck(dir); writeFileSync(join(dir, "neutral-check.json"), JSON.stringify(ck, null, 2));
    if (existsSync(join(dir, "neutral.json"))) copyFileSync(join(dir, "neutral.json"), join(dir, "neutral-r" + r + ".json"));
    let audit = null, uv = null;
    if (ck.ok) {
      uv = await auditSlot(() => pi(id + " auditor r" + r, { cwd: dir, provider: "openai-codex", model: "gpt-6.1-sol", thinking: "medium", tools: "read,write,ls", prompt: readFileSync(join(FLEET, "NEUTRAL_AUDITOR.md"), "utf8"), out: join(dir, "neutral-audit-r" + r + ".jsonl") }));
      try { audit = J(join(dir, "neutral-audit.json")); copyFileSync(join(dir, "neutral-audit.json"), join(dir, "neutral-audit-r" + r + ".json")); } catch {}
    }
    const verdict = audit?.verdict ?? (ck.ok ? "AUDIT_UNPARSED" : "CHECK_FAILED");
    rounds.push({ round: r, deriverModel: deriver.id, deriver: ua, check: { ok: ck.ok, errors: ck.errors.length }, auditor: uv, verdict });
    log(id + " round " + r + ": check=" + (ck.ok ? "ok" : "FAIL(" + ck.errors.length + ")") + " audit=" + (audit?.verdict ?? "-") + (audit ? " usefulness=" + audit.usefulness?.score : ""));
    if (verdict === "PASS") break;
    feedback = { mechanicalErrors: ck.errors, audit };
    if (r === lastRound && deriver === DERIVER && FALLBACK && LEDGER) {
      const used = existsSync(LEDGER) ? readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).length : 0;
      if (used < FALLBACK_MAX) {
        appendFileSync(LEDGER, JSON.stringify({ rule_id: id, at: new Date().toISOString(), after: DERIVER.id + " x" + maxRounds, lastVerdict: verdict }) + "\n");
        deriver = FALLBACK; lastRound += maxRounds;
        log("FALLBACK " + id + " -> " + FALLBACK.id + " (" + (used + 1) + "/" + FALLBACK_MAX + ")");
      } else log("FALLBACK budget exhausted; " + id + " stays " + verdict);
    }
  }
  // Third-party review of the final core.
  const rp = `You are a third-party reviewer (different provider). Read bun.json (authoritative ATDD-Bun rewrite; its rule_id is the legacy id, rule.json has the current id), neutral.json (derived stack-neutral core) and neutral-audit.json. Do not modify them. Answer: (1) is the core faithful to bun.json (no weaker/stronger obligation)? (2) does the core leak any stack/path? (3) imagine a Python/Django codebase with the same roles: could an agent apply core + the Bun rewrite as a reference example correctly? score 1-5. Write review-neutral.json: {"rule_id":"...","faithful":true,"leaks":[],"pythonTransferScore":1,"risks":["..."],"agreeWithAuditor":true,"summary":"..."}. Reply REVIEWED.`;
  await reviewSlot(() => pi(id + " reviewer", { cwd: dir, provider: "kimi-coding", model: "k3.1-pro", thinking: "medium", tools: "read,write,ls", prompt: rp, out: join(dir, "review-neutral.jsonl") }));
  let rv = null; try { rv = J(join(dir, "review-neutral.json")); } catch {}
  writeFileSync(join(dir, "result.json"), JSON.stringify({ rule_id: id, status: rounds.at(-1).verdict, deriver: DERIVER.id, fallbackUsed: rounds.some(x => x.deriverModel !== DERIVER.id), bunSidecarSha256: bunSha, rounds, stats: neutralCheck(dir).stats,
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
// Re-run only the third-party review (e.g. after a network timeout) and refresh result.json's review field.
export async function rereview(id) {
  const dir = join(OUT, id), r = J(join(dir, "result.json"));
  const src = readFileSync(new URL(import.meta.url), "utf8"), rp = eval(src.slice(src.indexOf("const rp = ") + 11, src.indexOf("`;", src.indexOf("const rp = ")) + 1));
  rmSync(join(dir, "review-neutral.json"), { force: true });
  await reviewSlot(() => pi(id + " reviewer (re-run)", { cwd: dir, provider: "kimi-coding", model: "k3.1-pro", thinking: "medium", tools: "read,write,ls", prompt: rp, out: join(dir, "review-neutral-rerun.jsonl") }));
  let rv = null; try { rv = J(join(dir, "review-neutral.json")); } catch {}
  r.review = rv && { faithful: rv.faithful, leaks: rv.leaks, pythonTransferScore: rv.pythonTransferScore, agreeWithAuditor: rv.agreeWithAuditor, rerun: true };
  writeFileSync(join(dir, "result.json"), JSON.stringify(r, null, 2));
  log(id + " re-review: faithful=" + rv?.faithful + " python=" + rv?.pythonTransferScore);
}
if (process.argv.includes("--rereview")) { for (const id of ids) await rereview(id); process.exit(0); }
if (process.argv.includes("--recheck")) { for (const id of ids) await recheck(id); process.exit(0); }
if (process.argv[1] === new URL(import.meta.url).pathname) {
  log("neutral start: " + ids.length + " deriver=" + DERIVER.id + " concurrency=" + conc + (FALLBACK ? " fallback=" + FALLBACK.id + " max " + FALLBACK_MAX : ""));
  const q = [...ids]; let busy = 0;
  await new Promise(fin => { const pump = () => { while (busy < conc && q.length && !QUOTA) { busy++; one(q.shift()).catch(e => log("ERROR " + e.message)).finally(() => { busy--; pump(); }); } if ((!q.length || QUOTA) && !busy) fin(); }; pump(); });
  log("deriver concurrency history: " + JSON.stringify(derivSlot.hist));
  if (QUOTA) { log("STOPPED on quota error: " + QUOTA + "; not started: " + q.length); process.exit(3); }
  log("neutral done");
}
