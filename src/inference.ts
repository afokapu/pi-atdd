/**
 * Finite, positive Datalog-style materialization for ATDD context facts.
 *
 * The engine deliberately rejects negation/function symbols. Facts are unknown
 * when absent, not false. Insertion uses delta-anchored joins; retraction uses
 * dependency-directed over-deletion followed by rederivation of only affected
 * heads, preserving independent supports and eliminating unanchored cycles.
 */
export type Atom = { predicate: string; terms: readonly string[] };
export type Rule = { id: string; head: Atom; body: readonly Atom[]; source: string };
export type Fact = { id: string; predicate: string; args: readonly string[]; source: string; provenance?: string };
export type Ground = { predicate: string; args: string[] };
export type Support = { id: string; rule: string; source: string; premises: readonly string[] };
export type Proof = {
  fact: Ground; key: string; assertions: Array<{ id: string; source: string; provenance?: string }>;
  derivations: Array<{ rule: string; source: string; premises: Proof[] }>;
  cycle?: boolean; truncated?: boolean;
};
export type Delta = {
  added: string[]; removed: string[]; changed: string[];
  scans: number; supports: number; affected: number;
};
type RecordFact = { fact: Ground; assertions: Map<string, Fact>; derivations: Map<string, Support> };
type RuleIndex = { rule: Rule; slot: number };
const predicatePattern = /^[a-z][a-z0-9_]*$/;
const variablePattern = /^\?[A-Za-z_][A-Za-z0-9_]*$/;
const allowedTerm = (term: unknown) => typeof term === "string" && !!term && (!term.startsWith("?") || variablePattern.test(term));
export const groundKey = (predicate: string, args: readonly string[]): string => JSON.stringify([predicate, ...args]);

function validateAtom(atom: Atom, isPattern: boolean): void {
  if (!atom || typeof atom !== "object" || !predicatePattern.test(atom.predicate)
      || !Array.isArray(atom.terms) || !atom.terms.every(allowedTerm)
      || Object.keys(atom).some(k => !["predicate", "terms"].includes(k)))
    throw new Error("unsupported or malformed positive atom: " + JSON.stringify(atom));
  if (!isPattern && atom.terms.some(x => x.startsWith("?"))) throw new Error("ground facts cannot contain variables");
}
function validateRule(rule: Rule): void {
  if (!rule || typeof rule.id !== "string" || !rule.id || typeof rule.source !== "string" || !rule.source
      || !Array.isArray(rule.body) || !rule.body.length || rule.body.length > 12
      || Object.keys(rule).some(k => !["id", "source", "head", "body"].includes(k)))
    throw new Error("rules must have a name, source and a positive, nonempty body");
  validateAtom(rule.head, true);
  const bound = new Set<string>();
  for (const atom of rule.body) {
    validateAtom(atom, true);
    atom.terms.filter(s => s.startsWith("?")).forEach(s => bound.add(s));
  }
  for (const term of rule.head.terms) {
    if (term.startsWith("?") && !bound.has(term)) throw new Error("unsafe unbound head variable: " + term);
  }
}
function unify(pattern: Atom, fact: Ground, original: ReadonlyMap<string, string>): Map<string, string> | null {
  if (pattern.predicate !== fact.predicate || pattern.terms.length !== fact.args.length) return null;
  const binding = new Map(original);
  for (let i = 0; i < pattern.terms.length; i++) {
    const term = pattern.terms[i]!, actual = fact.args[i]!;
    if (!term.startsWith("?")) {
      if (term !== actual) return null;
    } else if (binding.has(term)) {
      if (binding.get(term) !== actual) return null;
    } else {
      binding.set(term, actual);
    }
  }
  return binding;
}
function instantiate(pattern: Atom, binding: ReadonlyMap<string, string>): Ground {
  return {
    predicate: pattern.predicate,
    args: pattern.terms.map(term => term.startsWith("?") ? binding.get(term)! : term),
  };
}

/** No host processes, I/O, model decisions or implicit negation. */
export class PositiveReasoner {
  private readonly rules: Rule[];
  private readonly bodyIndex = new Map<string, RuleIndex[]>();
  private readonly records = new Map<string, RecordFact>();
  private readonly predicateIndex = new Map<string, Set<string>>();
  private readonly reverse = new Map<string, Set<string>>();
  private readonly asserted = new Map<string, Fact>();
  private readonly maxSteps: number;

