/**
 * Curate sanitised evidence into experiments/d008-local/results/ and compute the
 * preregistered verdict. Raw files stay local; only SHA-256 hashes are committed.
 * Usage: node curate.mjs <E>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";
import { sha256File } from "./pi-run.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const [E] = process.argv.slice(2);
const OUT = join(HERE, "../results");
const prereg = JSON.parse(readFileSync(join(HERE, "../prereg.json"), "utf8"));
const san = (v) => JSON.parse(JSON.stringify(v).replaceAll(E, "<E>").replaceAll(join(E, ".."), "<evidence>").replaceAll(homedir(), "~")
  .replace(/[A-Za-z0-9._%+-]+@(?!example\.invalid)[A-Za-z0-9.-]+\.[a-z]{2,}/g, "<email>"));
const files = (d) => existsSync(d) ? readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? (n === "ws" || n === ".jj" || n === ".git" || n === "submission" ? [] : files(p)) : [p]; }) : [];
mkdirSync(join(OUT, "trials"), { recursive: true });

const rows = [];
const hashes = {};
for (const s of prereg.schedule) {
  const d = join(E, "trials", s.trialId);
  if (!existsSync(join(d, "trial.json"))) { rows.push({ ...s, status: "NOT_RUN" }); continue; }
  const t = JSON.parse(readFileSync(join(d, "trial.json"), "utf8"));
  const ev = existsSync(join(d, "evaluation.json")) ? JSON.parse(readFileSync(join(d, "evaluation.json"), "utf8")) : null;
  const rv = existsSync(join(d, "review.json")) ? JSON.parse(readFileSync(join(d, "review.json"), "utf8")) : null;
  for (const f of files(d)) hashes["trials/" + relative(d, f).replace(/^/, s.trialId + "/")] = sha256File(f);
  if (rv) for (const f of files(join(E, "reviews", rv.blindId))) hashes["reviews/" + rv.blindId + "/" + relative(join(E, "reviews", rv.blindId), f)] = sha256File(f);
  const outside = (t.coder?.bashCommands || []).concat(t.coder?.readPaths || []).filter(c => {
    const paths = String(c).match(/(?:~|\/Users|\/home|\/tmp|\.\.\/)[^\s'"]*/g) || [];
    return paths.some(p => !p.includes("/trials/" + s.trialId + "/ws"));
  });
  const reviewerOutside = (rv?.bashCommands || []).filter(c => /\.\.\/|\/trials\/|plt-78-evaluator|blind-map/.test(String(c)));
  const accepted = Boolean(ev?.testsAccepted && rv?.verdict?.verdict === "ACCEPT");
  const falseGreen = Boolean(rv?.verdict?.report_claims_success && ev && ev.oracle_.status !== "passed");
  const row = {
    ...s, status: "RUN", model: t.model, exit: t.run?.exit, timedOut: t.run?.timedOut, wallMs: t.run?.wallMs,
    toolExecuted: t.coder?.toolExecuted, byTool: t.coder?.byTool, toolErrors: t.coder?.toolErrors, toolNotRun: t.coder?.toolNotRun,
    blockedByAtdd: t.coder?.blockedByAtdd, fakeToolTextMessages: t.coder?.fakeToolTextMessages, turns: t.coder?.assistantTurns,
    usage: t.coder?.usage, graph: t.coder?.graphActivation && { delivered: t.coder.graphActivation.deliveredRuleIds,
      targetBeforeEdit: t.coder.graphActivation.targetRuleDeliveredBeforeFirstSuccessfulEdit, injectedEstTokens: t.coder.graphActivation.injectedEstTokens,
      receipts: t.coder.graphActivation.receipts, unknownFacts: t.coder.graphActivation.unknownFacts },
    exactBase: t.exactBase, resultRevision: t.resultRevision, changedPaths: t.changedPaths, unauthorizedChangedPaths: t.unauthorizedChangedPaths,
    diffSha256: t.diffSha256, integrity: ev?.integrity, visiblePassed: ev?.visible?.passed ?? null,
    oracle: ev && { status: ev.oracle_.status, pass: ev.oracle_.pass, fail: ev.oracle_.fail, failing: ev.oracle_.failing },
    regression: ev?.regression, reviewer: rv && { blindId: rv.blindId, verdict: rv.verdict?.verdict ?? "UNPARSED", rubric: rv.verdict?.rubric,
      claimsSuccess: rv.verdict?.report_claims_success, flagsTestNotBinding: rv.verdict?.report_flags_test_not_binding,
      toolExecuted: rv.toolExecuted, wallMs: rv.run?.wallMs, diffLeakTerms: rv.diffLeakTerms, reportRedacted: rv.reportRedacted, usage: rv.usage,
      evidence: rv.verdict?.evidence },
    accepted, falseGreen, auditOutsideWorkspace: outside, auditReviewerOutside: reviewerOutside,
  };
  rows.push(row);
  const td = join(OUT, "trials", s.trialId); mkdirSync(td, { recursive: true });
  writeFileSync(join(td, "summary.json"), JSON.stringify(san({ row, coderFinalReport: t.coder?.finalText, bashCommands: t.coder?.bashCommands, toolPaths: t.coder?.readPaths, argv: t.run?.argv, reviewerBash: rv?.bashCommands, reviewerFinal: rv?.finalText }), null, 2) + "\n");
  writeFileSync(join(td, "result.diff"), readFileSync(join(d, "result.diff"), "utf8"));
  if (existsSync(join(d, "oracle.log"))) writeFileSync(join(td, "oracle.log"), san(readFileSync(join(d, "oracle.log"), "utf8")));
}
// Calibration hashes.
for (const f of files(join(E, "calibration"))) if (!f.includes("/work/")) hashes["calibration/" + relative(join(E, "calibration"), f)] = sha256File(f);

