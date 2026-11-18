/**
 * Evaluator: (1) src/effectiveness.ts verifyTrial() against the preregistered,
 * digest-pinned acceptance manifest (clean tree, exact HEAD, base ancestry,
 * protected paths, visible acceptance re-run); (2) held-out oracle tests run on an
 * exported copy of the immutable result revision. The coder never sees the oracle.
 *
 * Usage: node evaluate.mjs <E> <trialId> [--reference]
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { verifyTrial, acceptanceManifestDigest } from "../../../src/effectiveness.ts";
import { verifyTargets } from "../../../src/verify.ts";
import { sha256File } from "./pi-run.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const [E, trialId] = process.argv.slice(2);
const isRef = process.argv.includes("--reference");
const dir = join(E, isRef ? "reference-trials" : "trials", trialId);
const trial = JSON.parse(readFileSync(join(dir, "trial.json"), "utf8"));
const manifests = JSON.parse(readFileSync(join(HERE, "../manifests.json"), "utf8"));
const manifest = manifests.manifests[trial.taskId];
const pinned = manifests.digests[trial.taskId];
const ORACLE = join(E, "../plt-78-evaluator/oracle");
const tasks = JSON.parse(readFileSync(join(HERE, "../tasks.json"), "utf8"));
const task = tasks.tasks.find(t => t.taskId === trial.taskId);
const oracleSha = sha256File(join(ORACLE, task.oracle));
if (oracleSha !== manifests.oracleSha256[task.oracle]) throw new Error("oracle file digest differs from preregistration");

// Operator-pinned authority: accepts ONLY the manifest whose digest was preregistered.
// This is a pre-commitment check, NOT an independently authenticated evaluator principal.
const authority = { verifyManifest: (m, d) => d === pinned && m.taskId === trial.taskId };

const coderClaimsPassed = /\b(pass(es|ed|ing)?|green|succeed|all tests)\b/i.test(trial.coder?.finalText ?? "") && !/\bfail(s|ed|ing)?\b/i.test(trial.coder?.finalText ?? "");
const out = { schema: "pi-atdd/d008-local/evaluation/v1", trialId, taskId: trial.taskId, condition: trial.condition,
  manifestDigest: acceptanceManifestDigest(manifest), manifestDigestPinned: pinned, authority: "operator-pinned-preregistration (not independent)",
  oracle: task.oracle, oracleSha256: oracleSha };
try {
  const r = verifyTrial({ taskId: trial.taskId, modelId: trial.model ?? "reference", tier: trial.tier ?? "weak",
    condition: trial.condition === "graph" ? "graph" : "baseline", runClass: trial.condition === "reference" ? "fixture" : "model-run",
    baseRevision: trial.baseRevision, resultRevision: trial.resultRevision, workspace: join(dir, "ws"),
    testTargets: manifest.testTargets, claimedPassed: coderClaimsPassed,
    injectedTokens: trial.coder?.graphActivation?.injectedEstTokens ?? 0, wallMs: trial.run?.wallMs ?? 0 }, manifest, authority);
  out.integrity = { valid: true };
  out.visible = { passed: r.passed, exitCode: r.actualExitCode, falseClaimVsVisible: r.falseClaim, diagnostic: r.diagnostic };
} catch (e) {
  out.integrity = { valid: false, reason: String(e.message ?? e) };
}
// Held-out oracle on an exported copy of the immutable result revision.
const tree = join(E, isRef ? "reference-eval" : "eval", trialId);
rmSync(tree, { recursive: true, force: true }); mkdirSync(tree, { recursive: true });
execFileSync("bash", ["-c", "git -C \"$1\" archive \"$2\" | tar -x -C \"$3\"", "_", join(dir, "ws"), trial.resultRevision, tree]);
mkdirSync(join(tree, "evaluator"));
cpSync(join(ORACLE, task.oracle), join(tree, "evaluator", task.oracle));
const oracle = verifyTargets(tree, ["evaluator/" + task.oracle], { runner: "node", timeoutMs: 120_000 });
const all = verifyTargets(tree, manifests.regressionTargets, { runner: "node", timeoutMs: 120_000 });
writeFileSync(join(dir, "oracle.log"), oracle.stdout + "\n--stderr--\n" + oracle.stderr);
writeFileSync(join(dir, "regression.log"), all.stdout + "\n--stderr--\n" + all.stderr);
const count = (s, k) => Number((s.match(new RegExp("^ℹ " + k + " (\\d+)", "m")) || [])[1] ?? NaN);
out.oracle_ = { status: oracle.status, pass: count(oracle.stdout, "pass"), fail: count(oracle.stdout, "fail"),
  failing: [...new Set([...oracle.stdout.matchAll(/^\s*✖ (oracle: [^(]+?) \(/gm)].map(m => m[1]))] };
out.regression = { status: all.status, pass: count(all.stdout, "pass"), fail: count(all.stdout, "fail") };
out.coderClaimsPassed = coderClaimsPassed;
out.falseGreen = coderClaimsPassed && out.oracle_.status !== "passed";
out.testsAccepted = out.integrity.valid && out.visible?.passed === true && oracle.status === "passed";
writeFileSync(join(dir, "evaluation.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out));
