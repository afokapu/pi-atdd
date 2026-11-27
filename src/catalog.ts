import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { DEFAULT_PROFILE, expandRoleSelectors, loadProfile, profileByName, type StructureProfile } from "./profile.ts";
import {
  isCurrentFieldKey, isCurrentMovedPath, isCurrentUrnScheme, legacySunsetRelease, legacyTermsPhase, resolveDetectorRef,
  resolveFieldKey, resolveMovedPath, resolveUrnScheme, upstreamDetectorRef,
} from "./vocabulary.ts";

export class GraphError extends Error {}
export type SourceKind = "bun" | "flow" | "extension";
export type SourceSpec = { id: string; path: string; kind: SourceKind; sha256: string; revision?: string };
export type Convention = {
  id: string; file: string; source: string; statement: string; kind: string;
  disposition: string | null; exceptions: string[]; summary: string; guidance: string;
  /** The detector name as the pinned upstream (ATDD-Bun) names it; the name this repository ships is `detectorRef`. */
  implementationRef: string | null;
  detectorRef: string | null;
};
/** PLT-103: the advisory legacy-vocabulary convention; its disposition follows the sunset (see loadCatalog). */
export const LEGACY_TERMS_RULE = "shared.vocabulary.legacy-terms";
/** Evaluation date of the sunset. Defaults: today (UTC), and the release date in conventions/legacy-terms.yaml. */
export type CatalogOptions = {
  today?: string;
  /** Release date override (tests and embedding). Default: the `sunset.date` read from `legacyTerms`. */
  legacyRelease?: string | null;
  /** The mapping table to read the sunset date from. Default: conventions/legacy-terms.yaml in the package. */
  legacyTerms?: string;
};
export type Relation = {
  source: string; target: string; type: string; constraint: string; control: string;
  reason: string; sourceFile: string;
};
export type Catalog = {
  rules: Map<string, Convention>; edges: Relation[];
  provenance: { id: string; digest: string; revision?: string; path: string }[];
  unresolvedEdges: Relation[];
  /** PLT-87: pre-rename id -> current id, for every renamed rule present in this catalog. */
  aliases: Map<string, string>;
};
export type Selector = {
  id: string; rules: string[]; operations?: string[];
  paths?: string[]; terms?: string[]; always?: boolean;
  /** PLT-84: roles (domain, application, ...) resolved to path globs through the active structure profile. */
  roles?: string[];
  /** ATD-45: profile roots (source, plan, test, e2e) resolved to `<root>/**` through the active structure profile. */
  roots?: string[];
};
export type Context = {
  status: "matched" | "unresolved"; rules: Array<Convention & { reasons: string[] }>;
  matchingIds: string[]; truncated: boolean;
  /** ATD-45: start of the next page of rule bodies (pass as offset), or null when every matched rule was delivered. */
  nextOffset: number | null; sourceLocks: Catalog["provenance"];
  unresolvedReferences: Relation[]; relatedRelations: Relation[]; note: string;
};
const edgeTypes = new Set(["requires", "blocks", "enables", "follows", "awaits",
  "triggered_by", "starts_with", "runs_alongside", "finishes_with", "relieves"]);
const dispositions = new Set(["strict", "advisory", "documentation-only", "suppress-and-clean"]);

function fileTree(folder: string): string[] {
  if (!existsSync(folder)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(folder, entry.name);
    if (entry.isSymbolicLink()) throw new GraphError("symlink is forbidden in convention source: " + abs);
    if (entry.isDirectory()) out.push(...fileTree(abs));
    else if (entry.name.endsWith(".convention.yaml")) out.push(abs);
  }
  return out;
}

function filesFor(root: string, kind: SourceKind): string[] {
  const folders = kind === "bun" ? ["conventions", "planner-nodes/nodes"] : ["conventions"];
  const files = folders.flatMap(folder => fileTree(join(root, folder)));
  if (kind === "bun" || kind === "extension") {
    const graph = join(root, "relationships.yaml");
    if (kind === "bun" && !existsSync(graph)) throw new GraphError("missing Bun relationship graph: " + graph);
    if (existsSync(graph)) files.push(graph);
  }
  if (!files.some(f => f.endsWith(".convention.yaml"))) throw new GraphError("no conventions in " + root);
  return files.sort();
}

