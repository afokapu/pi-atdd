/**
 * PLT-97: model tiers by role and task. Tiers (`low`, `medium`, `high`, `xhigh`) are the only names
 * a brief, rule or repository file may use; the configured tiers file is the only place where a tier
 * becomes a provider, model and thinking level. Reads configuration; embeds no model names.
 * Mirrors the owner's resolver (~/.local/bin/model-tier): same file, same precedence, same fail-closed rules.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

export const TIERS = ["low", "medium", "high", "xhigh"] as const;
export type TierName = typeof TIERS[number];
/** Per-token API providers are never used by agents (owner rule); subscription providers only. */
export const FORBIDDEN_PROVIDERS: ReadonlySet<string> = new Set(["anthropic", "openai"]);
/** Owner rule: workers run on `low`; coordinators and coaches on `medium`. The PR reviewer is not listed:
 * it keeps its own configured model, so this helper refuses to choose one for it. */
export const ROLE_TIERS: Readonly<Record<string, "low" | "medium">> = Object.freeze({
  planner: "low", tester: "low", coder: "low", operator: "low",
  coach: "medium", coordinator: "medium",
});
export const DEFAULT_TIERS_FILE = join(homedir(), ".config/model-tiers.yaml");

export class TierError extends Error {}

type Entry = { model: string; thinking: string | null };
export type Tiers = {
  active: string;
  default: TierName | null;
  providers: Record<string, { provider: string }>;
  tiers: Partial<Record<TierName, { active: string | null; families: Record<string, Entry> }>>;
};
export type Resolved = { tier: TierName; family: string; provider: string; model: string; thinking: string | null };
export type Finding = { line: number; match: string; reason: string };

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown): string | null => typeof x === "string" && x.trim() ? x.trim() : null;
function fail(message: string): never { throw new TierError(message); }
const isTier = (x: unknown): x is TierName => typeof x === "string" && (TIERS as readonly string[]).includes(x);

/** Parses a tiers file. Structural errors throw; forbidden providers are rejected at resolution time. */
export function parseTiers(source: string): Tiers {
  let data: unknown;
  try { data = parse(source); } catch (error) { fail("malformed tiers file: " + String(error)); }
  if (!isObject(data)) fail("tiers file must be a YAML mapping");
  const active = text(data.active) ?? fail("tiers file needs a top-level `active` provider family");
  if (!isObject(data.providers) || !Object.keys(data.providers).length) fail("tiers file needs `providers`");
  const providers: Tiers["providers"] = {};
  for (const [family, value] of Object.entries(data.providers)) {
    const provider = isObject(value) ? text(value.provider) : null;
    if (!provider) fail(`provider family "${family}" needs a provider id`);
    providers[family] = { provider };
  }
  if (!isObject(data.tiers)) fail("tiers file needs `tiers`");
  const tiers: Tiers["tiers"] = {};
  for (const [name, value] of Object.entries(data.tiers)) {
    if (!isTier(name)) throw new TierError(`unknown tier "${name}" (known: ${TIERS.join(", ")})`);
    if (!isObject(value)) fail(`tier "${name}" must be a mapping`);
    const families: Record<string, Entry> = {};
    let tierActive: string | null = null;
    for (const [key, entry] of Object.entries(value)) {
      if (key === "active") { tierActive = text(entry) ?? fail(`tier "${name}": active must name a family`); continue; }
      if (!(key in providers)) fail(`tier "${name}" names unknown provider family "${key}"`);
      const model = isObject(entry) ? text(entry.model) : null;
      if (!model) fail(`tier "${name}" family "${key}" needs a model`);
      families[key] = { model, thinking: isObject(entry) ? text(entry.thinking) : null };
    }
    tiers[name] = { active: tierActive, families };
  }
  const dflt = data.default === undefined ? null : data.default;
  if (dflt !== null && !isTier(dflt)) throw new TierError(`default must be a tier (${TIERS.join(", ")})`);
  return { active, default: dflt as TierName | null, providers, tiers };
}

/** Reads the tiers file: explicit path, then MODEL_TIERS_FILE, then ~/.config/model-tiers.yaml. */
export function loadTiers(path?: string, env: Record<string, string | undefined> = {}): Tiers {
  const file = path ?? text(env.MODEL_TIERS_FILE) ?? DEFAULT_TIERS_FILE;
  if (!existsSync(file)) fail("tiers file not found: " + file);
  return parseTiers(readFileSync(file, "utf8"));
}

