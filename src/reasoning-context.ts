/**
 * ATDD rule activation as typed, observed context facts.
 *
 * Canonical relationships remain unchanged: only mandatory "requires" means
 * prerequisite; no inferred Flow↔Bun edges. Legacy text/path selectors emit
 * explicit evidence facts rather than acting as an undocumented oracle.
 */
import { DEFAULT_PROFILE, profileByName, roleOfPath, type StructureProfile } from "./profile.ts";
import { canonicalRuleId, matchesGlob, termMatches, validateSelectors, type Catalog, type Convention, type Relation, type Selector, type QualifiedExternalEdge } from "./catalog.ts";
import { PositiveReasoner, groundKey, type Fact, type Proof, type Rule, type Delta } from "./inference.ts";
import { discoverSourceEvidence } from "./structural-evidence.ts";

export type Phase = "RED" | "GREEN" | "REFACTOR" | "SMOKE";
export type Operation = "task" | "create" | "edit" | "review";
export type Origin = "pi-event" | "repository-observation" | "trusted-work-provider";
export type ContextObservation = {
  scope: string; task: string; operation: Operation;
  path?: string; sourceText?: string; phase?: Phase; revision?: string;
  actorRole?: string; acceptance?: string;
  origin: Origin; provenance: string;
};
export type Activation = {
  id: string; convention: Convention; proof: Proof;
  reasons: string[]; requiredPath: Relation[];
};
export type Gap = { missingId: string; proof: Proof; external?: QualifiedExternalEdge };
export type Reconciliation = {
  status: "matched" | "unknown" | "incomplete";
  scope: string;
  activations: Activation[]; gaps: Gap[];
  added: string[]; removed: string[]; changed: string[];
  unknownFacts: string[];
  unresolvedGraphEdges: Relation[];
  provenance: Catalog["provenance"];
  stats: { scans: number; supports: number; affected: number; materialized: number };
};

const selectorRules: Rule[] = [
  {
    id: "pi-atdd.match-selector",
    source: "pi-atdd/adapters/selectors-v1",
    head: { predicate: "active", terms: ["?subject", "?rule"] },
    body: [
      { predicate: "selector_hit", terms: ["?subject", "?selector"] },
      { predicate: "selector_rule", terms: ["?selector", "?rule"] },
    ],
  },
  {
    id: "pi-atdd.mandatory-prerequisites",
    source: "pi-atdd/bridge/typed-bun-relationships",
    head: { predicate: "active", terms: ["?subject", "?dependency"] },
    body: [
      { predicate: "active", terms: ["?subject", "?rule"] },
      { predicate: "requires", terms: ["?rule", "?dependency"] },
    ],
  },
  {
    id: "pi-atdd.unresolved-mandatory-dependency",
    source: "pi-atdd/bridge/typed-bun-relationships",
    head: { predicate: "missing_requirement", terms: ["?subject", "?missing"] },
    body: [
      { predicate: "active", terms: ["?subject", "?rule"] },
      { predicate: "requires_missing", terms: ["?rule", "?missing"] },
    ],
  },
];
/** These are explicitly adapter-authored applicability rules, not new canonical relationships. */
function typedRules(catalog: Catalog): Rule[] {
  const typed: Rule[] = [];
  if (catalog.rules.has("coder.architecture.hierarchy-import")) typed.push({
    id: "pi-atdd.typed-domain-dependency-flow",
    source: "pi-atdd/adapters/typed-path-facts-v1",
    head: { predicate: "active", terms: ["?subject", "coder.architecture.hierarchy-import"] },
    body: [
      { predicate: "file_layer", terms: ["?subject", "domain"] },
      { predicate: "operation", terms: ["?subject", "edit"] },
    ],
  });
  if (catalog.rules.has("coder.phase.discipline")) typed.push({
    id: "pi-atdd.typed-green-phase-discipline",
    source: "pi-atdd/adapters/trusted-phase-facts-v1",
    head: { predicate: "active", terms: ["?subject", "coder.phase.discipline"] },
    body: [
      { predicate: "phase", terms: ["?subject", "GREEN"] },
      { predicate: "operation", terms: ["?subject", "edit"] },
    ],
  });
  for (const operation of ["edit", "create"] as const) {
    if (catalog.rules.has("coder.security.missing-auth")) typed.push({
      id: "pi-atdd.typed-bun-mutating-route-" + operation,
      source: "pi-atdd/adapters/structural-evidence-v1",
      head: { predicate: "active", terms: ["?subject", "coder.security.missing-auth"] },
      body: [
        { predicate: "code_construct", terms: ["?subject", "bun_mutating_route"] },
        { predicate: "operation", terms: ["?subject", operation] },
      ],
    });
    if (catalog.rules.has("tester.acceptance.binding-declared")) typed.push({
      id: "pi-atdd.typed-test-urn-" + operation,
      source: "pi-atdd/adapters/structural-evidence-v1",
      head: { predicate: "active", terms: ["?subject", "tester.acceptance.binding-declared"] },
      body: [
        { predicate: "code_construct", terms: ["?subject", "test_urn_header"] },
        { predicate: "operation", terms: ["?subject", operation] },
      ],
    });
  }
  return typed;
}
function collectReasons(proof: Proof): string[] {
  const reasons = new Set<string>();
  const visit = (p: Proof): void => {
    for (const a of p.assertions) {
      if (a.provenance) reasons.add(a.provenance);
      else reasons.add(a.source);
    }
    for (const d of p.derivations) {
      reasons.add(d.rule + " @ " + d.source);
      d.premises.forEach(visit);
    }
  };
  visit(proof);
  return [...reasons].sort();
}
function linkedEdges(proof: Proof, graph: Catalog): Relation[] {
  const pairs = new Set<string>();
  const visit = (p: Proof): void => {
    for (const d of p.derivations) {
      if (d.rule === "pi-atdd.mandatory-prerequisites") {
        const edgePremise = d.premises.find(x => x.fact.predicate === "requires");
        if (edgePremise) pairs.add(groundKey("requires", edgePremise.fact.args));
      }
      d.premises.forEach(visit);
    }
  };
  visit(proof);
  return graph.edges.filter(e => e.type === "requires" && e.constraint === "mandatory"
    && pairs.has(groundKey("requires", [e.source, e.target])));
}
function fact(id: string, predicate: string, args: string[], source: string, provenance: string): Fact {
  return { id, predicate, args, source, provenance };
}

