/**
 * PLT-85: copy curated evidence into the repo (no credentials, emails or home paths).
 * Usage: node curate.mjs <E> <EV> <VD> <SS> <outDir>
 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const [E, EV, VD, SS, OUT] = process.argv.slice(2);
const HOME = homedir();
const clean = (s) => s.replaceAll(HOME, "~").replace(/[A-Za-z0-9._%+-]+@(?!example\.invalid)[A-Za-z0-9.-]+\.[a-z]{2,}/g, "<email>");
const put = (rel, text) => { const p = join(OUT, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, clean(text)); };
const files = (d) => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : [p]; });
const map = JSON.parse(readFileSync(join(E, "blind-map.json"), "utf8"));
put("results/blind-map.json", JSON.stringify(map, null, 2) + "\n");
for (const [id, { runId, batch }] of Object.entries(map)) {
  const r = join(E, "runs", runId);
  const run = JSON.parse(readFileSync(join(r, "run.json"), "utf8"));
  put(`results/${runId}/run.json`, JSON.stringify({ ...run, blindId: id, batch }, null, 2) + "\n");
  put(`results/${runId}/result.diff`, readFileSync(join(r, "result.diff"), "utf8"));
  put(`results/${runId}/report.md`, run.finalReport ?? "");
  for (const f of ["hidden-result.json", "hidden.log"]) if (existsSync(join(r, "hidden", f))) put(`results/${runId}/hidden/${f}`, readFileSync(join(r, "hidden", f), "utf8"));
  const vd = join(VD, batch, id); if (existsSync(vd)) for (const f of files(vd)) put(`results/${runId}/evaluator/${f.slice(vd.length + 1)}`, readFileSync(f, "utf8"));
}
for (const f of files(VD).filter(f => !/\/r-[0-9a-f]{6}\//.test(f))) put("verdicts/" + f.slice(VD.length + 1), readFileSync(f, "utf8"));
for (const f of files(EV).filter(f => !f.includes("/scratch/") && !f.includes("/base/") && !f.includes("/v1/"))) put("evaluator/" + f.slice(EV.length + 1), readFileSync(f, "utf8"));
for (const f of readdirSync(SS).filter(f => f.endsWith(".summary.json"))) {
  const j = JSON.parse(readFileSync(join(SS, f), "utf8"));
  put("evaluator-sessions/" + f, JSON.stringify({ run: j.run, summary: j.summary }, null, 2) + "\n");
}
for (const f of readdirSync(SS).filter(f => f.endsWith("-prompt.md"))) put("prompts/rendered/" + f, readFileSync(join(SS, f), "utf8"));
const G = join(E, "gap-fleet");
for (const id of readdirSync(G).filter(d => d.startsWith("coder."))) for (const f of readdirSync(join(G, id)).filter(f => /\.json$|spec\.md$/.test(f) && f !== "example.author.json")) put(`conventions/gap-fleet/${id}/${f}`, readFileSync(join(G, id, f), "utf8"));
put("conventions/gap-fleet/fleet.log", readFileSync(join(G, "fleet.log"), "utf8"));
for (const f of ["conventions.md", "conventions-c.md", "gap-selection.json", "coder-prompt.txt", "EVALUATOR_MANIFEST_SHA256", "fleet.log", "anonymise.log"]) put((f.startsWith("conv") || f.startsWith("gap") ? "conventions/" : "run/") + f, readFileSync(join(E, f), "utf8"));
put("run/BASE_SHA", readFileSync(join(E, "base/BASE_SHA"), "utf8"));
for (const f of readdirSync(join(E, "qualify")).filter(f => f.endsWith(".summary.json") || f.endsWith(".txt"))) put("qualify/" + f, readFileSync(join(E, "qualify", f), "utf8"));
console.log("curated", Object.keys(map).length, "runs");
