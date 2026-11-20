// PLT-84 second-stack arms: render, per task, the conventions that the REAL role activation selects under the
// ts-hexagon profile. B = core + profile; C = core + profile + labelled Bun reference.
// Usage: node --experimental-strip-types render-conventions.ts <profile.json> <tasks.json> <outDir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCatalog, loadConfig, resolveContext } from "../../src/catalog.ts";
import { loadNeutralRecords, renderForStack } from "../../src/neutral-render.ts";
import { loadProfile } from "../../src/profile.ts";
const ROOT = new URL("../..", import.meta.url).pathname;
const [profilePath, tasksPath, out] = process.argv.slice(2);
const profile = loadProfile(profilePath), cfg = loadConfig(ROOT, profile), catalog = loadCatalog(cfg.sources, ROOT);
const recs = new Map(loadNeutralRecords().map(r => [r.rule_id, r]));
mkdirSync(out, { recursive: true });
const summary: Record<string, string[]> = {};
for (const t of JSON.parse(readFileSync(tasksPath, "utf8")).tasks) {
  const ctx = resolveContext(catalog, cfg.selectors, t.task, t.allowedPaths, "edit", 20);
  const ids = ctx.matchingIds.filter(id => recs.has(id));
  summary[t.taskId] = ids;
  for (const [arm, bunReference] of [["B", false], ["C", true]] as const) {
    const body = ids.map(id => renderForStack(recs.get(id)!, profile.stack, { profile, bunReference }).text).join("\n---\n\n");
    writeFileSync(join(out, t.taskId + "." + arm + ".md"), body);
  }
}
writeFileSync(join(out, "delivered.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary));
