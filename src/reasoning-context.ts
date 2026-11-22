/**
 * ATDD rule activation as typed, observed context facts.
 *
 * Canonical relationships remain unchanged: only mandatory "requires" means
 * prerequisite; no inferred Flow↔Bun edges. Legacy text/path selectors emit
 * explicit evidence facts rather than acting as an undocumented oracle.
 *
 * This module evaluates applicability, not implementation compliance.
 * A lexical selector may activate a rule even without structural evidence.
 * A missing source, phase, detector result or graph endpoint is not a waiver.
 * Proofs retain their origin so later reviewers can distinguish each support.
 */
import { DEFAULT_PROFILE, profileByName, roleOfPath, type StructureProfile } from "./profile.ts";
import { canonicalRuleId, matchesGlob, termMatches, validateSelectors, type Catalog, type Convention, type Relation, type Selector } from "./catalog.ts";
import { PositiveReasoner, groundKey, type Fact, type Proof, type Rule, type Delta } from "./inference.ts";
import { discoverSourceEvidence } from "./structural-evidence.ts";
import { classifyFileKind, observeDomainImports, sourceSyntaxEvidence } from "./operational-observers.ts";

export type Phase = "RED" | "GREEN" | "REFACTOR" | "SMOKE";
export type Operation = "task" | "create" | "edit" | "review";
export type Origin = "pi-event" | "repository-observation" | "trusted-work-provider" | "detector-result";
/** Only a named, revision-bound detector adapter may submit this structured evidence. */
export type DetectorFinding = {
  code: "domain_to_integration_import";
  detectorId: string; evidenceId: string; file: string; revision: string;
};
export type MissingFact = { fact: string; reason: string };
export type ContextObservation = {
  scope: string; task: string; operation: Operation;
  path?: string; sourceText?: string; priorSourceText?: string;
  phase?: Phase; revision?: string;
  actorRole?: string; acceptance?: string;
  findings?: readonly DetectorFinding[];
  origin: Origin; provenance: string;
};
export type Activation = {
  id: string; convention: Convention; proof: Proof;
  reasons: string[]; requiredPath: Relation[];
};
export type Gap = { missingId: string; proof: Proof };
export type Reconciliation = {
  status: "matched" | "unknown" | "incomplete";
  scope: string;
  activations: Activation[]; gaps: Gap[];
  added: string[]; removed: string[]; changed: string[];
  unknownFacts: string[]; missingReasons: MissingFact[];
  /** In-memory evidence only; NEVER persist task/path-bearing proofs to sanitized telemetry. */
  observedFacts: Fact[];
  unresolvedGraphEdges: Relation[];
  provenance: Catalog["provenance"];
  stats: { scans: number; supports: number; affected: number; materialized: number };
};