export function digestSource(root: string, kind: SourceKind): string {
  const hash = createHash("sha256");
  for (const path of filesFor(root, kind)) {
    const name = relative(root, path).replaceAll("\\", "/");
    const raw = readFileSync(path);
    const id = Buffer.from(name);
    const n = Buffer.alloc(8), m = Buffer.alloc(8);
    n.writeBigUInt64BE(BigInt(id.length)); m.writeBigUInt64BE(BigInt(raw.length));
    hash.update(n).update(id).update(m).update(raw);
  }
  return hash.digest("hex");
}

export function readYaml(path: string): Record<string, unknown> {
  let doc;
  try {
    doc = parseDocument(readFileSync(path, "utf8"), { strict: true, uniqueKeys: true });
  } catch (error) { throw new GraphError(path + ": " + String(error)); }
  if (doc.errors.length) throw new GraphError(path + ": " + doc.errors.map(e => e.message).join("; "));
  const data: unknown = doc.toJS({ maxAliasCount: 100 });
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new GraphError(path + ": expected YAML object");
  return data as Record<string, unknown>;
}
const obj = (x: unknown): Record<string, unknown> => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};
const str = (x: unknown): string => typeof x === "string" ? x : "";
const textList = (x: unknown): string[] => Array.isArray(x) && x.every(v => typeof v === "string") ? x : [];

/** PLT-87 profile-first naming: `<profile>.<area>.<rule>`; `shared.*` reaches every profile. */
export const PROFILES = ["planner", "tester", "coder", "reviewer", "coach", "shared"] as const;
export type Profile = typeof PROFILES[number];
export const CONVENTION_ID = /^(planner|tester|coder|reviewer|coach|shared)\.[a-z0-9-]+\.[a-z0-9-]+$/;
/** Old (v0.2.0) id -> profile-first id, shipped with the package (conventions/aliases.json).
 * Includes the legacy split-part ids (`splitParts`, PLT-87) and the ids renamed by the PLT-103 vocabulary change
 * (`renamedRuleIds`): they resolve like any other legacy id. */
export function bundledAliases(): Map<string, string> {
  const path = join(packageRoot, "conventions/aliases.json");
  if (!existsSync(path)) return new Map();
  const data = JSON.parse(readFileSync(path, "utf8")) as {
    aliases?: Record<string, string>; splitParts?: Record<string, string>; renamedRuleIds?: Record<string, string>;
  };
  return new Map([...Object.entries(data.aliases ?? {}), ...Object.entries(data.splitParts ?? {}),
    ...Object.entries(data.renamedRuleIds ?? {})]);
}
/** PLT-119: split part id -> the loaded parent rule it was split from (conventions/aliases.json `splitPartParents`).
 * The parts are sidecar and neutral records, not loaded rules, so a legacy part id resolves to the parent. */
export function bundledSplitParents(): Map<string, string> {
  const path = join(packageRoot, "conventions/aliases.json");
  if (!existsSync(path)) return new Map();
  const data = JSON.parse(readFileSync(path, "utf8")) as { splitPartParents?: Record<string, string> };
  return new Map(Object.entries(data.splitPartParents ?? {}));
}
/** Resolves an old or current id to the id loaded in this catalog (unknown ids are returned unchanged). */
export function canonicalRuleId(catalog: Pick<Catalog, "rules" | "aliases">, id: string): string {
  return catalog.rules.has(id) ? id : catalog.aliases.get(id) ?? id;
}
/** PLT-103: a declared detector is reported under its pinned upstream name, with the shipped name kept beside it. */
function detectorNames(shipped: string): { implementationRef: string | null; detectorRef: string | null } {
  if (!shipped) return { implementationRef: null, detectorRef: null };
  return { implementationRef: upstreamDetectorRef(shipped), detectorRef: shipped };
}

/** PLT-103: the loaded convention whose file is the given repository-relative path (old or current location). */
function conventionAtPath(catalog: Pick<Catalog, "rules" | "provenance">, rel: string): Convention | undefined {
  for (const src of catalog.provenance) {
    const base = relative(packageRoot, src.path).replaceAll("\\", "/");
    if (!rel.startsWith(base + "/")) continue;
    const file = src.id + "/" + rel.slice(base.length + 1);
    return [...catalog.rules.values()].find(rule => rule.file === file);
  }
  return undefined;
}

