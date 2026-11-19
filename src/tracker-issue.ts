/**
 * PLT-96: a code-changing task is bound to an issue in the configured tracker.
 *
 * The tracker is named by configuration (atdd-pi.yaml `tracker: {kind, issuePattern}`), never by this
 * module. The check reads the changed paths and the branch / PR text it is given. It cannot read the
 * tracker, so it proves the reference is present, not that the issue status is current (text obligation).
 * Verdicts: pass (exit 0), fail (exit 1), notice (exit 3: not checkable, e.g. no tracker configured).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GraphError, readYaml } from "./catalog.ts";

export type TrackerConfig = { kind: string; issuePattern: string };
export type ChangeKind = "repo-file" | "ci" | "deploy-infra" | "cloud-build";
export type TrackerCheck = {
  verdict: "pass" | "fail" | "notice";
  issueRef: string | null;
  codeChanging: Array<{ file: string; kind: ChangeKind }>;
  findings: string[];
  message: string;
};
export type TrackerCheckInput = {
  changedFiles: string[];
  branch: string;
  /** Undefined means the PR has not been written yet; the check is then a notice, not a pass. */
  prBody?: string;
  tracker: TrackerConfig | null;
};

const CI = [/^\.github\//, /^\.gitlab-ci\.yml$/, /^\.circleci\//, /^\.buildkite\//, /(^|\/)azure-pipelines\.yml$/, /(^|\/)Jenkinsfile$/];
const CLOUD_BUILD = [/(^|\/)cloudbuild[^/]*\.(ya?ml|json)$/, /(^|\/)\.cloudbuild\//];
const DEPLOY_INFRA = [/\.tf$/, /\.tfvars$/, /(^|\/)(infra|deploy|deployment|deployments|helm|k8s|kubernetes|terraform)\//,
  /(^|\/)Dockerfile(\.[^/]+)?$/, /(^|\/)docker-compose[^/]*\.ya?ml$/,
  /(^|\/)(wrangler\.toml|netlify\.toml|vercel\.json|fly\.toml|render\.yaml|app\.yaml)$/];

/** Every repository file is code-changing (documentation included); the kind says which obligation source it is. */
export function changeKind(path: string): ChangeKind {
  const p = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (CI.some(r => r.test(p))) return "ci";
  if (CLOUD_BUILD.some(r => r.test(p))) return "cloud-build";
  if (DEPLOY_INFRA.some(r => r.test(p))) return "deploy-infra";
  return "repo-file";
}

/** Reads `tracker:` from atdd-pi.yaml. Absent or empty means null (unconfigured), not a default tracker. */
export function readTrackerConfig(cwd: string): TrackerConfig | null {
  const path = join(cwd, "atdd-pi.yaml");
  if (!existsSync(path)) return null;
  const cfg = readYaml(path);
  if (cfg.schema !== "pi-atdd/config/v2") throw new GraphError("invalid atdd-pi.yaml schema (expected v2)");
  if (cfg.tracker === undefined || cfg.tracker === null) return null;
  const t = cfg.tracker as Record<string, unknown>;
  if (typeof t !== "object" || Array.isArray(t)) throw new GraphError("tracker must be an object {kind, issuePattern}");
  if (typeof t.kind !== "string" || !t.kind.trim()) throw new GraphError("tracker.kind must name the configured tracker");
  if (typeof t.issuePattern !== "string" || !t.issuePattern) throw new GraphError("tracker.issuePattern is required");
  try { new RegExp(t.issuePattern, "i"); } catch { throw new GraphError("tracker.issuePattern is not a valid regular expression"); }
  return { kind: t.kind, issuePattern: t.issuePattern };
}

function firstRef(text: string, pattern: string): string | null {
  const m = new RegExp(pattern, "i").exec(text);
  return m ? m[0] : null;
}

function result(verdict: TrackerCheck["verdict"], issueRef: string | null, codeChanging: TrackerCheck["codeChanging"],
    findings: string[], message: string): TrackerCheck {
  return { verdict, issueRef, codeChanging, findings, message };
}

export function checkTrackerIssue(input: TrackerCheckInput): TrackerCheck {
  const files = [...new Set(input.changedFiles.map(f => f.trim()).filter(Boolean))].sort();
  const codeChanging = files.map(file => ({ file, kind: changeKind(file) }));
  if (!codeChanging.length) {
    return result("pass", null, [], [], "No code-changing paths: no tracker issue is required.");
  }
  if (!input.tracker) {
    return result("notice", null, codeChanging, ["no tracker configured"],
      "No issue tracker is configured (atdd-pi.yaml `tracker:` is absent). This code change cannot be bound to a tracker issue. This is a notice, not a pass.");
  }
  const pattern = input.tracker.issuePattern;
  const branchRef = firstRef(input.branch ?? "", pattern);
  const bodyRef = input.prBody === undefined ? undefined : firstRef(input.prBody, pattern);
  const fileList = codeChanging.map(c => c.file + " (" + c.kind + ")").join(", ");

  if (branchRef === null) {
    const issue = bodyRef ?? null;
    const finding = issue === null ? "no tracker issue id in the branch name or the PR body"
      : "branch name does not carry the tracker issue id " + issue;
    return result("fail", issue, codeChanging, [finding],
      "Code change without a tracker issue (" + input.tracker.kind + "): " + finding + ". Changed: " + fileList);
  }
  if (bodyRef === undefined) {
    return result("notice", branchRef, codeChanging,
      ["PR body not yet available"],
      "Branch carries " + branchRef + "; PR body not yet available. Re-check when the PR opens.");
  }
  if (bodyRef === null) {
    return result("fail", branchRef, codeChanging,
      ["PR body does not reference the tracker issue " + branchRef],
      "Code change not bound in the PR body: add " + branchRef + " to the PR body. Changed: " + fileList);
  }
  if (branchRef.toLowerCase() !== bodyRef.toLowerCase()) {
    return result("fail", branchRef, codeChanging,
      ["branch and PR body reference different issues: " + branchRef + " vs " + bodyRef],
      "Branch and PR body name different tracker issues; align them on one issue.");
  }
  return result("pass", branchRef, codeChanging, [],
    "Code change bound to tracker issue " + branchRef + " in the branch and PR body. Issue status is not read by this check.");
}
