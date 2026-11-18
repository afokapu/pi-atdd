import { existsSync, realpathSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { spawnSync } from "node:child_process";

export type VerificationEvidence = {
  status: "passed" | "failed" | "timed_out" | "invalid";
  runner: "node" | "bun"; targets: string[]; exitCode: number | null;
  stdout: string; stderr: string; durationMs: number;
};
function safeTarget(cwd: string, target: string): string {
  if (typeof target !== "string" || !target || target.startsWith("-") || target.includes("\0") ||
      isAbsolute(target) || target.includes("::") || target.startsWith("file:"))
    throw new Error("invalid test target: " + target);
  const abs = resolve(cwd, target), rel = relative(cwd, abs);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("test path escapes project: " + target);
  if (!/\.(?:test|spec)\.(?:[cm]?[jt]s|tsx)$/.test(target)) throw new Error("not an explicit TS/JS test file: " + target);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error("test file missing: " + target);
  const physical = realpathSync(abs), root = realpathSync(cwd), physicalRel = relative(root, physical);
  if (physicalRel.startsWith(".." + sep) || physicalRel === ".." || isAbsolute(physicalRel))
    throw new Error("test symlink escapes project: " + target);
  return physical;
}

/** A deterministic test runner boundary. Does not select tests or silently scan the whole repository. */
export function verifyTargets(cwd: string, targets: string[], options: { runner?: "node" | "bun"; timeoutMs?: number } = {}): VerificationEvidence {
  const runner = options.runner ?? "node", timeoutMs = options.timeoutMs ?? 60_000;
  if (!Array.isArray(targets) || targets.length === 0) throw new Error("explicit test targets required");
  if (targets.length > 128) throw new Error("too many explicit targets");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600_000) throw new Error("invalid timeout");
  const files = targets.map(t => safeTarget(cwd, t));
  const binary = runner === "node" ? process.execPath : "bun";
  const args = runner === "node"
    ? ["--experimental-strip-types", "--test", ...files]
    : ["test", ...files];
  const start = performance.now();
  const result = spawnSync(binary, args, {
    cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 1024 * 1024,
    shell: false, windowsHide: true,
  });
  const timedOut = Boolean(result.error && "code" in result.error && result.error.code === "ETIMEDOUT");
  return {
    status: timedOut ? "timed_out" : result.status === 0 ? "passed" : "failed",
    runner, targets, exitCode: result.status,
    stdout: (result.stdout || "").slice(-14000), stderr: (result.stderr || result.error?.message || "").slice(-6000),
    durationMs: Math.round(performance.now() - start),
  };
}
