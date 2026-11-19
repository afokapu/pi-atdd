#!/usr/bin/env node
/**
 * PLT-97 helper an agent calls before launching another agent. Briefs name tiers, never model names.
 *   model-tier-cli <tier> | resolve <tier> [--via <family>] [--json]
 *   model-tier-cli role <role> [--failures <n>] [--reported] [--owner-task <id> --owner-tier high|xhigh] [--json]
 *   model-tier-cli table
 *   model-tier-cli lint-brief <file>...      exit 1 when a model name is hard-coded
 * Tiers file: MODEL_TIERS_FILE, else ~/.config/model-tiers.yaml. MODEL_TIERS_ACTIVE=<family> overrides for one run.
 */
import { readFileSync } from "node:fs";
import { chooseTier, configuredModels, lintBrief, loadTiers, resolveTier, TierError, TIERS, type Tiers } from "./model-tier.ts";

const VALUE_FLAGS = new Set(["via", "failures", "owner-task", "owner-tier"]);
const BOOL_FLAGS = new Set(["json", "reported"]);
const env = process.env as Record<string, string | undefined>;

function parseArgs(argv: string[]): { words: string[]; flags: Map<string, string | true> } {
  const words: string[] = [], flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) { words.push(a); continue; }
    const name = a.slice(2);
    if (BOOL_FLAGS.has(name)) flags.set(name, true);
    else if (VALUE_FLAGS.has(name)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new TierError(`--${name} needs a value`);
      flags.set(name, value);
    } else throw new TierError(`unknown option --${name}`);
  }
  return { words, flags };
}
const show = (r: ReturnType<typeof resolveTier>, json: boolean) => json ? JSON.stringify(r)
  : `--provider ${r.provider} --model ${r.model}${r.thinking ? ` --thinking ${r.thinking}` : ""}`;

function table(t: Tiers): void {
  const families = Object.keys(t.providers);
  console.log(["tier", ...families.map(f => (f === t.active ? f + "*" : f))].join("\t"));
  for (const tier of TIERS) {
    console.log([tier, ...families.map(f => {
      try { const r = resolveTier(t, tier, { via: f, env: {} }); return r.model + ":" + (r.thinking ?? "-"); } catch { return "—"; }
    })].join("\t"));
  }
}

function lint(files: string[]): number {
  if (!files.length) throw new TierError("usage: model-tier-cli lint-brief <file>...");
  let tiers: Tiers | null = null;
  try { tiers = loadTiers(undefined, env); } catch { tiers = null; } // no tiers file: lint the generic shapes only
  const models = tiers ? configuredModels(tiers) : [];
  let total = 0;
  for (const file of files) {
    for (const f of lintBrief(readFileSync(file, "utf8"), { models })) {
      total++;
      console.log(`${file}:${f.line}: ${f.reason}: ${f.match}`);
    }
  }
  return total ? 1 : 0;
}

function main(argv: string[]): number {
  const { words, flags } = parseArgs(argv);
  const [cmd, arg] = words;
  const json = flags.has("json");
  const via = flags.get("via") as string | undefined;
  if (cmd === "table") { table(loadTiers(undefined, env)); return 0; }
  if (cmd === "lint-brief") return lint(words.slice(1));
  if (cmd === "role") {
    const ownerTask = flags.get("owner-task") as string | undefined;
    const ownerTier = flags.get("owner-tier") as string | undefined;
    const failures = flags.get("failures");
    const tier = chooseTier({
      role: arg ?? "",
      failures: failures === undefined ? 0 : Number(failures),
      reported: flags.has("reported"),
      ...(ownerTask !== undefined ? { ownerRequest: { task: ownerTask, tier: ownerTier as "high" | "xhigh" } } : {}),
    });
    console.log(show(resolveTier(loadTiers(undefined, env), tier, { via, env }), json));
    return 0;
  }
  const tier = cmd === "resolve" ? arg : cmd;
  if (!tier || words.length > (cmd === "resolve" ? 2 : 1)) {
    console.error("usage: model-tier-cli <tier> | resolve <tier> | role <role> | table | lint-brief <file>...");
    return 2;
  }
  console.log(show(resolveTier(loadTiers(undefined, env), tier, { via, env }), json));
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write("model-tier: " + (error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 2;
}