/**
 * Tier -> provider, model, thinking. Family precedence: --via, then MODEL_TIERS_ACTIVE (per run),
 * then the tier's own `active`, then the file's `active`. Fails closed on anything it cannot resolve.
 */
export function resolveTier(tiers: Tiers, tier: string,
    opts: { via?: string; env?: Record<string, string | undefined> } = {}): Resolved {
  if (!isTier(tier)) throw new TierError(`unknown tier "${tier}" (known: ${TIERS.join(", ")})`);
  const entry = tiers.tiers[tier] ?? fail(`tier "${tier}" is not defined in the tiers file`);
  const family = text(opts.via) ?? text(opts.env?.MODEL_TIERS_ACTIVE) ?? entry.active ?? tiers.active;
  const provider = tiers.providers[family]?.provider ?? fail(`unknown provider family "${family}"`);
  if (FORBIDDEN_PROVIDERS.has(provider)) fail(`provider "${provider}" is not allowed for agents`);
  const model = entry.families[family] ?? fail(`tier "${tier}" has no model for family "${family}"`);
  return { tier, family, provider, model: model.model, thinking: model.thinking };
}

/** Every model id the tiers file names; used to flag hard-coded models in briefs. */
export function configuredModels(tiers: Tiers): string[] {
  const models = new Set<string>();
  for (const tier of Object.values(tiers.tiers)) for (const entry of Object.values(tier?.families ?? {})) models.add(entry.model);
  return [...models].sort();
}

/**
 * Tier for a role and history. Base tier from ROLE_TIERS; one tier up per two failures, each escalation
 * reported (never silent); reaching high or xhigh, or an explicit owner request, needs a named task.
 */
export function chooseTier(input: {
  role: string; failures?: number; reported?: boolean;
  ownerRequest?: { task: string; tier: TierName };
}): TierName {
  if (input.ownerRequest !== undefined) {
    const { task, tier } = input.ownerRequest;
    if (!text(task)) fail("an owner request must name its task");
    if (tier !== "high" && tier !== "xhigh") fail("an owner request selects only high or xhigh");
    return tier;
  }
  if (!Object.hasOwn(ROLE_TIERS, input.role))
    fail(`no tier for role "${input.role}" (reviewers keep their configured model; other roles need an owner decision)`);
  const failures = input.failures ?? 0;
  if (!Number.isInteger(failures) || failures < 0) fail("failures must be a non-negative integer");
  const steps = Math.floor(failures / 2);
  if (steps > 0 && !input.reported) fail("escalation after failures must be reported, never silent");
  const index = TIERS.indexOf(ROLE_TIERS[input.role]!) + steps;
  if (index >= TIERS.indexOf("high")) fail("escalating to high or xhigh needs an explicit owner request for a named task");
  return TIERS[index]!;
}

// Model-id shapes that must not appear in briefs, rules or configs. Provider ids such as `pi-claude-cli`
// are not model ids, hence the negative lookbehind on `-`.
const MODEL_SHAPES: ReadonlyArray<{ re: RegExp; reason: string }> = [
  { re: /--(?:model|provider)(?:=|\s+)[^\s`'"]+/gi, reason: "hard-coded --model or --provider flag" },
  { re: /(?<![\w.-])(?:claude|gpt|gemini|kimi|glm|grok|mistral)-[a-z0-9][\w.-]*/gi, reason: "model id" },
  { re: /(?<![\w.-])(?:opus|sonnet|haiku)(?:[\s-]?\d[\w.]*)?(?![\w-])/gi, reason: "model family name" },
  { re: /(?<![\w.-])k\d+(?:\.\d+)?-[a-z]+(?![\w-])/gi, reason: "model id" },
];

/** Flags model names in a brief, rule or config. Lint evidence only; review and CI decide compliance. */
export function lintBrief(source: string, opts: { models?: readonly string[] } = {}): Finding[] {
  const configured = (opts.models ?? []).map(m => new RegExp("(?<![\\w.-])" + m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w-])", "gi"));
  const found: Finding[] = [];
  source.split(/\r?\n/).forEach((line, index) => {
    for (const { re, reason } of MODEL_SHAPES) for (const m of line.matchAll(re)) found.push({ line: index + 1, match: m[0], reason });
    for (const re of configured) for (const m of line.matchAll(re)) found.push({ line: index + 1, match: m[0], reason: "configured model id" });
  });
  return found;
}
