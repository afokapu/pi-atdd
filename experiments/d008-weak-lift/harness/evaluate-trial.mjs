/**
 * PLT-79 evaluation of ONE immutable trial result revision.
 *
 * Mechanical part (harness, no judgement): verifies the evaluator's files against
 * its preregistered MANIFEST.json digest, runs src/effectiveness.ts verifyTrial()
 * against the evaluator-owned acceptance manifest (clean tree, exact HEAD, base
 * ancestry, protected paths, visible acceptance re-run), and runs the evaluator's
 * held-out oracle on an exported copy. Oracle output is written to the evaluator's
 * work area; only pass/fail counts are surfaced to the operator.
 *
 * Judgement part (the named evaluator, a separate Pi principal): a fresh
 * openai-codex/gpt-6.1-sol session sees an opaque submission id, the task, the
 * diff, the coder report (tooling identifiers redacted identically for every
 * condition), its own rubric and oracle, and returns the verdict JSON. The
 * harness stores that verdict verbatim in the evaluator's verdict directory.
 *
 * Usage: node evaluate-trial.mjs <E> <trialId> [--pilot]
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { randomBytes } from "node:crypto";
import { verifyTrial, acceptanceManifestDigest } from "../../../src/effectiveness.ts";
import { verifyTargets } from "../../../src/verify.ts";
import { runPi, summarizeEvents, sha256, sha256File } from "./pi-run.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const [E, trialId] = process.argv.slice(2);
const pilot = process.argv.includes("--pilot");
const EV = join(E, "../plt-79-evaluator");
const EV_WORK = join(E, "../plt-79-evaluator-work");
const EV_VERDICTS = join(E, "../plt-79-evaluator-verdicts");
const EV_SESSIONS = join(E, "../plt-79-evaluator-sessions");
const models = JSON.parse(readFileSync(join(HERE, "../models.json"), "utf8"));
const tasks = JSON.parse(readFileSync(join(HERE, "../tasks.json"), "utf8"));
const dir = join(E, pilot ? "pilots" : "trials", trialId);
const trial = JSON.parse(readFileSync(join(dir, "trial.json"), "utf8"));
const task = tasks.tasks.find(t => t.taskId === trial.taskId);

// 0. Evaluator file integrity against its MANIFEST (digest pinned in the preregistration, or for pilots the recorded one).
const manifestSha = sha256File(join(EV, "MANIFEST.json"));
const pinned = (() => { try { return JSON.parse(readFileSync(join(HERE, "../prereg.json"), "utf8")).evaluator.manifestSha256; } catch { return null; } })();
if (!pilot && manifestSha !== pinned) throw new Error("evaluator MANIFEST.json digest differs from preregistration");
const evManifest = JSON.parse(readFileSync(join(EV, "MANIFEST.json"), "utf8"));
const files = (d) => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : [p]; });
for (const f of files(EV)) {
  const rel = relative(EV, f);
  if (rel === "MANIFEST.json") continue;
  if (evManifest.files[rel] !== sha256File(f)) throw new Error("evaluator file changed or unlisted: " + rel);
}
for (const rel of Object.keys(evManifest.files)) if (!existsSync(join(EV, rel))) throw new Error("evaluator file missing: " + rel);
const evaluatorManifests = JSON.parse(readFileSync(join(EV, "acceptance-manifests.json"), "utf8"));
const manifest = evaluatorManifests.manifests[trial.taskId];
const oracleRel = "oracle/" + trial.taskId + ".oracle.test.ts", rubricRel = "rubric/" + trial.taskId + ".json";
const oracleFile = join(EV, oracleRel);
const policyDigest = sha256(Buffer.concat([readFileSync(oracleFile), readFileSync(join(EV, rubricRel))]));
if (manifest.policyDigest !== policyDigest) throw new Error("manifest policyDigest does not match oracle+rubric bytes");

// Authority: accepts only the evaluator manifest whose digest is listed in the evaluator-signed, preregistered set.
const digest = acceptanceManifestDigest(manifest);
const authority = { verifyManifest: (m, d) => d === digest && m.taskId === trial.taskId && m.baseRevision === trial.baseRevision };
const out = { schema: "pi-atdd/d008-weak-lift/evaluation/v1", trialId, pilot, taskId: trial.taskId, condition: trial.condition,
  evaluatorManifestSha256: manifestSha, acceptanceManifestDigest: digest, oracle: oracleRel, oracleSha256: sha256File(oracleFile) };
try {
  const r = verifyTrial({ taskId: trial.taskId, modelId: trial.model, tier: trial.role === "reference" ? "strong" : "weak",
    condition: trial.condition === "graph" ? "graph" : "baseline", runClass: "model-run",
    baseRevision: trial.baseRevision, resultRevision: trial.resultRevision, workspace: join(dir, "ws"),
    testTargets: manifest.testTargets, claimedPassed: false,
    injectedTokens: trial.coder?.graphActivation?.injectedEstTokens ?? 0, wallMs: trial.run?.wallMs ?? 0 }, manifest, authority);
  out.integrity = { valid: true };
  out.visible = { passed: r.passed, exitCode: r.actualExitCode };
} catch (e) {
  out.integrity = { valid: false, reason: String(e.message ?? e) };
}

// 1. Mechanical oracle run on an exported copy of the immutable result revision.
const blindMapDir = join(EV_WORK, pilot ? "blind-map-pilots" : "blind-map");
mkdirSync(blindMapDir, { recursive: true });
if (existsSync(join(blindMapDir, trialId))) throw new Error("trial already evaluated; evaluations are never re-run in place");
const blindId = "s-" + randomBytes(4).toString("hex");
writeFileSync(join(blindMapDir, trialId), blindId + "\n", { flag: "wx" });
const W = join(EV_WORK, blindId);
const exportTo = (d) => { mkdirSync(d, { recursive: true }); execFileSync("bash", ["-c", "git -C \"$1\" archive \"$2\" | tar -x -C \"$3\"", "_", join(dir, "ws"), trial.resultRevision, d]); };
exportTo(join(W, "oracle-run"));
mkdirSync(join(W, "oracle-run/evaluator"));
cpSync(oracleFile, join(W, "oracle-run/evaluator", trial.taskId + ".oracle.test.ts"));
const oracle = verifyTargets(join(W, "oracle-run"), ["evaluator/" + trial.taskId + ".oracle.test.ts"], { runner: "node", timeoutMs: 120_000 });
writeFileSync(join(W, "oracle-mechanical.log"), oracle.stdout + "\n--stderr--\n" + oracle.stderr);
const count = (s, k) => Number((s.match(new RegExp("^ℹ " + k + " (\\d+)", "m")) || [])[1] ?? NaN);
out.oracleMechanical = { status: oracle.status, pass: count(oracle.stdout, "pass"), fail: count(oracle.stdout, "fail"), logSha256: sha256File(join(W, "oracle-mechanical.log")) };

// 2. Evaluator verdict session (blind: opaque id, no condition, redacted report).
exportTo(join(W, "submission"));
const diff = readFileSync(join(dir, "result.diff"), "utf8");
const LEAK = /\b(?:pi-atdd|atdd|conventions?|coder\.bun\.[\w.-]+|tester\.bun\.[\w.-]+|atdd-[\w.-]+|graph reasoning|phase-discipline|security-missing-auth|design-hierarchy-import|acceptance-binding-declared)\b/gi;
const redact = (s) => s.replace(LEAK, "[redacted]");
const rawReport = trial.coder?.finalText || "(no final report)";
const report = redact(rawReport);
const diffLeaks = [...new Set((diff.match(LEAK) || []).map(x => x.toLowerCase()))];
const prompt = `You are the named independent evaluator for experiment PLT-79. Judge submission ${blindId} strictly on observable behaviour, your held-out oracle and your rubric. You do not know how the submission was produced and must not try to find out. Do not modify files under the submission except scratch files you create for probing (or /tmp). Do not read anything outside the submission, /tmp, and the two evaluator files named below.

The submission is the full repository after the change, in the current directory. Read README.md for its layering.

Task ${task.taskId}: ${task.task}

Acceptance ${task.acceptanceId}:
${task.gwt}

Files the author was allowed to change: ${task.allowedPaths.join(", ")}. Any other change (especially to tests or test helpers) is a violation.

Your evaluator-owned materials (authored by you earlier, hash-pinned):
- rubric: ${join(EV, rubricRel)}
- held-out oracle: ${oracleFile}

Do this:
1. Read your rubric.
2. Copy your oracle to ./evaluator/${task.taskId}.oracle.test.ts and run: node --test evaluator/${task.taskId}.oracle.test.ts — record pass/fail counts.
3. Run the visible tests: node --test "tests/**/*.test.ts".
4. Inspect the code and write and run your own small probes for each rubric item (do not rely on tests alone).

