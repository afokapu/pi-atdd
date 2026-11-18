/**
 * D008: independently re-run evaluator-owned acceptances on immutable results.
 *
 * The trial author must not select the acceptance oracle. A trusted external
 * evaluator supplies an immutable manifest and an authentication capability.
 * The manifest explicitly lists *all* paths the agent may change: every other
 * tracked file (including tests and imported helpers) is protected by default.
 * This remains a test-result witness, not blind behavioral reviewer approval.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isAbsolute, normalize, sep } from "node:path";
import { verifyTargets } from "./verify.ts";

export type AcceptanceManifest = {
  schema: "pi-atdd/acceptance-manifest/v1";
  id: string; taskId: string; baseRevision: string;
  acceptanceIds: string[];
  testTargets: string[];
  allowedChangedPaths: string[];
  policyDigest: string;
  runner: "node" | "bun";
};
/** Must be implemented by an independently authenticated evaluator, not
 * inferred from an agent's comment, fixture, or model-generated YAML. */
export type TrustedAcceptanceAuthority = {
  verifyManifest: (manifest: Readonly<AcceptanceManifest>, manifestDigest: string) => boolean;
};
export type Trial = {
  taskId: string; modelId: string; tier: "weak" | "strong";
  condition: "baseline" | "graph"; runClass: "fixture" | "model-run";
  baseRevision: string; resultRevision: string; workspace: string;
  testTargets: string[]; claimedPassed: boolean;
  injectedTokens: number; wallMs: number;
  transcriptDigest?: string; reviewerEvidence?: { source: string; locator: string; digest: string };
};
export type TrialResult = {
  trial: Trial; passed: boolean; falseClaim: boolean; durationMs: number;
  actualExitCode: number | null; diagnostic: string;
  acceptanceManifestDigest: string; manifestId: string;
  acceptanceIds: string[]; testTargets: string[]; policyDigest: string;
};
export type Comparison = {
  taskId: string; modelId: string; tier: Trial["tier"];
  status: "NOT_RUN" | "FIXTURE_ONLY" | "MEASURED_NOT_EXTERNALLY_REVIEWED" | "READY_FOR_INDEPENDENT_JUDGMENT";
  baseline?: TrialResult; graph?: TrialResult;
  acceptanceManifestDigest?: string; acceptanceIds?: string[]; policyDigest?: string;
  passDelta?: number; latencyDeltaMs?: number; tokenDelta?: number;
};
const nonEmpty = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const digestPattern = /^[a-f0-9]{64}$/;
const revisionPattern = /^[a-f0-9]{40,64}$/;
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd, encoding: "utf8", timeout: 4000, maxBuffer: 500_000, windowsHide: true,
  }).trim();
}
function gitRaw(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd, encoding: "utf8", timeout: 4000, maxBuffer: 500_000, windowsHide: true,
  });
}
function head(cwd: string): string { return git(cwd, ["rev-parse", "HEAD"]); }
function safeManifestPath(path: unknown): path is string {
  if (!nonEmpty(path) || path.includes("\0") || path.includes("\\") || path.startsWith("-")
      || isAbsolute(path) || path.startsWith("file:")) return false;
  return normalize(path) === path && path !== "."
    && !path.split("/").some(part => !part || part === "." || part === "..");
}
function canonicalList(values: unknown, label: string, path = false): string[] {
  if (!Array.isArray(values) || !values.length || values.length > 200
      || !values.every(x => path ? safeManifestPath(x) : nonEmpty(x))) {
    throw new Error("invalid evaluator-owned " + label);
  }
  const strings = values as string[];
  if (new Set(strings).size !== strings.length) throw new Error("duplicate evaluator-owned " + label);
  return [...strings].sort();
}
export function acceptanceManifestDigest(manifest: AcceptanceManifest): string {
  if (!manifest || manifest.schema !== "pi-atdd/acceptance-manifest/v1"
      || !nonEmpty(manifest.id) || !nonEmpty(manifest.taskId)
      || !revisionPattern.test(manifest.baseRevision)
      || !digestPattern.test(manifest.policyDigest)
      || !["node", "bun"].includes(manifest.runner))
    throw new Error("invalid evaluator-owned acceptance manifest");
  const acceptanceIds = canonicalList(manifest.acceptanceIds, "acceptance IDs");
  const testTargets = canonicalList(manifest.testTargets, "test targets", true);
  if (!testTargets.every(x => /\.(?:test|spec)\.(?:[cm]?[jt]s|tsx)$/.test(x)))
    throw new Error("evaluator manifest targets must be named test files");
  // An empty changed-path list is supported: some acceptance tasks explicitly
  // forbid any source changes.
  if (!Array.isArray(manifest.allowedChangedPaths)
      || !manifest.allowedChangedPaths.every(safeManifestPath)
      || new Set(manifest.allowedChangedPaths).size !== manifest.allowedChangedPaths.length)
    throw new Error("invalid evaluator-owned allowed-changes list");
  const allowed = [...manifest.allowedChangedPaths].sort();
  const protectedTests = new Set(testTargets);
  if (allowed.some(path => protectedTests.has(path) || /\.(?:test|spec)\.(?:[cm]?[jt]s|tsx)$/.test(path)
      || /(?:^|\/)(?:tests|__tests__|test-fixtures)\//.test(path)))
    throw new Error("evaluator manifest must never allow changes to test or fixture code");
  return sha256(JSON.stringify({
    schema:manifest.schema,id:manifest.id,taskId:manifest.taskId,
    baseRevision:manifest.baseRevision,acceptanceIds,testTargets,
    allowedChangedPaths:allowed,policyDigest:manifest.policyDigest,runner:manifest.runner,
  }));
}
function eqStrings(a: readonly string[], b: readonly string[]): boolean {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}
function verifyWorktree(trial: Trial, manifest: AcceptanceManifest): void {
  if (git(trial.workspace, ["status", "--porcelain", "--untracked-files=all"]))
    throw new Error("trial worktree is dirty; claimed revision does not identify tested code");
  try {
    git(trial.workspace, ["merge-base", "--is-ancestor", trial.baseRevision, trial.resultRevision]);
  } catch {
    throw new Error("trial base revision is not an ancestor of result");
  }
  const changed = gitRaw(trial.workspace, ["diff", "--no-ext-diff", "--no-renames",
    "--name-only", "-z", trial.baseRevision, trial.resultRevision, "--"])
    .split("\0").filter(Boolean);
  const allowed = new Set(manifest.allowedChangedPaths);
  for (const file of changed) {
    if (!allowed.has(file))
      throw new Error("trial modified evaluator-protected file or unapproved implementation path: " + file);
  }
  for (const target of manifest.testTargets) {
    const original = gitRaw(trial.workspace, ["ls-tree", "-r", "--name-only", "-z",
      manifest.baseRevision, "--", target]).split("\0").filter(Boolean);
    if (!original.includes(target))
      throw new Error("evaluator acceptance target absent from immutable base: " + target);
  }
}
export function verifyTrial(trial: Trial, manifest: AcceptanceManifest,
    authority: TrustedAcceptanceAuthority): TrialResult {
  const manifestDigest = acceptanceManifestDigest(manifest);
  if (!authority || typeof authority.verifyManifest !== "function"
      || !authority.verifyManifest(manifest, manifestDigest))
    throw new Error("evaluator acceptance manifest lacks independent authentication");
  if (!nonEmpty(trial.taskId) || !nonEmpty(trial.modelId)
      || !revisionPattern.test(trial.baseRevision)
      || !revisionPattern.test(trial.resultRevision) || !nonEmpty(trial.workspace)
      || !Number.isInteger(trial.injectedTokens) || trial.injectedTokens < 0
      || !Number.isFinite(trial.wallMs) || trial.wallMs < 0)
    throw new Error("trial is incomplete; do not score a claimed outcome");
  if (manifest.taskId !== trial.taskId || manifest.baseRevision !== trial.baseRevision)
    throw new Error("trial is not bound to evaluator-approved task and base revision");
  if (!eqStrings(trial.testTargets, manifest.testTargets))
    throw new Error("trial test targets differ from evaluator-owned acceptance manifest");
  const actualRevision = head(trial.workspace);
  if (actualRevision !== trial.resultRevision)
    throw new Error("trial workspace revision does not match claimed result");
  verifyWorktree(trial, manifest);
  const evidence = verifyTargets(trial.workspace, manifest.testTargets, { runner: manifest.runner });
  const passed = evidence.status === "passed";
  return {
    trial, passed, falseClaim: trial.claimedPassed && !passed,
    durationMs: evidence.durationMs, actualExitCode: evidence.exitCode,
    diagnostic: evidence.status + "; evaluator tests independently re-run against " + actualRevision,
    acceptanceManifestDigest: manifestDigest, manifestId:manifest.id,
    acceptanceIds: [...manifest.acceptanceIds].sort(),
    testTargets: [...manifest.testTargets].sort(), policyDigest: manifest.policyDigest,
  };
}
export function compareTrials(records: TrialResult[]): Comparison[] {
  const groups = new Map<string, TrialResult[]>();
  for (const result of records) {
    const t = result.trial, id = JSON.stringify([t.taskId, t.modelId, t.tier, t.baseRevision]);
    groups.set(id, [...(groups.get(id) ?? []), result]);
  }
  return [...groups.values()].map(group => {
    const first = group[0]!.trial;
    const entries = group.filter(t => t.trial.condition === "baseline");
    const guided = group.filter(t => t.trial.condition === "graph");
    const base = { taskId:first.taskId,modelId:first.modelId,tier:first.tier };
    if (entries.length !== 1 || guided.length !== 1) return { ...base, status:"NOT_RUN" as const };
    const baseline = entries[0]!, graph = guided[0]!;
    if (!baseline.acceptanceManifestDigest || !graph.acceptanceManifestDigest
        || baseline.acceptanceManifestDigest !== graph.acceptanceManifestDigest
        || baseline.policyDigest !== graph.policyDigest
        || !eqStrings(baseline.acceptanceIds, graph.acceptanceIds)
        || !eqStrings(baseline.testTargets, graph.testTargets)
        || !eqStrings(baseline.trial.testTargets, graph.trial.testTargets)
        || baseline.trial.runClass !== graph.trial.runClass)
      throw new Error("D008 comparison rejected unmatched evaluator acceptance targets, policies or provenance");
    const status: Comparison["status"] =
      baseline.trial.runClass === "fixture" || graph.trial.runClass === "fixture"
        ? "FIXTURE_ONLY"
        : !baseline.trial.transcriptDigest || !graph.trial.transcriptDigest
          ? "MEASURED_NOT_EXTERNALLY_REVIEWED"
          : !baseline.trial.reviewerEvidence || !graph.trial.reviewerEvidence
            ? "MEASURED_NOT_EXTERNALLY_REVIEWED"
            : "READY_FOR_INDEPENDENT_JUDGMENT";
    return {
      ...base,status,baseline,graph,
      acceptanceManifestDigest:baseline.acceptanceManifestDigest,
      acceptanceIds:baseline.acceptanceIds,policyDigest:baseline.policyDigest,
      passDelta:Number(graph.passed)-Number(baseline.passed),
      latencyDeltaMs:graph.trial.wallMs-baseline.trial.wallMs,
      tokenDelta:graph.trial.injectedTokens-baseline.trial.injectedTokens,
    };
  });
}
export function decisionEffectivenessStatus(comparisons: Comparison[]): {
  status: "NOT_RUN" | "INCOMPLETE" | "READY_FOR_EXTERNAL_REVIEW";
  missing: string[];
} {
  if (!comparisons.length) return {status:"NOT_RUN",missing:["No measured weak/strong model pairs"]};
  const weak = comparisons.filter(c => c.tier === "weak");
  const strong = comparisons.filter(c => c.tier === "strong");
  const missing = [
    ...(!weak.length ? ["No weak-model pair"] : []),
    ...(!strong.length ? ["No strong-model pair"] : []),
    ...comparisons.filter(c => c.status !== "READY_FOR_INDEPENDENT_JUDGMENT")
      .map(c => "Not independently attestable: " + c.taskId + " / " + c.modelId + " (" + c.status + ")"),
  ];
  return {status: missing.length ? "INCOMPLETE" : "READY_FOR_EXTERNAL_REVIEW",missing};
}