  constructor(rules: readonly Rule[], maxSteps = 300_000) {
    if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error("invalid reasoning step bound");
    this.maxSteps = maxSteps;
    const ids = new Set<string>();
    for (const rule of rules) {
      validateRule(rule);
      if (ids.has(rule.id)) throw new Error("duplicate inference rule: " + rule.id);
      ids.add(rule.id);
      rule.body.forEach((atom, slot) => {
        const entries = this.bodyIndex.get(atom.predicate) ?? [];
        entries.push({ rule, slot });
        this.bodyIndex.set(atom.predicate, entries);
      });
    }
    this.rules = [...rules];
  }
  private getOrCreate(fact: Ground): { record: RecordFact; created: boolean } {
    const key = groundKey(fact.predicate, fact.args);
    const old = this.records.get(key);
    if (old) return { record: old, created: false };
    const record = { fact, assertions: new Map<string, Fact>(), derivations: new Map<string, Support>() };
    this.records.set(key, record);
    const predicate = this.predicateIndex.get(fact.predicate) ?? new Set<string>();
    predicate.add(key); this.predicateIndex.set(fact.predicate, predicate);
    return { record, created: true };
  }
  private support(fact: Ground, rule: Rule, premises: string[]): { created: boolean; support: boolean } {
    const key = groundKey(fact.predicate, fact.args);
    const { record, created } = this.getOrCreate(fact);
    const id = JSON.stringify([rule.id, ...premises]);
    if (record.derivations.has(id)) return { created, support: false };
    record.derivations.set(id, { id, rule: rule.id, source: rule.source, premises });
    for (const premise of premises) {
      const descendants = this.reverse.get(premise) ?? new Set<string>();
      descendants.add(key); this.reverse.set(premise, descendants);
    }
    return { created, support: true };
  }
  private infer(seeds: string[], onlyHeads?: ReadonlySet<string>): { added: string[]; scans: number; supports: number } {
    const queue = [...new Set(seeds)].sort(), added: string[] = [];
    let scans = 0, supports = 0;
    for (let offset = 0; offset < queue.length; offset++) {
      const anchorKey = queue[offset]!, anchor = this.records.get(anchorKey);
      if (!anchor) continue;
      for (const { rule, slot } of this.bodyIndex.get(anchor.fact.predicate) ?? []) {
        const matched = new Array<string>(rule.body.length);
        matched[slot] = anchorKey;
        const bindings = unify(rule.body[slot]!, anchor.fact, new Map());
        if (!bindings) continue;
        const visit = (position: number, variables: ReadonlyMap<string, string>): void => {
          if (position === rule.body.length) {
            const fact = instantiate(rule.head, variables), key = groundKey(fact.predicate, fact.args);
            if (onlyHeads && !onlyHeads.has(key)) return;
            const result = this.support(fact, rule, matched);
            if (result.support) supports++;
            if (result.created) { queue.push(key); added.push(key); }
            return;
          }
          if (position === slot) { visit(position + 1, variables); return; }
          const pattern = rule.body[position]!;
          for (const key of this.predicateIndex.get(pattern.predicate) ?? []) {
            if (++scans > this.maxSteps) throw new Error("reasoning join bound exceeded (fail closed)");
            const candidate = this.records.get(key)!;
            const bound = unify(pattern, candidate.fact, variables);
            if (bound) { matched[position] = key; visit(position + 1, bound); }
          }
        };
        visit(0, bindings);
      }
    }
    return { added: added.sort(), scans, supports };
  }
  assert(fact: Fact): Delta {
    if (!fact || !fact.id || !fact.source) throw new Error("fact needs stable id and source");
    validateAtom({ predicate: fact.predicate, terms: fact.args }, false);
    if (fact.args.some(x => typeof x !== "string" || !x)) throw new Error("all fact arguments must be nonempty strings");
    const existing = this.asserted.get(fact.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(fact))
        throw new Error("changed fact assertion requires explicit retraction: " + fact.id);
      return { added: [], removed: [], changed: [], scans: 0, supports: 0, affected: 0 };
    }
    this.asserted.set(fact.id, { ...fact, args: [...fact.args] });
    const { record, created } = this.getOrCreate({ predicate: fact.predicate, args: [...fact.args] });
    record.assertions.set(fact.id, fact);
    const delta = created ? this.infer([groundKey(fact.predicate, fact.args)]) : { added: [], scans: 0, supports: 0 };
    return { added: [...(created ? [groundKey(fact.predicate, fact.args)] : []), ...delta.added],
      removed: [], changed: created ? [] : [groundKey(fact.predicate, fact.args)],
      scans: delta.scans, supports: delta.supports, affected: 0 };
  }
  retract(id: string): Delta {
    const fact = this.asserted.get(id);
    if (!fact) return { added: [], removed: [], changed: [], scans: 0, supports: 0, affected: 0 };
    const key = groundKey(fact.predicate, fact.args);
    this.asserted.delete(id);
    const affected = new Set<string>([key]), queue = [key];
    for (let i = 0; i < queue.length; i++) {
      for (const dependent of this.reverse.get(queue[i]!) ?? []) {
        if (!affected.has(dependent)) { affected.add(dependent); queue.push(dependent); }
      }
    }
    // Over-delete *all* affected materializations, including old cyclic
    // supports. Remaining assertions and unaffected derived facts form the
    // surviving, anchored base for local rederivation.
    for (const target of affected) {
      const record = this.records.get(target);
      if (!record) continue;
      for (const support of record.derivations.values()) {
        for (const premise of support.premises) {
          const dependents = this.reverse.get(premise);
          dependents?.delete(target);
          if (dependents?.size === 0) this.reverse.delete(premise);
        }
      }
      this.records.delete(target);
      const group = this.predicateIndex.get(record.fact.predicate);
      group?.delete(target);
      if (group?.size === 0) this.predicateIndex.delete(record.fact.predicate);
      this.reverse.delete(target);
    }
    // Reinsert extensional facts still asserted by another source.
    for (const asserted of this.asserted.values()) {
      const atom = { predicate: asserted.predicate, args: [...asserted.args] };
      if (affected.has(groundKey(atom.predicate, atom.args))) this.getOrCreate(atom).record.assertions.set(asserted.id, asserted);
    }
    const derivation = this.infer([...this.records.keys()], affected);
    const removed = [...affected].filter(k => !this.records.has(k)).sort();
    const changed = [...affected].filter(k => this.records.has(k)).sort();
    return { added: [], removed, changed, scans: derivation.scans, supports: derivation.supports, affected: affected.size };
  }
  facts(predicate?: string): Ground[] {
    return [...this.records.entries()].filter(([, rec]) => !predicate || rec.fact.predicate === predicate)
      .sort(([a], [b]) => a.localeCompare(b)).map(([, rec]) => ({ ...rec.fact, args: [...rec.fact.args] }));
  }
  has(predicate: string, args: readonly string[]): boolean { return this.records.has(groundKey(predicate, args)); }
  /** Absent facts are UNKNOWN, not negated facts. */
  query(predicate: string, args: string[]): { status: "true" | "unknown"; proof?: Proof } {
    const key = groundKey(predicate, args);
    return this.records.has(key) ? { status: "true", proof: this.explainKey(key) } : { status: "unknown" };
  }
  private explainKey(key: string, seen = new Set<string>(), depth = 0): Proof {
    const record = this.records.get(key)!;
    const proof: Proof = {
      fact: { ...record.fact, args: [...record.fact.args] }, key,
      assertions: [...record.assertions.values()].sort((a, b) => a.id.localeCompare(b.id))
        .map(v => ({ id: v.id, source: v.source, ...(v.provenance ? { provenance: v.provenance } : {}) })),
      derivations: [],
    };
    if (seen.has(key)) { proof.cycle = true; return proof; }
    if (depth >= 8) { proof.truncated = true; return proof; }
    const next = new Set(seen); next.add(key);
    const supports = [...record.derivations.values()].sort((a,b) => a.id.localeCompare(b.id));
    if (supports.length > 12) proof.truncated = true;
    proof.derivations = supports.slice(0, 12).map(s => ({
      rule: s.rule, source: s.source,
      premises: s.premises.map(k => this.explainKey(k, next, depth+1)),
    }));
    return proof;
  }
  get assertedCount(): number { return this.asserted.size; }
  get materializedCount(): number { return this.records.size; }
}
