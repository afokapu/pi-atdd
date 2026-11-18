/**
 * D008-LOCAL-001: unscored, disposable tool-use qualification per candidate model.
 * Qualification requires (a) completed top-level Pi tool_execution_start/end events
 * for read + write/edit + bash and (b) the exact filesystem effect, verified here.
 * Usage: node calibrate.mjs <evidenceRoot> <provider> <model> [thinking]
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { runPi, summarizeEvents } from "./pi-run.mjs";

const assessOnly = process.argv.includes("--assess-only");
const [root, provider, model, thinking = "low"] = process.argv.slice(2).filter(a => a !== "--assess-only");
const dir = join(root, "calibration", provider + "__" + model);
const work = join(dir, "work");
if (!assessOnly) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, "probe.txt"), "calibration token: " + randomBytes(6).toString("hex") + "\n");
}
const token = readFileSync(join(work, "probe.txt"), "utf8").trim().split(": ")[1];
const prompt = "Calibration task (disposable directory). 1) Use the read tool to read probe.txt. " +
  "2) Use the write tool to create answer.txt whose entire content is the calibration token reversed character-by-character, followed by a newline. " +
  "3) Use the bash tool to run: wc -c answer.txt . Then reply DONE.";
const run = assessOnly ? JSON.parse(readFileSync(join(dir, "verdict.json"), "utf8")) : await runPi({ cwd: work, outJsonl: join(dir, "pi.jsonl"), outStderr: join(dir, "pi.stderr"),
  timeoutMs: 5 * 60_000, provider, model, thinking, graph: false, prompt });
const s = summarizeEvents(readFileSync(join(dir, "pi.jsonl"), "utf8"));
const expected = token.split("").reverse().join("");
const answer = existsSync(join(work, "answer.txt")) ? readFileSync(join(work, "answer.txt"), "utf8").trim() : null;
const toolsOk = ["read", "bash"].every(t => s.byTool[t] > 0) && (s.byTool.write > 0 || s.byTool.edit > 0);
// Tool-use qualification = real executions + the tool-produced file exists. Content
// correctness is recorded separately as a competence signal (not a tool-use criterion).
const effectOk = answer !== null && /^[0-9a-f]{12}$/.test(answer);
const contentCorrect = answer === expected;
const verdict = { schema: "pi-atdd/d008-local/calibration/v1", provider, model, thinking,
  status: toolsOk && effectOk ? "QUALIFIED_TOOL_USE" : "UNQUALIFIED_TOOL_USE",
  toolExecuted: s.toolExecuted, byTool: s.byTool, fakeToolTextMessages: s.fakeToolTextMessages,
  fileEffectVerified: effectOk, contentCorrect, criterion: "v2: events(read,write|edit,bash) + answer.txt written by tool; contentCorrect separate", exit: run.exit, timedOut: run.timedOut, wallMs: run.wallMs,
  usage: s.usage, stopReasons: s.stopReasons, errorMessages: s.errorMessages, argv: run.argv };
writeFileSync(join(dir, "verdict.json"), JSON.stringify(verdict, null, 2) + "\n");
console.log(JSON.stringify(verdict));