export class ReasoningSession {
  readonly engine: PositiveReasoner;
  private readonly observations = new Map<string, Map<string, Fact>>();
  private readonly catalog: Catalog;
  private readonly selectors: Selector[];
  private readonly profile: StructureProfile;
  constructor(catalog: Catalog, selectors: Selector[], profile: StructureProfile = profileByName(DEFAULT_PROFILE)) {
    this.profile = profile;
    validateSelectors(catalog,selectors);
    this.catalog = catalog; this.selectors = selectors;
    this.engine = new PositiveReasoner([...selectorRules, ...typedRules(catalog)]);
    for (const selector of selectors) {
      for (const ruleId of selector.rules.map(r => canonicalRuleId(catalog, r))) {
        if (!catalog.rules.has(ruleId)) throw new Error("selector references unknown convention " + ruleId);
        this.engine.assert(fact("selector:" + selector.id + ":" + ruleId, "selector_rule",
          [selector.id, ruleId], "pi-atdd/selector-registry", selector.id));
      }
    }
    catalog.edges.forEach((edge, i) => {
      if (edge.type !== "requires" || edge.constraint !== "mandatory") return;
      if (!catalog.rules.has(edge.source)) return;
      const predicate = catalog.rules.has(edge.target) ? "requires" : "requires_missing";
      this.engine.assert(fact("relationship:" + i, predicate, [edge.source, edge.target],
        edge.sourceFile, edge.reason || edge.sourceFile));
    });
  }