// Pairs and preregistered verdict.
const pairs = {};
for (const r of rows) (pairs[r.pairId] ??= { pairId: r.pairId, tier: r.tier, taskId: r.taskId })[r.condition] = r;
const pairList = Object.values(pairs).map(p => {
  const b = p.baseline, g = p.graph;
  const complete = b?.status === "RUN" && g?.status === "RUN" && b.reviewer && g.reviewer && b.integrity && g.integrity;
  const qualified = complete && b.toolExecuted > 0 && g.toolExecuted > 0 && b.exactBase && g.exactBase && !b.timedOut && !g.timedOut;
  return { ...p, baseline: undefined, graph: undefined, valid: Boolean(qualified),
    baselineAccepted: b?.accepted ?? null, graphAccepted: g?.accepted ?? null,
    delta: qualified ? Number(g.accepted) - Number(b.accepted) : null,
    baselineFalseGreen: b?.falseGreen ?? null, graphFalseGreen: g?.falseGreen ?? null,
    graphTargetRuleBeforeEdit: g?.graph?.targetBeforeEdit ?? null };
});
const valid = pairList.filter(p => p.valid);
const net = valid.reduce((n, p) => n + p.delta, 0);
const fgB = valid.filter(p => p.baselineFalseGreen).length, fgG = valid.filter(p => p.graphFalseGreen).length;
let observed = valid.length < 6 ? "PARTIAL" : (net >= 2 && fgG <= fgB) ? "BENEFIT" : (net <= -2 || fgG >= fgB + 2) ? "REGRESSION" : "NO_OBSERVED_BENEFIT";
if (valid.length === 6 && observed === "PARTIAL") observed = "NO_OBSERVED_BENEFIT";
const verdict = { schema: "pi-atdd/d008-local/verdict/v1", validPairs: valid.length, plannedPairs: 6, net, falseGreens: { baseline: fgB, graph: fgG },
  observedDirectionalResult: observed,
  overall: "INCOMPLETE",
  incompleteBecause: [
    "No independently authenticated evaluator authority: manifests/oracle/rubric authored by the operator agent and only pinned by the preregistration commit",
    "Blind reviewer is a model authenticated via the same operator's Pi login, not a separately authenticated principal",
    "T4-COORD (stale coordinator / JJ exact head) not run: depends on PLT-66",
    ...(valid.length < 6 ? ["Only " + valid.length + " of 6 preregistered pairs valid"] : []),
    "Single replicate per pair (n=6)",
  ] };
writeFileSync(join(OUT, "pairs.json"), JSON.stringify(san({ verdict, pairs: pairList, trials: rows }), null, 2) + "\n");
writeFileSync(join(OUT, "evidence-hashes.json"), JSON.stringify(san(hashes), null, 2) + "\n");
console.log(JSON.stringify({ verdict, pairs: pairList }, null, 1));
