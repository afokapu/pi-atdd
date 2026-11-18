import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseDocument } from "yaml";

export class GraphError extends Error {}
export type SourceKind = "bun" | "flow";
export type SourceSpec = { id: string; path: string; kind: SourceKind; sha256: string; revision?: string };
export type Convention = {
  id: string; file: string; source: string; statement: string; kind: string;
  disposition: string | null; exceptions: string[]; summary: string; guidance: string;
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
  unresolvedReferences: Relation[]; note: string;
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
  if (kind === "bun") {
    const graph = join(root, "relationships.yaml");
    if (!existsSync(graph)) throw new GraphError("missing Bun relationship graph: " + graph);
    files.push(graph);
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
    if (!src.id || !src.path || !["bun", "flow"].includes(src.kind))
      throw new GraphError("source needs id/path and kind bun|flow");
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
      const metadata = obj(yaml.metadata), content = obj(yaml.content), disposition = metadata.disposition ?? null;
      if (disposition !== null && !dispositions.has(String(disposition))) throw new GraphError("unknown disposition " + String(disposition));
      const exceptions = yaml.exceptions ?? content.exceptions ?? [];
      if (!Array.isArray(exceptions) || !exceptions.every(e => typeof e === "string")) throw new GraphError(file + ": invalid exceptions");
      const rel = relative(root, file).replaceAll("\\", "/");
      rules.set(id, {
        id, file: src.id + "/" + rel, source: src.id, statement: str(yaml.statement),
        kind: str(yaml.kind) || "rule", disposition: disposition === null ? null : String(disposition),
        exceptions, summary: str(content.summary), guidance: str(content.fix_hint) || str(content.canonical_policy) || str(content.normative_text),
      });
      localIds.add(id);
    }
    if (src.kind !== "bun") continue;
    const path = join(root, "relationships.yaml");
    const graph = readYaml(path), nodes = graph.nodes, relations = graph.edges;
    if (!Array.isArray(nodes) || !nodes.every(n => typeof n === "string") || new Set(nodes).size !== nodes.length)
      throw new GraphError(path + ": invalid node registry");
    if (nodes.length !== localIds.size || nodes.some(n => !localIds.has(n)))
      throw new GraphError(path + ": registry does not match shipped Bun convention nodes");
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
function matchesGlob(file: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^$`{}()|[\]\\]/g, "\\$&");
  const regex = "^" + escaped.replaceAll("**/", "(?:.*/)?").replaceAll("**", ".*").replaceAll("*", "[^/]*").replaceAll("?", ".") + "$";
  return new RegExp(regex).test(file.replaceAll("\\", "/"));
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
      ...(item.terms || []).filter(term => task.toLowerCase().includes(term.toLowerCase())).map(t => "term:" + t),
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
    rules: matchingIds.slice(0, limit).map(id => ({ ...catalog.rules.get(id)!, reasons: [...reasons.get(id)!].sort() })),
    note: matchingIds.length
      ? "Context is guidance, not proof of compliance; validate required checks independently."
      : "Unresolved applicability is a coverage gap; do not assume there are no obligations.",
  };
}
export function loadConfig(cwd: string): { sources: SourceSpec[]; selectors: Selector[] } {
  const cfg = readYaml(resolve(cwd, "atdd-pi.yaml"));
  if (cfg.schema !== "pi-atdd/config/v2" || !Array.isArray(cfg.sources) || typeof cfg.selectors !== "string")
    throw new GraphError("invalid atdd-pi.yaml schema (expected v2)");
  const selectorsFile = resolve(cwd, cfg.selectors);
  if (isAbsolute(cfg.selectors) || relative(cwd, selectorsFile).startsWith("..")) throw new GraphError("selector path outside project");
  const list = readYaml(selectorsFile);
  if (list.schema !== "pi-atdd/selectors/v1" || !Array.isArray(list.selectors)) throw new GraphError("invalid selectors schema");
  return { sources: cfg.sources as SourceSpec[], selectors: list.selectors as Selector[] };
}
