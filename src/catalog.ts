import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

export class GraphError extends Error {}
export type SourceKind = "bun" | "flow" | "extension";
export type SourceSpec = { id: string; path: string; kind: SourceKind; sha256: string; revision?: string };
export type Convention = {
  id: string; file: string; source: string; statement: string; kind: string;
  disposition: string | null; exceptions: string[]; summary: string; guidance: string;
  implementationRef: string | null;
};
export type Relation = {
  source: string; target: string; type: string; constraint: string; control: string;
  reason: string; sourceFile: string;
};
export type Catalog = {
  rules: Map<string, Convention>; edges: Relation[];
  provenance: { id: string; digest: string; revision?: string; path: string }[];
  unresolvedEdges: Relation[];
};
export type Selector = {
  id: string; rules: string[]; operations?: string[];
  paths?: string[]; terms?: string[]; always?: boolean;
};
export type Context = {
  status: "matched" | "unresolved"; rules: Array<Convention & { reasons: string[] }>;
  matchingIds: string[]; truncated: boolean; sourceLocks: Catalog["provenance"];
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

export function loadCatalog(sources: SourceSpec[], cwd: string): Catalog {
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
        implementationRef: str(implementation.ref) || null,
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
  const unresolvedEdges = edges.filter(e => !rules.has(e.source) || !rules.has(e.target));
  return { rules, edges, provenance, unresolvedEdges };
}
const WORD_CHAR = /[a-z0-9_]/;
const TOKEN_TRIM = /^[\s()[\]{}"'`,;:<>]+|[\s()[\]{}"'`,;:<>.?!]+$/g;
/** A whitespace-delimited token that names a file or directory path, not prose. */
function isPathToken(token: string): boolean {
  const t = token.replace(TOKEN_TRIM, "");
  if (!t.includes("/") && !/\.[a-z0-9]{1,5}$/.test(t)) return false;
  return /^(?:\.{1,2}\/|\/|~\/)/.test(t)              // ./x, ../x, /abs, ~/x
    || /\/[^/\s]*\.[a-z0-9]{1,5}$/.test(t)            // dir/file.ext
    || /^[^/\s]+\.[a-z0-9]{1,5}$/.test(t) && /[a-z]/.test(t.split(".").pop()!) // file.ext
    || (t.endsWith("/") && t.slice(0, -1).includes("/")); // a/b/ (directory)
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
      if (!catalog.rules.has(rule)) throw new GraphError(item.id + ": unknown rule " + rule);
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
    paths: string[], operation = "task", limit = 12): Context {
  validateSelectors(catalog, selectors);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new GraphError("invalid limit");
  const reasons = new Map<string, Set<string>>(), selected = new Set<string>();
  for (const item of selectors) {
    if (item.operations?.length && !item.operations.includes(operation)) continue;
    const evidence = [
      ...paths.flatMap(path => (item.paths || []).filter(pattern => matchesGlob(path, pattern)).map(p => "path:" + p)),
      ...(item.terms || []).filter(term => termMatches(task, term)).map(t => "term:" + t),
      ...(item.always ? ["always"] : []),
    ];
    if (!evidence.length) continue;
    for (const id of item.rules) {
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
    matchingIds, truncated: matchingIds.length > limit, sourceLocks: catalog.provenance,
    unresolvedReferences: catalog.unresolvedEdges,
    relatedRelations: catalog.edges.filter(edge => selected.has(edge.source) && selected.has(edge.target)),
    rules: matchingIds.slice(0, limit).map(id => ({ ...catalog.rules.get(id)!, reasons: [...reasons.get(id)!].sort() })),
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
      sha256: "b48f2ff3353d3455e05c49feb0a04e8e778c70ba2b929787f696bbd6ec6d561a" },
    { id: "ATDD-Flow", path: join(packageRoot, "vendor/atdd-flow"), kind: "flow",
      revision: "2a66019a5ecf2b7a9f999ebfa04d04c9f548f19a",
      sha256: "0571b25f78330f68673916cfb810cd1f93c4f2296bd6019936d5d5a7db46e4e0" },
  ];
}
function selectorFile(file: string): Selector[] {
  const data = readYaml(file);
  if (data.schema !== "pi-atdd/selectors/v1" || !Array.isArray(data.selectors))
    throw new GraphError("invalid selectors schema: " + file);
  return data.selectors as Selector[];
}
export function loadConfig(cwd: string): { sources: SourceSpec[]; selectors: Selector[] } {
  const configPath = resolve(cwd, "atdd-pi.yaml");
  const defaults = bundledSources();
  const defaultSelectors = join(packageRoot, "selectors/default.yaml");
  if (!existsSync(configPath)) {
    return { sources: defaults, selectors: selectorFile(defaultSelectors) };
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
  const selectors = selectorFile(selectorPath);
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
  return { sources, selectors };
}
