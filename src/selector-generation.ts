// ATD-45: activation selectors are derived from the activation facts each neutral convention declares
// (core.activation.facts, observability "observable_now"), not written by hand per feature.
// Delivery tier: rules listed in the policy are delivered at edit, create and review; every other generated rule
// is delivered at review only, so one edit never floods the page budget. Unmappable values are reported, never dropped.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { bundledSources, GraphError, loadCatalog, packageRoot, readYaml, type Selector } from "./catalog.ts";
import { DEFAULT_PROFILE, profileByName, type StructureProfile } from "./profile.ts";

export type FileKindEntry = { name?: string; values: string[]; prefixes?: string[]; paths?: string[]; roles?: string[]; roots?: string[] };
export type Policy = { edit_rules: string[]; edit_kinds?: Record<string, string[]>; profile_observed_kinds: string[]; operations: Record<string, string>; file_kinds: FileKindEntry[] };
export type GenerationReport = {
  /** Rules that declare at least one observable file_kind or role fact. */
  withObservableFileKind: string[];
  notInCatalog: string[];
  noMappableFact: string[];
  /** Rules whose mandatory requires closure reaches a rule missing from the catalog: selecting one would block every matching edit. */
  blockedByUnresolved: string[];
  unmappedValues: Record<string, number>;
  unmappedOperations: Record<string, number>;
  /** Rules whose only observable trigger is task wording; not generated yet, delivered through review judgment. */
  termOnly: string[];
};
const OPERATIONS = ["edit", "create", "review"];

export function loadPolicy(file: string): Policy {
  const p = readYaml(file) as unknown as Policy & { schema?: string };
  if (p.schema !== "pi-atdd/selector-generation/v1") throw new GraphError("invalid selector generation policy: " + file);
  if (!Array.isArray(p.edit_rules) || !Array.isArray(p.file_kinds) || typeof p.operations !== "object")
    throw new GraphError("selector generation policy needs edit_rules, operations and file_kinds");
  return p;
}

function neutralFiles(dir: string): string[] {
  return readdirSync(dir).sort().flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? neutralFiles(path) : name.endsWith(".json") ? [path] : [];
  });
}
const normal = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "_");

type Edge = { source: string; target: string; type: string; constraint?: string };
/** Rules that have, or inherit through mandatory requires, a mandatory dependency the catalog cannot resolve. */
function unresolvedClosure(edges: Edge[], unresolved: Edge[]): Set<string> {
  const mandatory = (e: Edge) => e.type === "requires" && (e.constraint ?? "mandatory") === "mandatory";
  const blocked = new Set(unresolved.filter(mandatory).map(e => e.source));
  for (let changed = true; changed;) {
    changed = false;
    for (const e of edges) if (mandatory(e) && blocked.has(e.target) && !blocked.has(e.source)) { blocked.add(e.source); changed = true; }
  }
  return blocked;
}

