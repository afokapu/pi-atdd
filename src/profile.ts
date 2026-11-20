// PLT-84: structure profiles (data, not rules). A profile maps the roles a convention core speaks about onto one
// stack's paths, suffixes, idioms and tools. Keys come from the frozen vocabulary (profiles/vocabulary.yaml v3).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expandKeys, loadVocabulary } from "./profile-vocabulary.ts";
import { GraphError, matchesGlob, type Selector } from "./catalog.ts";

export type StructureProfile = { schema: string; stack: string; vocabularyVersion: number; extends?: string; values: Record<string, unknown> };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const DEFAULT_PROFILE = "atdd-bun";
/** Roles that name a layer of the code, in the order a path is assigned to one. */
export const LAYER_ROLES = ["domain", "application", "integration", "presentation", "composition_root"] as const;

export function loadProfile(path: string): StructureProfile {
  const p = JSON.parse(readFileSync(path, "utf8")) as StructureProfile;
  const problems = profileProblems(p);
  if (problems.length) throw new GraphError("invalid profile " + path + ": " + problems.join("; "));
  return p;
}
/** Resolve a profile by stack name (profiles/stacks/<name>.json) or by a project-local path. */
export function profileByName(name: string): StructureProfile { return loadProfile(join(ROOT, "profiles/stacks", name + ".json")); }

export function profileProblems(p: StructureProfile): string[] {
  const v = loadVocabulary(), keys = new Map(expandKeys(v).map(k => [k.key, k.type]));
  const out: string[] = [];
  if (p.schema !== "pi-atdd/structure-profile/v1") out.push("schema must be pi-atdd/structure-profile/v1");
  if (!/^[a-z0-9-]+$/.test(p.stack ?? "")) out.push("stack must match [a-z0-9-]+");
  if (p.vocabularyVersion !== v.version) out.push("vocabularyVersion " + p.vocabularyVersion + " is not the frozen " + v.version);
  const strings = (x: unknown) => Array.isArray(x) && x.every(y => typeof y === "string");
  for (const [k, val] of Object.entries(p.values ?? {})) {
    const type = keys.get(k);
    if (!type) { out.push("not a vocabulary key: " + k); continue; }
    const ok = type === "list" ? strings(val)
      : type === "map" ? typeof val === "object" && val !== null && !Array.isArray(val)
      : type === "text" ? typeof val === "string"
      : typeof val === "string" || strings(val); // path, glob, pattern
    if (!ok) out.push(k + ": value does not fit type " + type);
  }
  return out;
}

const list = (x: unknown): string[] => x === undefined ? [] : Array.isArray(x) ? x as string[] : [String(x)];
export const rolePatterns = (p: StructureProfile, role: string): string[] => list(p.values["roles." + role + ".path"]);

/** The role of a path under this profile, or undefined (the file is out of scope for role rules). */
export function roleOfPath(p: StructureProfile, path: string): string | undefined {
  const file = path.replaceAll("\\", "/");
  return LAYER_ROLES.find(role => rolePatterns(p, role).some(g => matchesGlob(file, g)));
}

/** Replace `roles:` in selectors by the profile's path globs (restricted to source suffixes). Path selectors pass through. */
export function expandRoleSelectors(selectors: Selector[], p: StructureProfile): Selector[] {
  const declared = new Set(loadVocabulary().groups.roles.params!.role);
  const suffixes = list(p.values["suffix.source"]);
  return selectors.map(s => {
    if (!s.roles?.length) return s;
    const globs: string[] = [];
    for (const role of s.roles) {
      if (!declared.has(role)) throw new GraphError(s.id + ": unknown role " + role);
      const pats = rolePatterns(p, role);
      if (!pats.length) throw new GraphError(s.id + ": profile " + p.stack + " has no path for role " + role);
      for (const g of pats) globs.push(...(suffixes.length && g.endsWith("/**") ? suffixes.map(x => g + x) : [g]));
    }
    const { roles: _roles, ...rest } = s;
    return { ...rest, paths: [...new Set([...(s.paths ?? []), ...globs])] };
  });
}