  private inputs(ob: ContextObservation): Map<string, Fact> {
    if (!ob.scope || !ob.provenance || !ob.task || !["task","create","edit","review"].includes(ob.operation))
      throw new Error("observation requires stable scope, task, provenance and valid operation");
    if (!["pi-event", "repository-observation", "trusted-work-provider"].includes(ob.origin))
      throw new Error("unsupported observation provenance");
    if (ob.sourceText !== undefined && (!ob.path || typeof ob.sourceText !== "string"))
      throw new Error("source evidence requires an observed file path");
    if (ob.origin !== "trusted-work-provider" && (ob.actorRole !== undefined || ob.phase !== undefined || ob.acceptance !== undefined))
      throw new Error("authority, phase and acceptance require trusted provider evidence");
    const entries = new Map<string, Fact>();
    const add = (predicate: string, args: string[], detail = ob.provenance) => {
      const id = ob.scope + ":" + groundKey(predicate, args);
      entries.set(id, fact(id, predicate, args, ob.origin, detail));
    };
    add("task", [ob.scope, ob.task.slice(0, 1000)]);
    add("operation", [ob.scope, ob.operation]);
    if (ob.path) {
      add("file", [ob.scope, ob.path], "path:" + ob.path + " observed by " + ob.provenance);
      const layer = roleOfPath(this.profile, ob.path); // role-level fact: the stack's local layer names never reach the rules
      if (layer) add("file_layer", [ob.scope, layer], "layer:" + layer + " from " + ob.path);
      if (ob.sourceText !== undefined) {
        for (const construct of discoverSourceEvidence(ob.path, ob.sourceText))
          add("code_construct", [ob.scope, construct], "ast:" + construct + " @ " + ob.provenance);
      }
    }
    if (ob.phase) add("phase", [ob.scope, ob.phase]);
    if (ob.actorRole) add("actor_role", [ob.scope, ob.actorRole]);
    if (ob.acceptance) add("acceptance", [ob.scope, ob.acceptance]);
    if (ob.revision) add("revision", [ob.scope, ob.revision], "revision:" + ob.revision);

    for (const selector of this.selectors) {
      if (selector.operations?.length && !selector.operations.includes(ob.operation)) continue;
      const matches = [
        ...(selector.terms ?? []).filter(term => termMatches(ob.task, term))
          .map(term => "term:" + term),
        ...(ob.path ? (selector.paths ?? []).filter(pattern => matchesGlob(ob.path!, pattern))
          .map(pattern => "path:" + pattern) : []),
        ...(selector.always ? ["always"] : []),
      ];
      for (const evidence of matches) {
        const id = ob.scope + ":selector:" + selector.id + ":" + evidence;
        entries.set(id, fact(id, "selector_hit", [ob.scope, selector.id],
          "pi-atdd/selector-registry", evidence + " @ " + ob.provenance));
      }
    }
    return entries;
  }

  observe(ob: ContextObservation): Reconciliation {
    const before = this.current(ob.scope);
    const wanted = this.inputs(ob), existing = this.observations.get(ob.scope) ?? new Map();
    const mergedStats = { scans: 0, supports: 0, affected: 0 };
    const tally = (delta: Delta) => {
      mergedStats.scans += delta.scans;
      mergedStats.supports += delta.supports;
      mergedStats.affected += delta.affected;
    };
    for (const [id, old] of existing) {
      if (JSON.stringify(old) !== JSON.stringify(wanted.get(id))) tally(this.engine.retract(id));
    }
    for (const [id, next] of wanted) {
      if (JSON.stringify(existing.get(id)) !== JSON.stringify(next)) tally(this.engine.assert(next));
    }
    this.observations.set(ob.scope, wanted);
    const after = this.current(ob.scope);
    const added = [...after.keys()].filter(key => !before.has(key)).sort();
    const removed = [...before.keys()].filter(key => !after.has(key)).sort();
    const changed = [...after.keys()].filter(key => before.has(key)
      && JSON.stringify(after.get(key)) !== JSON.stringify(before.get(key))).sort();
    const activations = [...after.keys()].sort().map(id => {
      const query = this.engine.query("active", [ob.scope, id]);
      const proof = query.proof!;
      return { id, convention: this.catalog.rules.get(id)!, proof,
        reasons: collectReasons(proof), requiredPath: linkedEdges(proof, this.catalog) };
    });
    const gaps = this.engine.facts("missing_requirement")
      .filter(item => item.args[0] === ob.scope)
      .map(item => ({ missingId: item.args[1]!,
        proof: this.engine.query("missing_requirement", item.args).proof!,
        external: this.catalog.externalEdges.find(edge => edge.target === item.args[1]
          && this.engine.facts("active").some(f => f.args[0] === ob.scope && f.args[1] === edge.source)),
      }));
    const unknownFacts = ["phase", "actor_role", "acceptance", "revision"].filter(name =>
      this.engine.facts(name).every(item => item.args[0] !== ob.scope));
    return {
      status: gaps.length ? "incomplete" : activations.length ? "matched" : "unknown",
      scope: ob.scope, activations, gaps, added, removed, changed,
      unknownFacts, unresolvedGraphEdges: [...this.catalog.unresolvedEdges, ...this.catalog.externalEdges],
      provenance: this.catalog.provenance,
      stats: { ...mergedStats, materialized: this.engine.materializedCount },
    };
  }
  /** Removing a task or subject revokes every observed fact and its descendants. */
  retractScope(scope: string): Reconciliation["removed"] {
    const before = this.current(scope);
    for (const id of this.observations.get(scope)?.keys() ?? []) this.engine.retract(id);
    this.observations.delete(scope);
    return [...before.keys()].sort();
  }
  private current(scope: string): Map<string, string> {
    const found = new Map<string, string>();
    for (const ground of this.engine.facts("active")) {
      if (ground.args[0] !== scope) continue;
      const query = this.engine.query("active", ground.args);
      found.set(ground.args[1]!, JSON.stringify(query.proof));
    }
    return found;
  }
}