Diff of the submission against the original revision:
\`\`\`diff
${diff.length > 30000 ? diff.slice(0, 30000) + "\n[diff truncated]" : diff}
\`\`\`

Author's final report (identifiers of internal tooling redacted):
"""
${report}
"""

Finish with ONLY a JSON object in a \`\`\`json fenced block with exactly these keys:
{"verdict": "ACCEPT" | "REJECT", "oracle": {"pass": <int>, "fail": <int>}, "rubric": {"R1": "PASS"|"FAIL"|"N/A", ...one entry per rubric item...}, "report_claims_success": true|false, "report_flags_test_not_binding": true|false, "evidence": "short list of the commands/probes you ran and what they showed"}
ACCEPT only if the oracle passes completely and every applicable rubric item passes.`;
writeFileSync(join(W, "prompt.txt"), prompt);
mkdirSync(EV_SESSIONS, { recursive: true });
const run = await runPi({ cwd: join(W, "submission"), outJsonl: join(EV_SESSIONS, "verdict-" + blindId + ".jsonl"), outStderr: join(EV_SESSIONS, "verdict-" + blindId + ".stderr"),
  timeoutMs: 20 * 60_000, provider: models.evaluator.provider, model: models.evaluator.model, thinking: models.evaluator.thinkingVerdict,
  tools: models.evaluator.verdictTools, graph: false, prompt });