export function generateSelectors(opts: { neutralRoot: string; policy: Policy; ruleIds: Set<string>; profile: StructureProfile;
    edges: Edge[]; unresolvedEdges: Edge[] }): { selectors: Selector[]; report: GenerationReport } {
  const { policy } = opts, blocked = unresolvedClosure(opts.edges, opts.unresolvedEdges);
  const report: GenerationReport = { withObservableFileKind: [], notInCatalog: [], noMappableFact: [], blockedByUnresolved: [],
    unmappedValues: {}, unmappedOperations: {}, termOnly: [] };
  const count = (map: Record<string, number>, key: string) => { map[key] = (map[key] ?? 0) + 1; };
  const selectors: Selector[] = [];
  for (const file of neutralFiles(opts.neutralRoot)) {
    const doc = JSON.parse(readFileSync(file, "utf8")) as { rule_id: string; core?: { activation?: { facts?: Array<
      { fact: string; values?: string[]; observability: string }> } } };
    const all = doc.core?.activation?.facts ?? [];
    const id = doc.rule_id, facts = all.filter(f => f.observability === "observable_now");
    // A needs_new_observer file kind the structure profile already observes counts as observable (policy lists which).
    const profileKinds = all.filter(f => f.observability === "needs_new_observer" && f.fact === "file_kind")
      .map(f => ({ ...f, values: (f.values ?? []).filter(v => (policy.profile_observed_kinds ?? []).includes(normal(v))) }))
      .filter(f => f.values.length);
    const kindFacts = [...facts.filter(f => f.fact === "file_kind" || f.fact === "role"), ...profileKinds];
    if (kindFacts.length) report.withObservableFileKind.push(id);
    else if (facts.some(f => f.fact === "task_term")) report.termOnly.push(id);
    if (!opts.ruleIds.has(id)) { if (kindFacts.length) report.notInCatalog.push(id); continue; }
    if (blocked.has(id)) { if (kindFacts.length) report.blockedByUnresolved.push(id); continue; }
    type Acc = { paths: Set<string>; roles: Set<string>; roots: Set<string> };
    const fresh = (): Acc => ({ paths: new Set(), roles: new Set(), roots: new Set() });
    const every = fresh(), byName = new Map<string, Acc>();
    for (const fact of kindFacts) for (const value of fact.values ?? []) {
      const key = normal(value);
      const entry = policy.file_kinds.find(e => e.values.includes(key) || (e.prefixes ?? []).some(p => key.startsWith(p)));
      if (!entry) { count(report.unmappedValues, value.length > 60 ? value.slice(0, 60) : value); continue; }
      const own = byName.get(entry.name ?? "") ?? fresh(); byName.set(entry.name ?? "", own);
      for (const acc of [every, own]) {
        (entry.paths ?? []).forEach(p => acc.paths.add(p));
        (entry.roles ?? []).forEach(r => acc.roles.add(r));
        (entry.roots ?? []).forEach(r => acc.roots.add(r));
      }
    }
    if (!every.paths.size && !every.roles.size && !every.roots.size) { if (kindFacts.length) report.noMappableFact.push(id); continue; }
    const mapped = new Set<string>();
    for (const fact of facts.filter(f => f.fact === "operation")) for (const value of fact.values ?? []) {
      const op = policy.operations[value];
      if (op) mapped.add(op); else count(report.unmappedOperations, value);
    }
    const editTier = policy.edit_rules.includes(id);
    const editOps = OPERATIONS.filter(op => !mapped.size || mapped.has(op) || op === "review");
    // roles and roots stay symbolic: the loader resolves them through the active profile
    const make = (sid: string, operations: string[], acc: Acc): Selector => {
      const selector: Selector = { id: sid, operations, rules: [id] };
      if (acc.paths.size) selector.paths = [...acc.paths].sort();
      if (acc.roles.size) selector.roles = [...acc.roles].sort();
      if (acc.roots.size) selector.roots = [...acc.roots].sort();
      return selector;
    };
    const editKinds = editTier ? policy.edit_kinds?.[id] : undefined;
    if (editKinds) {
      // A rule that names several kinds is delivered at edit only for the kinds listed; the reviewer gets them all.
      const only = fresh();
      for (const name of editKinds) for (const k of ["paths", "roles", "roots"] as const) byName.get(name)?.[k].forEach(v => only[k].add(v));
      const editOnly = editOps.filter(op => op !== "review");
      if (only.paths.size || only.roles.size || only.roots.size) selectors.push(make("gen." + id, editOnly, only));
      selectors.push(make("gen." + id + ".review", ["review"], every));
    } else selectors.push(make("gen." + id, editTier ? editOps : ["review"], every));
  }
  selectors.sort((a, b) => a.id.localeCompare(b.id));
  for (const list of [report.withObservableFileKind, report.notInCatalog, report.noMappableFact, report.blockedByUnresolved, report.termOnly]) list.sort();
  return { selectors, report };
}

export function renderGenerated(selectors: Selector[]): string {
  const body = stringify({ schema: "pi-atdd/selectors/v1", selectors }, { lineWidth: 0 });
  return "# GENERATED by src/selector-generation.ts from conventions-neutral and selectors/generation-policy.yaml.\n" +
    "# Do not edit by hand: run `npm run selectors:generate`. tests/selector-generation.test.ts fails on drift.\n" + body;
}

export function main(): number {
  const catalog = loadCatalog(bundledSources(), packageRoot);
  const { selectors, report } = generateSelectors({ neutralRoot: join(packageRoot, "conventions-neutral"),
    policy: loadPolicy(join(packageRoot, "selectors/generation-policy.yaml")),
    ruleIds: new Set(catalog.rules.keys()), profile: profileByName(DEFAULT_PROFILE),
    edges: catalog.edges, unresolvedEdges: catalog.unresolvedEdges });
  writeFileSync(join(packageRoot, "selectors/generated.yaml"), renderGenerated(selectors));
  console.log(JSON.stringify({ generated: selectors.length, withObservableFileKind: report.withObservableFileKind.length,
    notInCatalog: report.notInCatalog.length, noMappableFact: report.noMappableFact.length, blockedByUnresolved: report.blockedByUnresolved.length, termOnly: report.termOnly.length,
    unmappedValues: report.unmappedValues, unmappedOperations: report.unmappedOperations }, null, 1));
  return 0;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/"))) process.exit(main());