// Selector hits are separate inputs; they remain visible even when they
// over-activate due to negated task language or broad path matching.
// No selector result grants permission or discharges the canonical rule.
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
/** These are explicitly adapter-authored applicability rules, not new canonical relationships.
 * Structural facts may supply an independent support alongside legacy selectors.
 * A path-only domain edit does not prove a new forbidden import was observed.
 * Rules are installed only when the referenced canonical ID exists in the catalog.
 */
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
  // The historical path+operation rule above remains for compatibility. It is
  // NOT evidence that an import was added. Structural supports are separate.
  for (const operation of ["edit", "create"] as const) {
    if (catalog.rules.has("coder.architecture.hierarchy-import")) {
      typed.push({
        id: "pi-atdd.typed-domain-integration-change-" + operation,
        source: "pi-atdd/adapters/observed-source-delta-v1",
        head: { predicate: "active", terms: ["?subject", "coder.architecture.hierarchy-import"] },
        body: [
          { predicate: "change", terms: ["?subject", "domain_to_integration_import_added"] },
          { predicate: "operation", terms: ["?subject", operation] },
        ],
      }, {
        id: "pi-atdd.typed-domain-integration-present-" + operation,
        source: "pi-atdd/adapters/observed-source-delta-v1",
        head: { predicate: "active", terms: ["?subject", "coder.architecture.hierarchy-import"] },
        body: [
          { predicate: "code_construct", terms: ["?subject", "domain_to_integration_import"] },
          { predicate: "operation", terms: ["?subject", operation] },
        ],
      });
    }
  }
  if (catalog.rules.has("coder.architecture.hierarchy-import")) typed.push({
    id: "pi-atdd.typed-detector-architecture-review",
    source: "pi-atdd/adapters/detector-finding-v1",
    head: { predicate: "active", terms: ["?subject", "coder.architecture.hierarchy-import"] },
    body: [
      { predicate: "finding", terms: ["?subject", "domain_to_integration_import"] },
      { predicate: "operation", terms: ["?subject", "review"] },
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
// Reasons are collected from the complete derivation tree, not merely the
// final rule head. Multiple independent observations must remain inspectable.
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
// Only an actually traversed, authored mandatory requires edge is a dependency.
// Potential Driver influence, advisory relationships and unobserved graph
// edges must not be silently promoted into a mandatory prerequisite.
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

// Each subject's input fact set is replaced on observation, so changing a
// file or losing a detector result retracts its obsolete proof contributions.
// Catalog relationships and selector definitions remain stable base facts.
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

  // Origin is a trust boundary: a Pi event cannot assert a provider phase,
  // and an ordinary tool output cannot fabricate a detector finding.
  // A revision-bearing fact is useful only when its origin is also explicit.
  private inputs(ob: ContextObservation): { entries: Map<string, Fact>; missingReasons: MissingFact[] } {
    if (!ob.scope || !ob.provenance || !ob.task || !["task","create","edit","review"].includes(ob.operation))
      throw new Error("observation requires stable scope, task, provenance and valid operation");
    if (!["pi-event", "repository-observation", "trusted-work-provider", "detector-result"].includes(ob.origin))
      throw new Error("unsupported observation provenance");
    if (ob.sourceText !== undefined && (!ob.path || typeof ob.sourceText !== "string"))
      throw new Error("source evidence requires an observed file path");
    if (ob.priorSourceText !== undefined &&
      (!ob.path || ob.sourceText === undefined || typeof ob.priorSourceText !== "string"))
      throw new Error("source delta requires an observed before/after pair");
    if (ob.origin !== "trusted-work-provider" &&
      (ob.actorRole !== undefined || ob.phase !== undefined || ob.acceptance !== undefined))
      throw new Error("authority, phase and acceptance require trusted provider evidence");
    if (ob.phase && !["RED", "GREEN", "REFACTOR", "SMOKE"].includes(ob.phase))
      throw new Error("unrecognized provider phase");
    if (ob.origin === "trusted-work-provider" && (ob.actorRole || ob.phase || ob.acceptance) && !ob.revision)
      throw new Error("trusted provider assertions require a pinned revision");
    if (ob.findings !== undefined && ob.origin !== "detector-result")
      throw new Error("detector findings require explicit detector-result provenance");
    if (ob.origin === "detector-result" && (ob.operation !== "review" || !ob.revision || !ob.findings?.length || ob.sourceText !== undefined))
      throw new Error("detector results require a revision-bound review observation");
    const entries = new Map<string, Fact>();
    const missingReasons: MissingFact[] = [];
    const missing = (fact: string, reason: string) => {
      if (!missingReasons.some(x => x.fact === fact && x.reason === reason))
        missingReasons.push({ fact, reason });
    };
    // Stable IDs within a scope permit idempotent re-observation and
    // precise retraction instead of accumulating duplicate assertions.
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
      const kind = classifyFileKind(ob.path, ob.sourceText);
      if (kind.status === "observed")
        add("file_kind", [ob.scope, kind.kind], "file_kind:" + kind.basis + " @ " + ob.provenance);
      else missing("file_kind", kind.reason);
      if (ob.origin !== "detector-result") {
        if (kind.status === "observed" && !["generated", "vendor", "declaration"].includes(kind.kind)) {
          const syntax = sourceSyntaxEvidence(ob.path, ob.sourceText);
          if (syntax.status === "unknown") missing("code_construct", syntax.reason);
          else for (const construct of discoverSourceEvidence(ob.path, ob.sourceText!))
            add("code_construct", [ob.scope, construct], "ast:" + construct + " @ " + ob.provenance);
        }
        const imports = observeDomainImports(ob.path, ob.sourceText, ob.priorSourceText);
        if (imports.present) add("code_construct", [ob.scope, "domain_to_integration_import"],
          "ast:domain_to_integration_import @ " + ob.provenance);
        if (imports.added) add("change", [ob.scope, "domain_to_integration_import_added"],
          "before_after:domain_to_integration_import_added @ " + ob.provenance);
        // An inspected file with an unresolved dependency form is missing a
        // trustworthy change fact, not the source text we already read.
        const missingSource = new Set([
          "invalid_path", "unsupported_file_kind", "proposed_source_unavailable",
          "partial_source_parse", "source_too_large",
        ]);
        for (const reason of imports.unknownReasons)
          missing(missingSource.has(reason) ? "source" : "change", reason);
        if (!imports.deltaObserved && !imports.unknownReasons.length) missing("change", "delta_not_observable");
      }
    } else if (ob.operation === "edit" || ob.operation === "create") {
      missing("file_kind", "path_unavailable");
      missing("change", "target_unavailable");
    }
    if (ob.findings) {
      const safeId = /^[a-z][a-z0-9._:-]{0,127}$/i;
      for (const finding of ob.findings) {
        if (finding.code !== "domain_to_integration_import" ||
            !safeId.test(finding.detectorId) || !safeId.test(finding.evidenceId) ||
            finding.file !== ob.path || finding.revision !== ob.revision)
          throw new Error("unverified or mismatched detector finding");
        // Independent detectors asserting the same ground finding retain distinct
        // assertion identities; losing one proof must not revoke the other.
        const evidenceKey = ob.scope + ":finding:" + finding.detectorId + ":" + finding.evidenceId;
        entries.set(evidenceKey, fact(evidenceKey, "finding", [ob.scope, finding.code],
          ob.origin, "detector:" + finding.detectorId + "/evidence:" + finding.evidenceId +
          " @ revision:" + finding.revision));
      }
    } else if (ob.operation === "review") missing("finding", "detector_result_unavailable");
    if (ob.phase) add("phase", [ob.scope, ob.phase]);
    if (ob.actorRole) add("actor_role", [ob.scope, ob.actorRole]);
    if (ob.acceptance) add("acceptance", [ob.scope, ob.acceptance]);
    if (ob.revision) add("revision", [ob.scope, ob.revision], "revision:" + ob.revision);

    // Preserve the legacy lexical evidence explicitly; a keyword match is
    // not equivalent to AST, before/after, provider or detector observation.
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
    return { entries, missingReasons };
  }

  observe(ob: ContextObservation): Reconciliation {
    // Reconcile source facts first, then compare proof signatures. Losing one
    // support changes an explanation even if another still activates the rule.
    const before = this.current(ob.scope);
    const { entries: wanted, missingReasons } = this.inputs(ob);
    const existing = this.observations.get(ob.scope) ?? new Map();
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
        proof: this.engine.query("missing_requirement", item.args).proof! }));
    // An activated rule and an unknown fact may coexist: "matched" must
    // never be interpreted as full observation or a compliance verdict.
    const unknownFacts = [...new Set([
      ...["phase", "actor_role", "acceptance", "revision"].filter(name =>
        this.engine.facts(name).every(item => item.args[0] !== ob.scope)),
      ...missingReasons.map(x => x.fact),
    ])].sort();
    return {
      status: gaps.length ? "incomplete" : activations.length ? "matched" : "unknown",
      scope: ob.scope, activations, gaps, added, removed, changed,
      unknownFacts, missingReasons,
      observedFacts: [...wanted.values()].filter(f =>
        ["change", "file_kind", "code_construct", "finding", "phase", "file_layer"].includes(f.predicate)),
      unresolvedGraphEdges: this.catalog.unresolvedEdges,
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
