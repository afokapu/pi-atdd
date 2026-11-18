/**
 * PLT-79: curate sanitised evidence into experiments/d008-weak-lift/results/ and
 * compute the preregistered verdict. Raw files stay local; only hashes and
 * sanitised summaries are committed. Run only after every scored run and
 * verdict exists. Usage: node curate.mjs <E>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { sha256File } from "./pi-run.mjs";
const { stripHeredocBodies } = await import(join(process.argv[2], "pi-atdd-extension-snapshot/src/shell-targets.ts"));

const HERE = new URL(".", import.meta.url).pathname;
const [E] = process.argv.slice(2);
const EVIDENCE = join(E, "..");
const OUT = join(HERE, "../results");
const prereg = JSON.parse(readFileSync(join(HERE, "../prereg.json"), "utf8"));
const tasks = JSON.parse(readFileSync(join(HERE, "../tasks.json"), "utf8"));
const tildeE = E.replace(homedir(), "~"), tildeEV = EVIDENCE.replace(homedir(), "~");
const san = (v) => JSON.parse(JSON.stringify(v).replaceAll(E, "<E>").replaceAll(EVIDENCE, "<evidence>").replaceAll(tildeE, "<E>").replaceAll(tildeEV, "<evidence>").replaceAll(homedir(), "~")
  .replace(/[A-Za-z0-9._%+-]+@(?!example\.invalid)[A-Za-z0-9.-]+\.[a-z]{2,}/g, "<email>"));
const sanText = (s) => s.replaceAll(E, "<E>").replaceAll(EVIDENCE, "<evidence>").replaceAll(tildeE, "<E>").replaceAll(tildeEV, "<evidence>").replaceAll(homedir(), "~");
const files = (d) => existsSync(d) ? readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? (["ws", ".jj", ".git", "submission", "oracle-run", "node_modules"].includes(n) ? [] : files(p)) : [p]; }) : [];
const readJson = (p) => existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
mkdirSync(join(OUT, "trials"), { recursive: true });

/**
 * Tool-argument audit for access outside the trial's own workspace. Path-taking
 * tools: the resolved path must stay inside the workspace. bash: every absolute
 * path in the command must be inside the workspace or a system location, there
 * is no `cd ..`/`../..` escape, and no reference to evaluator, prior-experiment,
 * pilot, other-trial, repository or agent-config locations. File CONTENT written
 * by edit/write is not audited (relative imports like ../../x are code, not access).
 */
