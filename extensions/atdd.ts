/** ATDD Pi extension: a thin, replaceable transport over the standalone graph CLI.
 *
 * Preflight is a context-delivery retry, NOT a claim that a model obeyed the rule.
 * No source file is mutated by this extension.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const runner = resolve(dirname(fileURLToPath(import.meta.url)), "../python/runner.py");

type GraphContext = {
  status: "matched" | "unresolved" | "error";
  rules?: Array<{ id: string; statement: string; summary: string; reasons: string[]; source_file?: string; exceptions?: string[]; exceptions_truncated?: boolean; disposition?: string | null }>;
  matching_ids?: string[];
  truncated?: boolean;
  note?: string;
  error?: string;
};

async function getContext(cwd: string, task: string, paths: string[], operation: "task" | "create" | "edit"): Promise<GraphContext> {
  const args = ["--repo", cwd, "context", "--operation", operation, "--task", task.slice(0, 5000),
    ...paths.flatMap(path => ["--path", path])];
  let output = "";
  try {
    const response = await execFileAsync(process.env.ATDD_PYTHON || "python3", [runner, ...args], {
      cwd, timeout: 12_000, maxBuffer: 256 * 1024, windowsHide: true,
    });
    output = response.stdout;
  } catch (error) {
    const failure = error as Error & { stdout?: string };
    // Exit code 3 = documented "unresolved selector", not a broken graph.
    output = failure.stdout || "";
    if (!output.trim()) throw new Error("ATDD graph command failed: " + failure.message);
  }
  let data: GraphContext;
  try { data = JSON.parse(output); } catch { throw new Error("ATDD resolver returned non-JSON output"); }
  if (data.status === "error") throw new Error(data.error || "ATDD graph is invalid");
  return data;
}

function guidance(data: GraphContext): string {
  if (data.status === "unresolved")
    return "ATDD applicability unresolved: " + (data.note || "No selector matched. Check conventions manually; this is not an exemption.");
  const rules = data.rules || [];
  return [
    "ATDD conventions selected for this work (guidance, NOT a verified compliance decision):",
    ...rules.map(rule => [
      "Rule " + rule.id + ": " + (rule.statement || rule.summary).slice(0, 900),
      "Canonical source: " + (rule.source_file || "(unknown)") + " — read the full rule before claiming an alternative realization.",
      "Original treatment: " + (rule.disposition || "unclassified; do not infer a gate"),
      ...(rule.exceptions || []).map(exception => "Exception: " + exception.slice(0, 450)),
      ...(rule.exceptions_truncated ? ["More exceptions exist in the source file."] : []),
      "Activated by: " + rule.reasons.join("; "),
    ].join("\n")),
    data.truncated ? "WARNING: the selection exceeds the context limit. Consult the complete graph before claiming compliance." : "",
    "Follow applicable obligations. An alternative implementation must preserve the intent and provide evidence.",
  ].filter(Boolean).join("\n\n");
}

function repositoryPath(cwd: string, path: string): string | null {
  const absolute = resolve(cwd, path);
  const name = relative(cwd, absolute).split(sep).join("/");
  return name === ".." || name.startsWith("../") || name.startsWith("/") ? null : name;
}

/** Export a factory for tests and Pi's extension discovery. */
export default function atdd(pi: ExtensionAPI): void {
  let taskText = "";
  const announced = new Set<string>();
  const warnedPaths = new Set<string>();

  pi.on("before_agent_start", async (event, ctx) => {
    if (!ctx.isProjectTrusted() || !existsSync(resolve(ctx.cwd, "atdd-pi.yaml"))) return;
    if (event.messageType === "user") {
      taskText = event.prompt || "";
      announced.clear();
      warnedPaths.clear();
    }
    try {
      const data = await getContext(ctx.cwd, taskText, [], "task");
      for (const id of data.matching_ids || []) announced.add(id);
      return { message: { customType: "atdd-rules", content: guidance(data), display: false } };
    } catch (error) {
      return { message: {
        customType: "atdd-rules",
        content: "ATDD graph unavailable: " + String(error) + ". Stop governed work until the source lock/configuration is repaired.",
        display: true,
      }};
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!ctx.isProjectTrusted() || !existsSync(resolve(ctx.cwd, "atdd-pi.yaml"))) return;
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    const input = event.input as { path?: unknown };
    if (typeof input.path !== "string") return;
    const path = repositoryPath(ctx.cwd, input.path);
    if (path === null) {
      return { block: true, reason: "ATDD cannot resolve an edit path outside the governed repository." };
    }
    try {
      const data = await getContext(ctx.cwd, taskText, [path], event.toolName === "write" ? "create" : "edit");
      const newRules = (data.rules || []).filter(rule => !announced.has(rule.id));
      for (const id of data.matching_ids || []) announced.add(id);
      if (newRules.length) {
        // Only the first attempt is blocked so the *tool result* delivers the
        // rules before the edit happens. Retrying then proceeds normally.
        return {
          block: true,
          reason: "ATDD one-time context preflight; inspect these newly applicable conventions, then retry the edit:\n\n" +
            guidance({ ...data, rules: newRules }),
        };
      }
      if (data.status === "unresolved" && !warnedPaths.has(path)) {
        warnedPaths.add(path);
        return { block: true, reason: "ATDD applicability is unknown for " + path +
          ". Inspect the graph manually or extend the selectors; retry to continue. This is not proof of compliance." };
      }
    } catch (error) {
      return { block: true, reason: "ATDD could not validate its graph: " + String(error) };
    }
  });
}
