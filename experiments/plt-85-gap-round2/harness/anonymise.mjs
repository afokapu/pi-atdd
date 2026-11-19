/**
 * PLT-85: anonymise the immutable results (copied from PLT-82 anonymise.mjs; redaction extended with glm/zai/zhipu/terra and the arm labels) for the blind evaluator.
 * For each run: export the result revision (git archive), redact model/provider/
 * condition identifiers in text files, write the redacted diff and final report,
 * and assign an opaque id in a shuffled order. The map stays operator-side.
 * Also runs the evaluator's run-hidden.mjs mechanically on the UNREDACTED export.
 * Usage: node anonymise.mjs <E> <EV> <WORK> [--batch <name> --only runA,runB]
 * A second batch appends to blind-map.json (ids never reused, existing entries untouched).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomInt } from "node:crypto";

const argv = process.argv.slice(2);
const [E, EV, WORK] = argv;
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const batch = opt("--batch") ?? "batch-1";
const only = opt("--only")?.split(",");
const prior = existsSync(join(E, "blind-map.json")) ? JSON.parse(readFileSync(join(E, "blind-map.json"), "utf8")) : null;
if (prior && !only) throw new Error("already anonymised; a later batch needs --only");
const done = new Set(Object.values(prior ?? {}).map(v => v.runId));
const runs = readdirSync(join(E, "runs")).filter(r => existsSync(join(E, "runs", r, "run.json")) && (!only || only.includes(r)));
for (const r of runs) if (done.has(r)) throw new Error("already anonymised: " + r);
if (only && runs.length !== only.length) throw new Error("missing run.json for some of " + only);
for (let i = runs.length - 1; i > 0; i--) { const j = randomInt(i + 1); [runs[i], runs[j]] = [runs[j], runs[i]]; }
const PATTERNS = [/coder\.(bun|htmx)\.[a-z0-9.-]+/gi, /\b(kimi|moonshot|claude|anthropic|haiku|opus|sonnet|luna|sol|terra|glm[0-9.-]*|zai|z\.ai|zhipu|gpt-?[0-9.]*|openai|codex)\b/gi,
  /\bconventions?\b/gi, /\bpi-atdd\b/gi, /\b(baseline|graph|catalog|arm [abc])\b/gi];
const redact = (s) => { let n = 0; for (const p of PATTERNS) s = s.replace(p, () => (n++, "[REDACTED]")); return [s, n]; };
const files = (d) => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? (n === "node_modules" ? [] : files(p)) : [p]; });
const map = { ...(prior ?? {}) };
for (const r of runs) {
  const run = JSON.parse(readFileSync(join(E, "runs", r, "run.json"), "utf8"));
  const id = "r-" + randomBytes(3).toString("hex");
  const raw = join(E, "runs", r, "export"); mkdirSync(raw, { recursive: true });
  execFileSync("bash", ["-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "_", join(E, "runs", r, "ws"), run.resultRevision, raw]);
  const out = join(WORK, id); mkdirSync(join(out, "tree"), { recursive: true });
  execFileSync("bash", ["-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "_", join(E, "runs", r, "ws"), run.resultRevision, join(out, "tree")]);
  let redactions = 0;
  for (const f of files(join(out, "tree"))) { const [t, n] = redact(readFileSync(f, "utf8")); if (n) { writeFileSync(f, t); redactions += n; } }
  const [diff, nd] = redact(readFileSync(join(E, "runs", r, "result.diff"), "utf8"));
  const [report, nr] = redact(run.finalReport || "(no final report)");
  writeFileSync(join(out, "result.diff"), diff); writeFileSync(join(out, "report.md"), report);
  mkdirSync(join(E, "runs", r, "hidden"), { recursive: true });
  try { execFileSync(process.execPath, [join(EV, "run-hidden.mjs"), raw, join(E, "runs", r, "hidden")], { stdio: "ignore", timeout: 300_000 }); } catch {}
  map[id] = { runId: r, batch, redactions: { tree: redactions, diff: nd, report: nr } };
  console.log(id, r, redactions, nd, nr);
}
writeFileSync(join(E, "blind-map.json"), JSON.stringify(map, null, 2) + "\n");