function audit(jsonl, ownTrial) {
  if (!existsSync(jsonl)) return { violations: [], canonicalReads: 0 };
  const ws = join(E, "trials", ownTrial, "ws");
  const violations = [], canonical = [];
  const SENSITIVE = [/plt-79-evaluator/, /plt-78/, /\/pilots\//, /Github/i, /\.pi\/agents?/];
  const SYSTEM = /^\/(?:tmp|private\/tmp|dev|usr|bin|sbin|opt\/homebrew|var\/folders)\b/;
  for (const line of readFileSync(jsonl, "utf8").split("\n")) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== "tool_execution_start") continue;
    const a = e.args ?? {};
    const hits = [];
    if (typeof a.path === "string") {
      const abs = resolve(ws, a.path);
      if (abs.includes("pi-atdd-extension-snapshot")) canonical.push(e.toolName);
      else if (abs !== ws && !abs.startsWith(ws + "/")) hits.push("path-outside-workspace:" + a.path.replaceAll(EVIDENCE, "<evidence>").replaceAll(homedir(), "~"));
    }
    if (e.toolName === "bash" && typeof a.command === "string") {
      const c = a.command;
      for (const r of SENSITIVE) if (r.test(c)) hits.push(String(r));
      for (const m of c.matchAll(/\/trials\/(w\d{3})/g)) if (m[1] !== ownTrial) hits.push("other-trial:" + m[1]);
      if (/pi-atdd-extension-snapshot/.test(c)) canonical.push("bash");
      const shell = stripHeredocBodies(c);
      for (const m of c.matchAll(/(?:^|[\s"'=:(])((?:\/|~\/)[^\s"'`;|&<>()]+)/g)) {
        const p = m[1].replace(/^~/, homedir());
        const top = p.split("/")[1];
        if (!top || !/^[\w.-]+$/.test(top) || !existsSync("/" + top)) continue; // comments (//, /**), URL paths (/orders/x)
        if (p === ws || p.startsWith(ws + "/") || SYSTEM.test(p) || p.includes("pi-atdd-extension-snapshot")) continue;
        hits.push("absolute-path-outside-workspace:" + p.replaceAll(EVIDENCE, "<evidence>").replaceAll(homedir(), "~"));
      }
      if (/(?:^|[\s;&|(])cd\s+\.\.(?:\/|\s|$)|(?:^|[\s=])(?:\.\.\/){2,}/.test(shell)) hits.push("parent-escape");
    }
    if (hits.length) violations.push({ tool: e.toolName, hits: [...new Set(hits)] });
  }
  return { violations, canonicalReads: canonical.length };
}

const rows = [], hashes = {};
for (const s of prereg.schedule) {
  const d = join(E, "trials", s.trialId);
  const t = readJson(join(d, "trial.json"));
  if (!t) { rows.push({ ...s, status: "NOT_RUN" }); continue; }
  const ev = readJson(join(d, "evaluation.json"));
  const vfile = ev ? join(EVIDENCE, "plt-79-evaluator-verdicts", ev.verdictFile) : null;
  const vr = vfile && existsSync(vfile) ? readJson(vfile) : null;
  for (const f of files(d)) hashes["trials/" + s.trialId + "/" + relative(d, f)] = sha256File(f);
  if (vfile && existsSync(vfile)) hashes["evaluator-verdicts/" + ev.verdictFile] = sha256File(vfile);
  const ga = t.coder?.graphActivation;
  const valid = Boolean(t.exactBase && (t.coder?.toolExecuted ?? 0) > 0 && ev && ev.verdict !== "UNPARSED");
  const coderAudit = audit(join(d, "coder.jsonl"), s.trialId);
  const row = {
    ...s, status: "RUN", model: t.model, provider: t.provider, exit: t.run?.exit, timedOut: t.run?.timedOut, wallMs: t.run?.wallMs,
    toolExecuted: t.coder?.toolExecuted, byTool: t.coder?.byTool, toolErrors: t.coder?.toolErrors, toolNotRun: t.coder?.toolNotRun,
    blockedByAtdd: t.coder?.blockedByAtdd, fakeToolTextMessages: t.coder?.fakeToolTextMessages, turns: t.coder?.assistantTurns,
    stopReason: t.coder?.stopReasons?.at(-1), providerErrors: t.coder?.errorMessages, usage: t.coder?.usage,
    activation: t.condition === "graph" ? { status: ga.status, scoredAsGraph: ga.scoredAsGraph, firstRelevantChange: ga.firstRelevantChange,
      targetFirstReceiptIndex: ga.targetFirstReceiptIndex, delivered: ga.deliveredRuleIds, injectedEstTokens: ga.injectedEstTokens,
      receipts: ga.receipts.length, unknownFacts: ga.unknownFacts } : null,
    exactBase: t.exactBase, resultRevision: t.resultRevision, changedPaths: t.changedPaths, unauthorizedChangedPaths: t.unauthorizedChangedPaths,
    diffSha256: t.diffSha256, promptSha256: t.promptSha256,
    integrity: ev?.integrity, visiblePassed: ev?.visible?.passed ?? null, oracle: ev?.oracleMechanical ?? null,
    evaluator: ev && { blindId: ev.blindId, verdict: ev.verdict, rubric: vr?.verdict?.rubric, claimsSuccess: vr?.verdict?.report_claims_success,
      flagsTestNotBinding: vr?.verdict?.report_flags_test_not_binding, oracleReported: ev.evaluatorOracleReported, oracleCountsAgree: ev.oracleCountsAgree,
      toolExecuted: ev.evaluatorToolExecuted, outsideAccess: ev.evaluatorOutsideAccess, diffLeakTerms: ev.diffLeakTerms, reportRedacted: ev.reportRedacted,
      usage: vr?.usage, wallMs: vr?.run?.wallMs, verdictSha256: ev.verdictSha256 },
    valid, accepted: Boolean(ev?.accepted), falseGreen: Boolean(ev?.falseGreen),
    auditCoder: coderAudit,
  };
  rows.push(row);
  const td = join(OUT, "trials", s.trialId); mkdirSync(td, { recursive: true });
  writeFileSync(join(td, "summary.json"), JSON.stringify(san({ row, coderFinalReport: t.coder?.finalText, bashCommands: t.coder?.bashCommands,
    toolPaths: t.coder?.toolPaths, argv: t.run?.argv, evaluatorFinal: vr?.finalText, evaluatorBash: vr?.bashCommands }), null, 2) + "\n");
  writeFileSync(join(td, "result.diff"), readFileSync(join(d, "result.diff"), "utf8"));
  if (ev) {
    const log = join(EVIDENCE, "plt-79-evaluator-work", ev.blindId, "oracle-mechanical.log");
    if (existsSync(log)) { writeFileSync(join(td, "oracle.log"), sanText(readFileSync(log, "utf8"))); hashes["evaluator-work/" + ev.blindId + "/oracle-mechanical.log"] = sha256File(log); }
  }
}
for (const f of files(join(E, "calibration"))) if (!f.includes("/work/")) hashes["calibration/" + relative(join(E, "calibration"), f)] = sha256File(f);
for (const f of files(join(EVIDENCE, "plt-79-evaluator"))) hashes["evaluator/" + relative(join(EVIDENCE, "plt-79-evaluator"), f)] = sha256File(f);
for (const f of files(join(EVIDENCE, "plt-79-evaluator-sessions"))) hashes["evaluator-sessions/" + relative(join(EVIDENCE, "plt-79-evaluator-sessions"), f)] = sha256File(f);

// --- Analysis -------------------------------------------------------------
const weakRows = rows.filter(r => r.role === "weak" && r.status === "RUN");
const A = weakRows.filter(r => r.condition === "baseline" && r.valid);
const Ball = weakRows.filter(r => r.condition === "graph" && r.valid);
const B = Ball.filter(r => r.activation?.scoredAsGraph);
const Bexcl = Ball.filter(r => !r.activation?.scoredAsGraph);
const REF = rows.filter(r => r.role === "reference" && r.status === "RUN" && r.valid);
const rate = (xs, f = r => r.accepted) => xs.length ? xs.filter(f).length / xs.length : null;
const frac = (xs, f = r => r.accepted) => xs.filter(f).length + "/" + xs.length;
const lgam = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
function fisher(a, b, c, d) { // two-sided, table [[a,b],[c,d]]
  const n = a + b + c + d, r1 = a + b, c1 = a + c;
  const p = (x) => Math.exp(lgam(r1) + lgam(n - r1) + lgam(c1) + lgam(n - c1) - lgam(n) - lgam(x) - lgam(r1 - x) - lgam(c1 - x) - lgam(n - r1 - c1 + x));
  const p0 = p(a); let tot = 0;
  for (let x = Math.max(0, r1 + c1 - n); x <= Math.min(r1, c1); x++) { const px = p(x); if (px <= p0 * (1 + 1e-9)) tot += px; }
  return Math.min(1, tot);
}
const summarize = (a, b, ref) => {
  const rA = rate(a), rB = rate(b), rR = rate(ref);
  const D = rA === null || rB === null ? null : rB - rA;
  const G = D === null || rR === null || rR - rA < 0.05 ? null : D / (rR - rA);
  return { A: frac(a), B: frac(b), ref: ref ? frac(ref) : null, rateA: rA, rateB: rB, rateRef: rR, D, gapClosed: G,
    falseGreenA: frac(a, r => r.falseGreen), falseGreenB: frac(b, r => r.falseGreen),
    fisherP: a.length && b.length ? fisher(b.filter(r => r.accepted).length, b.filter(r => !r.accepted).length, a.filter(r => r.accepted).length, a.filter(r => !r.accepted).length) : null };
};
const pooled = summarize(A, B, REF);
const fgA = rate(A, r => r.falseGreen), fgB = rate(B, r => r.falseGreen);
const runnable = tasks.tasks.filter(t => !t.status).map(t => t.taskId);
const weakModels = [...new Set(weakRows.map(r => r.modelKey))];
const cells = [];
for (const m of weakModels) for (const t of runnable) {
  const a = A.filter(r => r.modelKey === m && r.taskId === t), b = B.filter(r => r.modelKey === m && r.taskId === t);
  const ball = Ball.filter(r => r.modelKey === m && r.taskId === t);
  cells.push({ modelKey: m, taskId: t, ...summarize(a, b, REF.filter(r => r.taskId === t)), validA: a.length, scoredB: b.length, allB: ball.length, itt: frac(ball) });
}
const thinCells = cells.filter(c => c.validA < 3 || c.scoredB < 3);
let verdict;
if (rows.some(r => r.status === "RUN" && r.exactBase === false)) verdict = "INVALID";
else if (thinCells.length > 1 || weakModels.length < 2) verdict = "INCOMPLETE";
else if (pooled.D >= 0.15 && fgB <= fgA + 0.05) verdict = "BENEFIT";
else if (pooled.D <= -0.15 || fgB >= fgA + 0.15) verdict = "REGRESSION";
else verdict = "NO_OBSERVED_BENEFIT";
const byModel = Object.fromEntries(weakModels.map(m => [m, summarize(A.filter(r => r.modelKey === m), B.filter(r => r.modelKey === m), REF)]));
const byTask = Object.fromEntries(runnable.map(t => [t, summarize(A.filter(r => r.taskId === t), B.filter(r => r.taskId === t), REF.filter(r => r.taskId === t))]));
const itt = summarize(A, Ball, REF);
const sum = (xs, f) => xs.reduce((n, r) => n + (f(r) || 0), 0);
const cost = (xs) => ({ runs: xs.length, wallMs: sum(xs, r => r.wallMs), input: sum(xs, r => r.usage?.input), output: sum(xs, r => r.usage?.output),
  cacheRead: sum(xs, r => r.usage?.cacheRead), cacheWrite: sum(xs, r => r.usage?.cacheWrite), costUsd: Number(sum(xs, r => r.usage?.cost).toFixed(4)),
  toolExecuted: sum(xs, r => r.toolExecuted), blockedByAtdd: sum(xs, r => r.blockedByAtdd), fakeToolText: sum(xs, r => r.fakeToolTextMessages),
  injectedEstTokens: sum(xs, r => r.activation?.injectedEstTokens), timeouts: xs.filter(r => r.timedOut).length });
const costs = {};
for (const m of [...weakModels, "opus"]) for (const c of ["baseline", "graph"]) {
  const xs = rows.filter(r => r.status === "RUN" && r.modelKey === m && r.condition === c);
  if (xs.length) costs[m + "/" + c] = cost(xs);
}
const evaluatorCost = { runs: rows.filter(r => r.evaluator).length, costUsd: Number(sum(rows, r => r.evaluator?.usage?.cost).toFixed(4)),
  toolExecuted: sum(rows, r => r.evaluator?.toolExecuted), wallMs: sum(rows, r => r.evaluator?.wallMs) };
const activation = {};
for (const r of Ball) activation[r.activation.status] = (activation[r.activation.status] ?? 0) + 1;
const result = {
  schema: "pi-atdd/d008-weak-lift/results/v1", preregistrationCommit: "f504f4943ed8221286d6995f43890d06da0bfee8",
  verdict, pooled: { ...pooled, falseGreenRateA: fgA, falseGreenRateB: fgB }, intentionToTreat: itt, byModel, byTask, cells, thinCells: thinCells.map(c => c.modelKey + "/" + c.taskId),
  activation, excludedGraphRuns: Bexcl.map(r => ({ trialId: r.trialId, unit: r.unit, status: r.activation.status, accepted: r.accepted })),
  invalidRuns: rows.filter(r => r.status === "RUN" && !r.valid).map(r => ({ trialId: r.trialId, unit: r.unit, condition: r.condition })),
  notRun: rows.filter(r => r.status === "NOT_RUN").map(r => r.trialId),
  costs, evaluatorCost,
  audit: { coderViolations: rows.filter(r => r.auditCoder?.violations.length).map(r => ({ trialId: r.trialId, violations: r.auditCoder.violations })),
    graphCanonicalReads: rows.filter(r => r.auditCoder?.canonicalReads).map(r => ({ trialId: r.trialId, condition: r.condition, reads: r.auditCoder.canonicalReads })),
    evaluatorOutsideAccess: rows.filter(r => r.evaluator?.outsideAccess).map(r => r.trialId),
    oracleCountDisagreements: rows.filter(r => r.evaluator && r.evaluator.oracleCountsAgree === false).map(r => r.trialId),
    diffLeaks: rows.filter(r => r.evaluator?.diffLeakTerms?.length).map(r => ({ trialId: r.trialId, terms: r.evaluator.diffLeakTerms })) },
};
writeFileSync(join(OUT, "results.json"), JSON.stringify(san({ ...result, trials: rows }), null, 2) + "\n");
writeFileSync(join(OUT, "evidence-hashes.json"), JSON.stringify(san(hashes), null, 2) + "\n");
console.log(JSON.stringify(san(result), null, 1));
