/**
 * PLT-82: copy curated evidence into the repo (no credentials, emails or home paths).
 * Usage: node curate.mjs <E> <EV> <VERDICTS> <SESSIONS> <outDir>
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const [E, EV, VD, SS, OUT] = process.argv.slice(2);
const HOME = homedir();
const clean = (s) => s.replaceAll(HOME, "~").replace(/[A-Za-z0-9._%+-]+@(?!example\.invalid)[A-Za-z0-9.-]+\.[a-z]{2,}/g, "<email>");
const put = (rel, text) => { const p = join(OUT, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, clean(text)); };
const files = (d) => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : [p]; });
const map = JSON.parse(readFileSync(join(E, "blind-map.json"), "utf8"));
put("results/blind-map.json", JSON.stringify(map, null, 2) + "\n");
for (const [id, { runId }] of Object.entries(map)) {
  const r = join(E, "runs", runId);
  const run = JSON.parse(readFileSync(join(r, "run.json"), "utf8"));
  put(`results/${runId}/run.json`, JSON.stringify({ ...run, blindId: id }, null, 2) + "\n");
  put(`results/${runId}/result.diff`, readFileSync(join(r, "result.diff"), "utf8"));
  put(`results/${runId}/report.md`, run.finalReport ?? "");
  for (const f of ["hidden-result.json", "hidden.log"]) if (existsSync(join(r, "hidden", f))) put(`results/${runId}/hidden/${f}`, readFileSync(join(r, "hidden", f), "utf8"));
  for (const vd of [join(VD, id), join(VD, "batch-2", id)]) if (existsSync(vd)) for (const f of files(vd)) put(`results/${runId}/evaluator/${f.slice(vd.length + 1)}`, readFileSync(f, "utf8"));
}
if (existsSync(join(VD, "ranking.json"))) put("verdicts/ranking-batch-1.json", readFileSync(join(VD, "ranking.json"), "utf8"));
if (existsSync(join(VD, "batch-2/ranking.json"))) put("verdicts/ranking-final.json", readFileSync(join(VD, "batch-2/ranking.json"), "utf8"));
for (const f of files(VD).filter(f => !/\/r-[0-9a-f]{6}\//.test(f.slice(VD.length)) && !f.endsWith("ranking.json"))) put("verdicts/" + f.slice(VD.length + 1), readFileSync(f, "utf8"));
for (const f of files(EV).filter(f => !f.includes("/scratch/") && !f.includes("/base/"))) put("evaluator/" + f.slice(EV.length + 1), readFileSync(f, "utf8"));
for (const s of ["authoring", "verdict", "verdict-b2"]) if (existsSync(join(SS, s + ".summary.json"))) {
  const j = JSON.parse(readFileSync(join(SS, s + ".summary.json"), "utf8"));
  put(`evaluator-sessions/${s}.summary.json`, JSON.stringify({ run: j.run, summary: { ...j.summary, finalText: j.summary.finalText } }, null, 2) + "\n");
}
for (const f of ["authoring-prompt.md", "verdict-prompt.md", "verdict-b2-prompt.md"]) put("prompts/" + f.replace("-prompt", "-prompt.rendered"), readFileSync(join(SS, f), "utf8"));
put("results/VOID.txt", readFileSync(join(E, "runs-void/VOID.txt"), "utf8"));
for (const v of readdirSync(join(E, "runs-void")).filter(n => n !== "VOID.txt")) {
  const run = JSON.parse(readFileSync(join(E, "runs-void", v, "run.json"), "utf8"));
  put(`results/void/${v}/run.json`, JSON.stringify(run, null, 2) + "\n");
  put(`results/void/${v}/result.diff`, readFileSync(join(E, "runs-void", v, "result.diff"), "utf8"));
}
put("base/BASE_SHA", readFileSync(join(E, "base/BASE_SHA"), "utf8"));
put("base/EVALUATOR_MANIFEST_SHA256", readFileSync(join(E, "EVALUATOR_MANIFEST_SHA256"), "utf8"));
const q = join(E, "qualify"); for (const f of readdirSync(q)) put("qualify/" + f, readFileSync(join(q, f), "utf8"));
console.log("curated", Object.keys(map).length, "runs");