export type LegacyResolution = {
  ref: string;
  kind: "rule" | "path" | "urn" | "field" | "detector" | "unknown";
  /** The current name (rule id, path, URN, field key or detector ref); null when the reference is unknown. */
  current: string | null;
  /** The pinned upstream detector name, when the reference is or names a detector. */
  upstream: string | null;
  /** The detector mapping of the reference, reported even when the reference is also a rule id (the names can coincide). */
  detector?: { current: string; upstream: string };
  convention?: Convention;
};
const URN_SCHEME = /^((?:acc|test):)?([a-z][a-z-]*):/;
/** PLT-103: resolves any legacy or current name to its current form, through the loaded catalog and the mapping data. */
export function resolveLegacyReference(catalog: Catalog, ref: string): LegacyResolution {
  const shipped = resolveDetectorRef(ref), upstream = upstreamDetectorRef(shipped);
  const detector = shipped !== ref || upstream !== shipped ? { current: shipped, upstream } : undefined;
  if (catalog.rules.has(ref) || catalog.aliases.has(ref)) {
    const id = canonicalRuleId(catalog, ref);
    return { ref, kind: "rule", current: id, upstream: detector?.upstream ?? null, detector, convention: catalog.rules.get(id) };
  }
  // A known moved file resolves whatever its suffix (neutral JSON and golden TXT included). Any other convention path
  // resolves only when a loaded rule is declared at it: a path the catalog cannot load is not resolved.
  const mapped = resolveMovedPath(ref);
  if (mapped !== ref || isCurrentMovedPath(ref))
    return { ref, kind: "path", current: mapped, upstream: null, convention: conventionAtPath(catalog, mapped) };
  if (ref.endsWith(".convention.yaml")) {
    const convention = conventionAtPath(catalog, ref);
    if (convention) return { ref, kind: "path", current: ref, upstream: null, convention };
  }
  // An old or a current URN scheme: the current form is the same name with the table's scheme.
  const urn = URN_SCHEME.exec(ref);
  if (urn) {
    const scheme = urn[2]!, current = resolveUrnScheme(scheme);
    if (current !== scheme || isCurrentUrnScheme(scheme))
      return { ref, kind: "urn", current: (urn[1] ?? "") + current + ":" + ref.slice(urn[0].length), upstream: null };
  }
  const field = resolveFieldKey(ref);
  if (field !== ref || isCurrentFieldKey(ref)) return { ref, kind: "field", current: field, upstream: null };
  if (detector) return { ref, kind: "detector", current: detector.current, upstream: detector.upstream, detector };
  return { ref, kind: "unknown", current: null, upstream: null };
}

/** Conventions delivered to a profile: its own family plus `shared.*`. */
export function rulesForProfile(catalog: Pick<Catalog, "rules">, profile: Profile): string[] {
  if (!PROFILES.includes(profile)) throw new GraphError("unknown profile " + profile);
  return [...catalog.rules.keys()].filter(id => id.startsWith(profile + ".") || id.startsWith("shared.")).sort();
}
/** N-001 lint: id matches the scheme and the file is `conventions/<profile>/<area>/<id>.convention.yaml`. */
export function namingViolations(catalog: Pick<Catalog, "rules">): string[] {
  const out: string[] = [];
  for (const [id, rule] of catalog.rules) {
    if (!CONVENTION_ID.test(id)) { out.push(id + ": id does not match <profile>.<area>.<rule>"); continue; }
    const [profile, area] = id.split(".");
    const rel = rule.file.slice(rule.source.length + 1);
    const want = "conventions/" + profile + "/" + area + "/" + id + ".convention.yaml";
    if (rel !== want) out.push(id + ": file " + rel + " should be " + want);
  }
  return out.sort();
}

