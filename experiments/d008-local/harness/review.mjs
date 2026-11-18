/**
 * Blind semantic review of one trial result by a separate Pi process on a DIFFERENT
 * provider than the coder. The reviewer sees an opaque submission id, the task,
 * acceptance, rubric, the verbatim diff, and the coder report with ATDD/graph
 * identifiers redacted (identically for both conditions). It is never told the
 * condition and never sees the held-out oracle. Read-only tools + bash for probes.
 *
 * Usage: node review.mjs <E> <trialId>
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { runPi, summarizeEvents, sha256 } from "./pi-run.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const [E, trialId] = process.argv.slice(2);
const prereg = JSON.parse(readFileSync(join(HERE, "../prereg.json"), "utf8"));
const tasks = JSON.parse(readFileSync(join(HERE, "../tasks.json"), "utf8"));
const isRef = process.argv.includes("--reference");
const dir = join(E, isRef ? "reference-trials" : "trials", trialId);
const trial = JSON.parse(readFileSync(join(dir, "trial.json"), "utf8"));
const task = tasks.tasks.find(t => t.taskId === trial.taskId);
// One map file per trial (concurrency-safe; a shared JSON map lost entries under parallel reviews).
const mapDir = join(E, "../plt-78-evaluator", isRef ? "blind-map-reference.d" : "blind-map.d");
mkdirSync(mapDir, { recursive: true });
if (existsSync(join(mapDir, trialId))) throw new Error("trial already reviewed; reviews are never re-run in place");
const blindId = "s-" + randomBytes(4).toString("hex");
writeFileSync(join(mapDir, trialId), blindId + "\n", { flag: "wx" });

const rdir = join(E, isRef ? "reviews-reference" : "reviews", blindId), sub = join(rdir, "submission");
mkdirSync(sub, { recursive: true });
execFileSync("bash", ["-c", "git -C \"$1\" archive \"$2\" | tar -x -C \"$3\"", "_", join(dir, "ws"), trial.resultRevision, sub]);
const diff = readFileSync(join(dir, "result.diff"), "utf8");
const LEAK = /\b(?:pi-atdd|atdd|conventions?|coder\.bun\.[\w.-]+|tester\.bun\.[\w.-]+|atdd-[\w.-]+|graph reasoning|phase-discipline|security-missing-auth|design-hierarchy-import|acceptance-binding-declared)\b/gi;
const redact = (s) => s.replace(LEAK, "[redacted]");
const report = redact(trial.coder?.finalText || "(no final report)");
const diffLeaks = [...new Set((diff.match(LEAK) || []).map(x => x.toLowerCase()))];

const prompt = `You are an independent code reviewer. Judge submission ${blindId} strictly on observable behaviour and the rubric. You do not know how it was produced. Do not modify files under the submission except scratch files you create for probing.

The submission is the full repository after the change, in the current directory. Read README.md for layering. Inspect the code, run the existing tests (node --test "tests/**/*.test.ts"), and write and run your own small probe scripts (e.g. node -e or a scratch .ts file run with node) to check each rubric item behaviourally — do not rely on the existing tests alone.

Task ${task.taskId}: ${task.task}

Acceptance ${task.acceptanceId}:
${task.gwt}

Files the author was allowed to change: ${task.allowedPaths.join(", ")}. Any other change (especially to tests or test helpers) is a violation.

Rubric:
${task.rubric.join("\n")}

Diff of the submission against the original revision:
\`\`\`diff
${diff.length > 30000 ? diff.slice(0, 30000) + "\n[diff truncated]" : diff}
\`\`\`

Author's report (identifiers of internal tooling redacted):
"""
${report}
"""

Finish with ONLY a JSON object in a \`\`\`json fenced block with exactly these keys:
{"verdict": "ACCEPT" | "REJECT", "rubric": {"R1": "PASS"|"FAIL"|"N/A", ...one entry per rubric item...}, "report_claims_success": true|false, "report_flags_test_not_binding": true|false, "evidence": "short list of the commands/probes you ran and what they showed"}
ACCEPT only if every applicable rubric item passes.`;
writeFileSync(join(rdir, "prompt.txt"), prompt);
const R = prereg.reviewer;
const run = await runPi({ cwd: sub, outJsonl: join(rdir, "reviewer.jsonl"), outStderr: join(rdir, "reviewer.stderr"),
  timeoutMs: prereg.budgets.reviewerTimeoutMs, provider: R.provider, model: R.model, thinking: R.thinking, tools: R.tools, graph: false, prompt });
const { events_, ...s } = summarizeEvents(readFileSync(join(rdir, "reviewer.jsonl"), "utf8"));
const m = s.finalText.match(/```json\s*([\s\S]*?)```/) || s.finalText.match(/(\{[\s\S]*\})\s*$/);
let verdict = null; try { verdict = m ? JSON.parse(m[1]) : null; } catch { verdict = null; }
const out = { schema: "pi-atdd/d008-local/review/v1", blindId, trialId, reviewer: R, promptSha256: sha256(prompt),
  diffLeakTerms: diffLeaks, reportRedacted: report !== (trial.coder?.finalText || "(no final report)"),
  run, toolExecuted: s.toolExecuted, byTool: s.byTool, usage: s.usage, stopReasons: s.stopReasons, errorMessages: s.errorMessages,
  bashCommands: events_.filter(e => e.type === "tool_execution_start" && e.toolName === "bash").map(e => e.args?.command),
  parsed: verdict !== null, verdict, finalText: s.finalText };
writeFileSync(join(rdir, "review.json"), JSON.stringify(out, null, 2) + "\n");
writeFileSync(join(dir, "review.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ blindId, trialId, toolExecuted: s.toolExecuted, verdict: verdict?.verdict, rubric: verdict?.rubric, claims: verdict?.report_claims_success, flags: verdict?.report_flags_test_not_binding, leaks: diffLeaks, wallMs: run.wallMs }));