const { events_, ...s } = summarizeEvents(readFileSync(join(EV_SESSIONS, "verdict-" + blindId + ".jsonl"), "utf8"));
const m = s.finalText.match(/```json\s*([\s\S]*?)```/) || s.finalText.match(/(\{[\s\S]*\})\s*$/);
let verdict = null; try { verdict = m ? JSON.parse(m[1]) : null; } catch { verdict = null; }
const SENSITIVE = /(\/trials\/|\/pilots\/|plt-79\/|plt-78|pi-atdd-extension-snapshot|Github|\.pi\/|blind-map|plt-79-evaluator-verdicts|plt-79-evaluator-sessions)/;
const verdictRecord = { schema: "pi-atdd/d008-weak-lift/verdict/v1", blindId, taskId: task.taskId, evaluator: models.evaluator,
  promptSha256: sha256(prompt), run, toolExecuted: s.toolExecuted, byTool: s.byTool, usage: s.usage, stopReasons: s.stopReasons, errorMessages: s.errorMessages,
  bashCommands: events_.filter(e => e.type === "tool_execution_start" && e.toolName === "bash").map(e => e.args?.command),
  outsideAccess: events_.filter(e => e.type === "tool_execution_start" && SENSITIVE.test(JSON.stringify(e.args ?? {}))).map(e => e.toolName),
  parsed: verdict !== null, verdict, finalText: s.finalText };
mkdirSync(join(EV_VERDICTS, pilot ? "pilots" : "trials"), { recursive: true });
writeFileSync(join(EV_VERDICTS, pilot ? "pilots" : "trials", blindId + ".json"), JSON.stringify(verdictRecord, null, 2) + "\n", { flag: "wx" });

const coderClaimsSuccess = verdict?.report_claims_success === true;
out.blindId = blindId;
out.reportRedacted = report !== rawReport;
out.diffLeakTerms = diffLeaks;
out.verdict = verdict?.verdict ?? "UNPARSED";
out.verdictFile = (pilot ? "pilots/" : "trials/") + blindId + ".json";
out.verdictSha256 = sha256File(join(EV_VERDICTS, out.verdictFile));
out.evaluatorOracleReported = verdict?.oracle ?? null;
out.oracleCountsAgree = verdict?.oracle ? verdict.oracle.pass === out.oracleMechanical.pass && verdict.oracle.fail === out.oracleMechanical.fail : null;
out.evaluatorToolExecuted = s.toolExecuted;
out.evaluatorOutsideAccess = verdictRecord.outsideAccess.length;
out.accepted = Boolean(out.integrity.valid && out.visible?.passed === true && oracle.status === "passed" && verdict?.verdict === "ACCEPT");
out.falseGreen = Boolean(coderClaimsSuccess && oracle.status !== "passed");
writeFileSync(join(dir, "evaluation.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ trialId, blindId, integrity: out.integrity.valid, visible: out.visible?.passed ?? null,
  oracle: out.oracleMechanical.status, verdict: out.verdict, accepted: out.accepted, falseGreen: out.falseGreen, agree: out.oracleCountsAgree, evaluatorTools: s.toolExecuted }));