export function loadCatalog(sources: SourceSpec[], cwd: string, options: CatalogOptions = {}): Catalog {
  if (!sources.length) throw new GraphError("at least one locked source is required");
  const rules = new Map<string, Convention>();
  const edges: Relation[] = [];
  const provenance: Catalog["provenance"] = [];
  for (const src of sources) {
    if (!src.id || !src.path || !["bun", "flow", "extension"].includes(src.kind))
      throw new GraphError("source needs id/path and kind bun|flow|extension");
    if (!/^[a-f0-9]{64}$/.test(src.sha256)) throw new GraphError("source must have exact sha256: " + src.id);
    const root = resolve(cwd, src.path);
    if (!existsSync(root) || !lstatSync(root).isDirectory()) throw new GraphError("missing convention directory " + root);
    const digest = digestSource(root, src.kind);
    if (digest !== src.sha256) throw new GraphError("source drift for " + src.id + ": " + digest + " != " + src.sha256);
    provenance.push({ id: src.id, digest, revision: src.revision, path: root });
    const files = filesFor(root, src.kind).filter(f => f.endsWith(".convention.yaml"));
    const localIds = new Set<string>();
    for (const file of files) {
      const yaml = readYaml(file), id = str(yaml.rule_id);
      if (!id || localIds.has(id) || rules.has(id)) throw new GraphError("missing/duplicate convention ID " + id + " at " + file);
      const metadata = obj(yaml.metadata), content = obj(yaml.content), implementation = obj(yaml.implementation), disposition = metadata.disposition ?? null;
      if (disposition !== null && !dispositions.has(String(disposition))) throw new GraphError("unknown disposition " + String(disposition));
      const exceptions = yaml.exceptions ?? content.exceptions ?? [];
      if (!Array.isArray(exceptions) || !exceptions.every(e => typeof e === "string")) throw new GraphError(file + ": invalid exceptions");
      const rel = relative(root, file).replaceAll("\\", "/");
      rules.set(id, {
        id, file: src.id + "/" + rel, source: src.id, statement: str(yaml.statement),
        kind: str(yaml.kind) || "rule", disposition: disposition === null ? null : String(disposition),
        exceptions, summary: str(content.summary), guidance: str(content.fix_hint) || str(content.canonical_policy) || str(content.normative_text),
        ...detectorNames(str(implementation.ref)),
      });
      localIds.add(id);
    }
    if (src.kind === "flow" || (src.kind === "extension" && !existsSync(join(root, "relationships.yaml")))) continue;
    const path = join(root, "relationships.yaml");
    const graph = readYaml(path), nodes = graph.nodes, relations = graph.edges;
    if (!Array.isArray(nodes) || !nodes.every(n => typeof n === "string") || new Set(nodes).size !== nodes.length)
      throw new GraphError(path + ": invalid node registry");
    if (nodes.length !== localIds.size || nodes.some(n => !localIds.has(n)))
      throw new GraphError(path + ": node registry does not match source convention nodes");
    if (!Array.isArray(relations)) throw new GraphError(path + ": missing relationship list");
    for (const value of relations) {
      const e = obj(value), source = str(e.source_ref), target = str(e.target_ref), type = str(e.type);
      const constraint = str(e.constraint) || "mandatory", control = str(e.control) || "internal";
      if (!source || !target || !edgeTypes.has(type) || !["mandatory", "conditional", "discretionary"].includes(constraint)
          || !["internal", "external", "autonomous"].includes(control))
        throw new GraphError(path + ": invalid relationship");
      edges.push({ source, target, type, constraint, control, reason: str(e.reason), sourceFile: src.id + "/relationships.yaml" });
    }
  }
  // PLT-103 sunset: the advisory becomes strict 60 days after the release date in the mapping table. Only an
  // advisory convention can change; every other disposition is taken as authored.
  const legacy = rules.get(LEGACY_TERMS_RULE);
  if (legacy?.disposition === "advisory") {
    const release = options.legacyRelease !== undefined ? options.legacyRelease : legacySunsetRelease(options.legacyTerms);
    const today = options.today ?? new Date().toISOString().slice(0, 10);
    legacy.disposition = legacyTermsPhase({ release, today });
  }
  const aliases = new Map<string, string>();
  const parents = bundledSplitParents();
  for (const [old, named] of bundledAliases()) {
    const current = rules.has(named) ? named : parents.get(named) ?? named;
    if (old !== current && rules.has(current) && !rules.has(old)) aliases.set(old, current);
  }
  // Extension graphs may still name pre-rename ids; they resolve to the current rule.
  for (const e of edges) {
    e.source = canonicalRuleId({ rules, aliases }, e.source);
    e.target = canonicalRuleId({ rules, aliases }, e.target);
  }
  const unresolvedEdges = edges.filter(e => !rules.has(e.source) || !rules.has(e.target));
  return { rules, edges, provenance, unresolvedEdges, aliases };
}
const WORD_CHAR = /[a-z0-9_]/;
const TOKEN_TRIM = /^[\s()[\]{}"'`,;:<>]+|[\s()[\]{}"'`,;:<>.?!]+$/g;
/** A whitespace-delimited token that names a file or directory path, not prose. */
const PATH_ROOTS = new Set(["src", "tests", "test", "lib", "app", "apps", "packages", "e2e", "scripts", "docs",
  "internal", "cmd", "pkg", "vendor", "dist", "build", "config", "bin", "spec", "fixtures"]);
function isPathToken(token: string): boolean {
  const t = token.replace(TOKEN_TRIM, "").replace(/#.*$/, "").replace(/:\d+(?::\d+)?$/, "");
  if (/^(?:\.{1,2}\/|\/|~\/)/.test(t)) return true;          // ./x, ../x, /abs, ~/x
  const segments = t.split("/");
  const named = segments.filter(Boolean);
  if (segments.length < 2) return /^[^\s]+\.[a-z][a-z0-9]{0,9}$/.test(t) && !/^[a-z]\.[a-z]\.?$/.test(t); // file.ext (not e.g.)
  if (PATH_ROOTS.has(named[0] ?? "")) return true;              // src/..., tests/...
  if (named.slice(1).some(seg => /\.[a-z0-9]{1,10}$/.test(seg))) return true; // dir/file.ext
  if (named.length >= 4) return true;                           // a/b/c/d is a path, not prose
  return t.endsWith("/") && named.length >= 2;                  // a/b/ (directory)
}
/**
 * Selector term match on word boundaries (case-insensitive). A term never
 * matches inside a longer word (`red` in `configured`) or inside a token that
 * names a file path (`integration/` in `src/pricing/integration/x.ts`, `route`
 * in `src/orders/routes/order-routes.ts`). Prose separators still delimit words
 * (`red/green/refactor`, `-red`, `integration/feature-x`), and a simple plural
 * (`routes`, `imports`) matches.
 */
export function termMatches(text: string, term: string): boolean {
  const hay = text.toLowerCase(), needle = term.toLowerCase();
  if (!needle) return false;
  const startsWord = WORD_CHAR.test(needle[0]!), endsWord = WORD_CHAR.test(needle.at(-1)!);
  const tokenAt = (i: number) => {
    let s = i, e = i;
    while (s > 0 && !/\s/.test(hay[s - 1]!)) s--;
    while (e < hay.length && !/\s/.test(hay[e]!)) e++;
    return hay.slice(s, e);
  };
  const beforeOk = (i: number) => !startsWord || i === 0 || !WORD_CHAR.test(hay[i - 1]!);
  const afterOk = (k: number) => {
    if (!endsWord) return true;
    const c = hay[k];
    return c === undefined || !WORD_CHAR.test(c);
  };
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    if (!beforeOk(i)) continue;
    const end = i + needle.length;
    const ends = endsWord ? [end, ...(hay[end] === "s" ? [end + 1] : []), ...(hay.startsWith("es", end) ? [end + 2] : [])] : [end];
    if (!ends.some(afterOk)) continue;
    if (isPathToken(tokenAt(i))) continue;
    return true;
  }
  return false;
}
export function matchesGlob(file: string, pattern: string): boolean {
  let regex = "^";
  for (let i = 0; i < pattern.length;) {
    const ch = pattern[i]!;
    if (pattern.slice(i, i + 3) === "**/") { regex += "(?:.*/)?"; i += 3; continue; }
    if (pattern.slice(i, i + 2) === "**") { regex += ".*"; i += 2; continue; }
    if (ch === "*") { regex += "[^/]*"; i++; continue; }
    if (ch === "?") { regex += "[^/]"; i++; continue; }
    regex += /[\\.^$+{}()|[\]]/.test(ch) ? "\\" + ch : ch;
    i++;
  }
  return new RegExp(regex + "$").test(file.replaceAll("\\", "/"));
}
export function validateSelectors(catalog: Catalog, selectors: Selector[]): void {
  const ids = new Set<string>();
  for (const item of selectors) {
    if (typeof item?.id !== "string" || !item.id || ids.has(item.id)) throw new GraphError("duplicate/missing selector ID");
    ids.add(item.id);
    if (!Array.isArray(item.rules) || !item.rules.length) throw new GraphError(item.id + ": missing rules");
    for (const rule of item.rules) {
      if (!catalog.rules.has(canonicalRuleId(catalog, rule))) throw new GraphError(item.id + ": unknown rule " + rule);
    }
    if (!item.always && !item.paths?.length && !item.terms?.length)
      throw new GraphError(item.id + ": selector has no activation predicate");
    for (const field of ["paths", "terms", "operations"] as const) {
      const values = item[field];
      if (values !== undefined && (!Array.isArray(values) || !values.every(x => typeof x === "string" && x)))
        throw new GraphError(item.id + ": invalid " + field);
    }
  }
}
export function resolveContext(catalog: Catalog, selectors: Selector[], task: string,
    paths: string[], operation = "task", limit = 12, offset = 0): Context {
  validateSelectors(catalog, selectors);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new GraphError("invalid limit");
  if (!Number.isInteger(offset) || offset < 0) throw new GraphError("invalid offset");
  const reasons = new Map<string, Set<string>>(), selected = new Set<string>();
  for (const item of selectors) {
    if (item.operations?.length && !item.operations.includes(operation)) continue;
    const evidence = [
      ...paths.flatMap(path => (item.paths || []).filter(pattern => matchesGlob(path, pattern)).map(p => "path:" + p)),
      ...(item.terms || []).filter(term => termMatches(task, term)).map(t => "term:" + t),
      ...(item.always ? ["always"] : []),
    ];
    if (!evidence.length) continue;
    for (const id of item.rules.map(r => canonicalRuleId(catalog, r))) {
      selected.add(id);
      const rs = reasons.get(id) || new Set<string>();
      evidence.forEach(e => rs.add(item.id + ":" + e));
      reasons.set(id, rs);
    }
  }
  const queue = [...selected].sort();
  while (queue.length) {
    const id = queue.pop()!;
    for (const e of catalog.edges) {
      if (e.source !== id || e.type !== "requires" || e.constraint !== "mandatory") continue;
      if (!catalog.rules.has(e.target)) throw new GraphError(id + ": unresolved mandatory dependency " + e.target);
      if (!selected.has(e.target)) { selected.add(e.target); queue.push(e.target); }
      const rs = reasons.get(e.target) || new Set<string>();
      rs.add("requires:" + id);
      reasons.set(e.target, rs);
    }
  }
  const matchingIds = [...selected].sort();
  return {
    status: matchingIds.length ? "matched" : "unresolved",
    matchingIds, truncated: matchingIds.length > offset + limit,
    nextOffset: matchingIds.length > offset + limit ? offset + limit : null, sourceLocks: catalog.provenance,
    unresolvedReferences: catalog.unresolvedEdges,
    relatedRelations: catalog.edges.filter(edge => selected.has(edge.source) && selected.has(edge.target)),
    rules: matchingIds.slice(offset, offset + limit).map(id => ({ ...catalog.rules.get(id)!, reasons: [...reasons.get(id)!].sort() })),
    note: matchingIds.length
      ? "Context is guidance, not proof of compliance; validate required checks independently."
      : "Unresolved applicability is a coverage gap; do not assume there are no obligations.",
  };
}
/** Fixed, audited snapshots included in the Pi package; no runtime network dependency. */
export const packageRoot = fileURLToPath(new URL("../", import.meta.url));
export function bundledSources(): SourceSpec[] {
  return [
    { id: "ATDD-Bun", path: join(packageRoot, "vendor/atdd-bun"), kind: "bun",
      revision: "5945d97e18310e7c862c08e73985400935d21346",
      sha256: "fb6173026d0a5caef9de4ad7daa6433cfe36e6aca5bccdc826b1e5a92903a28a" },
    { id: "ATDD-Flow", path: join(packageRoot, "vendor/atdd-flow"), kind: "flow",
      revision: "2a66019a5ecf2b7a9f999ebfa04d04c9f548f19a",
      sha256: "61665ba225ffc6c0bed6952aa8f8c9d9c0e2f0d7df3982662a2cdf50eb327438" },
    // Package-authored conventions (PLT-87): rules owned by pi-atdd itself, not mirrored upstream.
    // PLT-96 added the shared/coder/planner tracker rules and catalog/pi-atdd/relationships.yaml; pin re-reviewed.
    { id: "pi-atdd", path: join(packageRoot, "catalog/pi-atdd"), kind: "extension",
      sha256: "b9b6722569547cf4d0a81a1bbffd9532909a3d6273333b5e36366e7176009e26" },
  ];
}
function selectorFile(file: string): Selector[] {
  const data = readYaml(file);
  if (data.schema !== "pi-atdd/selectors/v1" || !Array.isArray(data.selectors))
    throw new GraphError("invalid selectors schema: " + file);
  return data.selectors as Selector[];
}
/** The bundled registry: hand-written selectors plus those generated from the activation facts (ATD-45). */
function bundledSelectors(): Selector[] {
  return [...selectorFile(join(packageRoot, "selectors/default.yaml")), ...selectorFile(join(packageRoot, "selectors/generated.yaml"))];
}
export function loadConfig(cwd: string, profile?: StructureProfile): { sources: SourceSpec[]; selectors: Selector[]; profile: StructureProfile } {
  const configPath = resolve(cwd, "atdd-pi.yaml");
  const defaults = bundledSources();
  const defaultSelectors = join(packageRoot, "selectors/default.yaml");
  if (!existsSync(configPath)) {
    const prof = profile ?? profileByName(DEFAULT_PROFILE);
    return { sources: defaults, selectors: expandRoleSelectors(bundledSelectors(), prof), profile: prof };
  }
  const cfg = readYaml(configPath);
  if (cfg.schema !== "pi-atdd/config/v2") throw new GraphError("invalid atdd-pi.yaml schema (expected v2)");
  // Explicit 'sources' is supported for controlled source parity tests; regular
  // consumers use the embedded catalog plus optional extraSources.
  if (cfg.sources !== undefined && !Array.isArray(cfg.sources))
    throw new GraphError("sources must be an array");
  if (cfg.extraSources !== undefined && !Array.isArray(cfg.extraSources))
    throw new GraphError("extraSources must be an array");
  const sources: SourceSpec[] = [
    ...((cfg.sources as SourceSpec[] | undefined) ?? defaults),
    ...((cfg.extraSources as SourceSpec[] | undefined) ?? []),
  ];
  const localSelectorPath = cfg.selectors;
  if (localSelectorPath !== undefined && typeof localSelectorPath !== "string")
    throw new GraphError("selectors must be a local path");
  const selectorPath = localSelectorPath === undefined ? defaultSelectors : resolve(cwd, localSelectorPath);
  if (localSelectorPath !== undefined && (
      isAbsolute(localSelectorPath) || relative(cwd, selectorPath) === ".."
      || relative(cwd, selectorPath).startsWith("../")))
    throw new GraphError("selector path outside project");
  const selectors = localSelectorPath === undefined ? bundledSelectors() : selectorFile(selectorPath);
  if (cfg.extraSelectors !== undefined) {
    if (!Array.isArray(cfg.extraSelectors) || !cfg.extraSelectors.every(x => typeof x === "string"))
      throw new GraphError("extraSelectors must be local path strings");
    for (const file of cfg.extraSelectors) {
      const path = resolve(cwd, file);
      if (isAbsolute(file) || relative(cwd, path) === ".." || relative(cwd, path).startsWith("../"))
        throw new GraphError("extra selector path outside project");
      selectors.push(...selectorFile(path));
    }
  }
  // Structure profile: argument, else atdd-pi.yaml `profile:` (a bundled stack name or a project-local .json path), else ATDD-Bun.
  let prof = profile;
  if (!prof) {
    const name = cfg.profile;
    if (name !== undefined && typeof name !== "string") throw new GraphError("profile must be a stack name or a local path");
    if (typeof name === "string" && name.endsWith(".json")) {
      const pp = resolve(cwd, name);
      if (isAbsolute(name) || relative(cwd, pp).startsWith("..")) throw new GraphError("profile path outside project");
      prof = loadProfile(pp);
    } else prof = profileByName(name ?? DEFAULT_PROFILE);
  }
  return { sources, selectors: expandRoleSelectors(selectors, prof), profile: prof };
}
