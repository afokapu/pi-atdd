# ATD-40 — provisional ATDD T9 governance / realization handoff contract

**Version:** `atdd-ooc-governance-handoff/0.1.0-draft`, **research-only, not a public schema or SDK**. **Status:** proposed, not approved; no T9 resolver implementation or Pi runtime authority. **Responsibility:** Stream A evidence and interface hypotheses for [ATD-39](https://linear.app/af8/issue/ATD-39) and [ATD-41](https://linear.app/af8/issue/ATD-41). Source corpus, rule graph and Pi reasoner remain authoritative *for their own original meanings*, not for candidate OoC admission.

Frozen repository: [`afokapu/pi-atdd@54edcf0`](https://github.com/afokapu/pi-atdd/tree/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85); Bun / Flow / local SHA256 pins are in [`vendor/catalog.lock.json`](https://github.com/afokapu/pi-atdd/blob/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85/vendor/catalog.lock.json). See [Pass A evidence](./ATD-40-PASS-A-EVIDENCE.md) and [376-row source ledger](./ATD-40-PASS-A-LEDGER.tsv). **Only 13 files have proposed candidate lenses; 362 source files remain semantically unresolved.** No admitted engineering OoC identity or approved Change Realization Contract can be resolved from this packet.

## 1. Question and authority boundary

For a **provider-declared desired Change Path** and independently observed facts about a specific Resource and Situation, which **existing source-authored convention nodes** are applicable, by what evidence-bound predicate, and which **authored mandatory `requires` dependencies** follow? A result resolves *governing rules* only. It does not authorize or execute an Action, admit an OoC, infer a desired change from agent prose, prove compliance, predict causal impact, or fabricate any new ATDD/T9 semantics.

- **Authorization authority** belongs to a separately identified provider/owner and applicable capability; Stream B's source facts cannot create it.
- **OoC admission authority** remains with independent Pass B (ATD-28) and Pass C (ATD-27) plus owner; a local `C-xx` label has `CANDIDATE` standing only.
- **Convention content, normative edge and constraints** stay authored in current Bun / Flow / local sources. No fifth Decision OS graph verb, eighth-plus node kind, auto-generated normative edge or unconditional interpretation of workflow links.
- **Driver influence** is a distinct, potentially qualified OoC→OoC *research* family. It is not an ATDD `requires` edge and not evidence of an observed effect. No direct control path is presumed for any candidate.
- **Realization contract** is a separate provider-governed versioned **hypothesis**: one admitted target may have zero executable forms, and an independently feasible *lever* (if a qualified Driver path exists) must be matched under its own Resource, Capability, authority and Situation rather than inheriting target rights.

## 2. Minimal field/provenance handshake — versioned draft types

The following TypeScript is illustrative notation for a handoff test oracle; **do not publish as executable schema, modify existing Pi types, or use it to authorize actions**.

~~~ts
type SourcePin = {
  repo: "afokapu/pi-atdd";
  commit: string;             // frozen observed commit
  sourceDigest: string;       // SHA256 from vendor/catalog.lock.json
  path: string;                // exact file/graph/selector path
  lines?: [number, number];   // when excerpt inspected
  authoredId?: string;        // e.g., convention rule_id; never inferred OoC id
};
type EvidenceStanding = "SOURCE_VERIFIED" | "PROPOSED" | "UNRESOLVED";
type IdentityStanding =
  | { kind: "CANDIDATE"; localLabel: string; evidence: SourcePin[] }
  | { kind: "ADMITTED"; canonicalId: string; approvalRef: string; source: SourcePin }
  | { kind: "UNRESOLVED"; reason: string };
type ResourceRef = {
  resourceClass: string;       // source/authority-backed class, not file=>OoC
  resourceId?: string;         // only from independent provider/observer
  adaptationRef?: string;      // MUST not silently merge other adaptations
};
type SituationRef = {
  reference: string;           // stable source-ref; facts cannot infer situation
  revision?: string;
};
type DesiredChangePath = {
  providerDeclarationId: string;
  authorityRef: string;
  authorityRevision: string;
  intentionRef: string;        // declared desired change, not completed effect
  target: ResourceRef;
  situation: SituationRef;
  operation: "create" | "edit" | "review" | "task";
  targetOoC?: IdentityStanding;
  // Additional source-owned fields may be required for an approved Change Path.
};
type ObservedFact = {
  eventId: string;
  scope: string;
  factType: string;            // typed positive observation, not free-form verdict
  factArgs: string[];
  origin: "pi-event" | "repository-observation" | "trusted-work-provider";
  provenance: string;
  sourceRevision?: string;
  sourcePath?: string;
  sourceDigest?: string;
  evidenceState: "OBSERVED" | "PARTIAL" | "MISSING" | "RETRACTED";
};
type NormativeEdge = {
  sourceRuleId: string;
  targetRuleId: string;
  type: "requires" | "blocks" | "enables" | "runs_alongside" | string;
  constraint: "mandatory" | "conditional" | "discretionary" | string;
  source: SourcePin;
};
type PotentialDriverProjection = {
  fromOoC: IdentityStanding;
  toOoC: IdentityStanding;
  situation: SituationRef;
  direction?: string;
  lag?: string;
  stockRole?: string | null;   // optional, not universally coerced
  evidence: SourcePin[];
  standing: "HYPOTHESIS" | "PROVIDER_QUALIFIED";
};
type ProposedRealizationBinding = {
  standing: "PROPOSED" | "APPROVED";
  authoringAuthorityRef?: string;
  version?: string;
  targetOrFeasibleLever: IdentityStanding;
  resource: ResourceRef;
  situation: SituationRef;
  applicabilitySource?: SourcePin;
  actionTemplateRef?: string;     // optional: there may be zero direct forms
  conventionRuleRefs?: string[];  // distinct from executable Actions
};
type Disposition = "MATCHED" | "NO_MATCH" | "UNKNOWN" | "AMBIGUOUS" | "REFUSAL";
type GovernanceQuery = {
  declaration?: DesiredChangePath; // may be absent for read-only observation
  observations: ObservedFact[];
  candidateReferences: IdentityStanding[];
  sourceLocks: SourcePin[];
  proposedBindings?: ProposedRealizationBinding[];
  possibleDrivers?: PotentialDriverProjection[];
};
type GovernanceResult = {
  disposition: Disposition;
  matchedEntryRuleIds: string[];    // 0..N source-authored convention IDs
  mandatoryRequiredRuleIds: string[];
  requiredProofs: Array<{
    fromRuleId: string; toRuleId: string; authoredEdge: NormativeEdge;
    premiseFactIds: string[]; proofSource: SourcePin[];
  }>;
  applicabilityProofs: Array<{
    ruleId: string; authoredPredicateSource: SourcePin;
    observedFactIds: string[];
  }>;
  unresolved: Array<{
    kind: "MISSING_AUTHORITY" | "UNADMITTED_ID" | "MISSING_SOURCE" |
          "INCOMPLETE_OBSERVATION" | "PREDICATE_AMBIGUITY" |
          "GRAPH_GAP" | "MAPPING_GAP" | "NO_RULE_REQUIRED" |
          "NO_REALIZATION_FORM" | "CONFLICT";
    reason: string; source?: SourcePin[];
  }>;
  authorizedToExecute: false;      // resolution is never a permission grant
  effectVerified: false;           // effects need independent measurement
};
~~~

**Field obligations, not invented facts:** Mandatory `providerDeclarationId`/`authorityRef` must come from the authorized work provider, not from task text or a model; in the existing [`src/reasoning-context.ts`](https://github.com/afokapu/pi-atdd/blob/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85/src/reasoning-context.ts#L14-L35) `phase`, `actorRole` and `acceptance` already require `trusted-work-provider` when asserted. Observed events have their own independent origin, provenance, revision and explicit partial/missing evidence. **No current source supports treating a proposed `targetOoC` or `ProposedRealizationBinding` as ADMITTED/APPROVED.** Null values and absent fields remain missing, not implicit approvals.

**Stream B can start now:** produce bounded facts (scope, operation, observed path/revision, AST positive constructs, event and provenance IDs, missing/replaced/retracted facts); do not wait for a semantic object registry. In existing [`src/structural-evidence.ts`](https://github.com/afokapu/pi-atdd/blob/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85/src/structural-evidence.ts#L1-L35), only specific Bun mutating routes and test URN headers are derived; incomplete syntax yields no positive construct and is **UNKNOWN** rather than negative proof. Existing positive [`src/inference.ts`](https://github.com/afokapu/pi-atdd/blob/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85/src/inference.ts#L1-L18) does not infer falsity from absent facts.

### 2.1 Source/standing and three distinct relationship families

| Question | Authoritative source / standing | Admissible inference | Forbidden coercion |
| --- | --- | --- | --- |
| **Potential Driver influence**: which distinct OoC might affect another, in what Situation, direction, lag and evidence standing? | Future qualified, provider-pinned **OoC→OoC** projection (research-only; currently absent for ATDD) | **Hypothesis only**, with optional/null five-role reading | Not an authored ATDD rule edge, not causal proof, no Action or mandatory graph closure |
| **ATDD normative/workflow relationships**: what constraints bind existing convention IDs? | [Bun graph](https://github.com/afokapu/pi-atdd/blob/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85/vendor/atdd-bun/relationships.yaml), [local graph](https://github.com/afokapu/pi-atdd/blob/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85/catalog/pi-atdd/relationships.yaml), typed `type` and `constraint` | Expand only **source-authored `requires / mandatory`**, recursively, with exact edge witness and a catalog-resolved target | `blocks`, `enables`, `runs_alongside`, conditional `requires` without verified predicate, and workflow verbs are not compulsory prerequisites |
| **Applicability**: does an existing convention govern this particular change/fact scope? | Authored selectors/predicates + independent typed observations + source pins; current Pi Datalog is the comparison oracle | Rule entry 0..N with exact positive premise proof; missing evidence remains unknown | Graph reachability does not mean applicability; agent intention and natural language alone do not grant semantic identity or proof |

Current [`src/reasoning-context.ts` L38–66, L67–110, L151–169](https://github.com/afokapu/pi-atdd/blob/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85/src/reasoning-context.ts#L38-L110) already uses positive selector facts, typed derivations and mandatory `requires` closure. **Do not fork a parallel T9/Pi Datalog matcher** in Stream A. The current reasoner's `matched/unknown/incomplete` status is not a full realization-contract verdict; mapping to the draft dispositions above requires explicit future approval.

## 3. Resolution and refusal ordering (proposed; conservative)

1. **Classify the operation first.** Read-only context inspection may collect observations without fictitious desired Change Path. For a proposed *governed mutation*, require an independently valid provider declaration and authority/source revision; absent/invalid/mismatched declaration yields **REFUSAL**, not fabricated Change Path.
2. **Validate identity standing and target specificity.** An evidence-only candidate may guide **research comparison** but cannot authorize a semantic realization. Missing admission, Resource class/id, Situation, provider authority, incompatible adaptations or unknown candidate identity yield **UNKNOWN** or **AMBIGUOUS**, with a specific reason; do not silently choose an identity.
3. **Use only source-backed applicability with positive facts.** Resolve 0..N **existing convention IDs**. Preserve negative controls, observed event revisions and retractions. A statement “I am in GREEN”, or a filename containing “DELETE”, is not a trusted phase or mutating-route AST fact.
4. **Compute normative closure separately.** Traverse exactly authored `requires / mandatory` edges; each proof names its rule edge source, constraint, resolved targets and positive entry premise. An unresolved required target => **UNKNOWN/GRAPH_GAP**, not a waived obligation. A conditional edge requires its own authored/proven condition before closure.
5. **Discriminate empty results.** **NO_MATCH / NO_RULE_REQUIRED** requires a **verified full relevant catalog/predicate/exception search**, valid authority and sufficient observations; `0 matched` alone is insufficient. Otherwise return **UNKNOWN** and classify `MAPPING_GAP`, `INCOMPLETE_OBSERVATION`, `PREDICATE_AMBIGUITY`, or `GRAPH_GAP`. Only evidence-backed uncovered rules enter `shared.convention.propose` through review/owner; never active on the originating task.
6. **Keep realization separate.** A matched rule is not an executable Action. An admitted OoC may have no direct form; a qualified target→feasible-lever path still needs its own independently source-governed lever binding and approval. No matching contract, causal path, observed outcome or Action capability may be invented.

## 4. Contrasting frozen-source scenarios and falsifiable expected proofs

These are **specification-level expectations or existing-test assertions at a frozen source**, not independently executed current-head tests. Exact full-catalog 0..N outputs must be independently replayed with source locks before approval.

| Case and scope | Supported facts / negative control | Expected rule resolution, proof, and disposition boundary |
| --- | --- | --- |
| **S1 Bun route edit, positive** | `edit` of `src/server.ts`; independently observed parsed `Bun.serve({routes:{"/orders":{DELETE:...}}})` → `code_construct(bun_mutating_route)`. Source: [`coder.security.missing-auth` L6–40](https://github.com/afokapu/pi-atdd/blob/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85/vendor/atdd-bun/conventions/coder/security/coder.security.missing-auth.convention.yaml#L6-L40), [typed activation](https://github.com/afokapu/pi-atdd/blob/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85/src/reasoning-context.ts#L88-L100). | **At least** `coder.security.missing-auth` from exact premises `code_construct + operation=edit` using `pi-atdd.typed-bun-mutating-route-edit`; no dependency invented. Other selector matches must be recorded from an actual run. Rule activation **does not certify guard existence**, much less security. A governed mutation with missing provider declaration is **REFUSAL** at the semantic preflight even if Pi can observe syntax. |
| **S2 GET-only route, negative / changed-fact** | Same scope's source now has only `GET`. [`tests/reasoning-context.test.ts`](https://github.com/afokapu/pi-atdd/blob/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85/tests/reasoning-context.test.ts) asserts `coder.security.missing-auth` is removed on source change and Bun typed construct becomes unknown. | **No S1 typed authorization-rule support**; retraction of `bun_mutating_route`/dependent `active` fact. Not a “rule passed” or global NO_MATCH, because other catalog predicates might still match. For explicitly scoped auth-rule lookup with complete source, GET/HEAD is a **reasoned exclusion**. |
| **S3 Test header, structural versus semantic** | `edit` of test path containing source-leading `// URN: test:orders:checkout:E001-SMOKE-001`; independent `test_urn_header` fact, [source rule](https://github.com/afokapu/pi-atdd/blob/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85/vendor/atdd-bun/conventions/tester/acceptance/tester.acceptance.binding-declared.convention.yaml#L6-L25). | **At least** `tester.acceptance.binding-declared`, proof `code_construct(test_urn_header) + operation=edit` through `pi-atdd.typed-test-urn-edit`; expected missing binding check must still inspect header and actual plan/test behavior. No test-claim truthfulness or admitted C-05b follows from a header. |
| **S4 Local rule and mandatory closure, positive / nonmandatory trap** | Given an **independently source-verified applicable entry** `coder.tracker.issue-in-branch-and-pr` for a code-changing branch; [graph](https://github.com/afokapu/pi-atdd/blob/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85/catalog/pi-atdd/relationships.yaml#L73-L102). | Entry + **`shared.tracker.issue-mandatory`** via exact `requires/mandatory` edge L79–84. **Never** pull in `shared.tracker.unconfigured-notice` just because of L73–78 `runs_alongside/discretionary`: it needs its own specific no-tracker condition. If the entry is `planner.tracker.issue-before-ratify`, mandatory closure includes **both** `shared.tracker.issue-mandatory` and `planner.plan.confirm-binds-an-issue` (L85–96). Entry applicability itself is **UNVERIFIED**, not granted by these edges. |
| **S5 Behavioral review, existing graph witness** | `operation=review` and observed task text “Perform final behavioral review”; [source rule](https://github.com/afokapu/pi-atdd/blob/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85/vendor/atdd-bun/conventions/reviewer/reconciliation/reviewer.reconciliation.behavioral.convention.yaml#L5-L47). | Existing [`tests/reasoning-context.test.ts`](https://github.com/afokapu/pi-atdd/blob/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85/tests/reasoning-context.test.ts) asserts `reviewer.reconciliation.behavioral` and mandatory `reviewer.inspectability.owner` with `pi-atdd.mandatory-prerequisites` proof and Bun graph provenance. This is test-authored expected behavior, **not a run in this session**, and does not establish actual delivered behavior. |
| **S6 Read-only/no rule, negative** | `operation=task`, independently verified no mutation, no tracker issue; [`shared.tracker.issue-mandatory`](https://github.com/afokapu/pi-atdd/blob/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85/catalog/pi-atdd/conventions/shared/tracker/shared.tracker.issue-mandatory.convention.yaml#L6-L14) excludes read-only work. | **No tracker-rule requirement** for this scoped case, regardless of issue ID; can report `NO_MATCH/NO_RULE_REQUIRED` **only for fully inspected tracker applicability** with adequate facts. Overall catalog resolution remains **UNKNOWN** until its other rules/predicates are evaluated. Do not manufacture a universal no-rule proof from missing IDs. |
| **S7 Missing declaration / partial source / ambiguity** | Attempted governed `edit` with no valid provider authority/declaration; or only a task claim “DELETE” without parsed Bun syntax; or ambiguous cross-profile Resource/Situation | Missing authorized mutation declaration → **REFUSAL**. Existing valid declaration but missing source / partial AST observation → **UNKNOWN/INCOMPLETE_OBSERVATION**. Multiple indistinguishable semantic targets → **AMBIGUOUS**, not a randomly selected OoC. No such condition is proof that an uncovered convention exists. |

**Parity oracle:** Compare the actual set, mandatory transitive closure, source edge constraints, positive-premise proof and changed/retracted supports against the pinned [`ReasoningSession`](https://github.com/afokapu/pi-atdd/blob/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85/src/reasoning-context.ts#L155-L169) / [Datalog engine](https://github.com/afokapu/pi-atdd/blob/54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85/src/inference.ts), not only the expected labels in this document. A direct T9-vs-Pi parity benchmark was **not run**. Neither scenario asserts approved Change Path fields or actual impact effects.

## 5. Source-grounding gaps and compatibility conflicts

| Open field or conflict | Why this packet cannot fill it | Review/owner route |
| --- | --- | --- |
| Admitted engineering `OoC` identity, novelty, state granularity | The 13 sample-rule proposals lack independent O1–O8 and canonical alias reconciliation; other 362 rules unresolved | ATD-29 → ATD-28 (blind independent gates) → ATD-27 → owner |
| Owner-declared desired Change Path, authority and Situation | Task prose, file path or observation has no authority to create them; no authorized provider declaration present | ATD-39 source/authority provider, PLT-107 research |
| Stable Resource+Situation identification; adaptation binding | File/resource instances and profile names are not automatically OoCs or stakeholder Focus | Owner steward with source evidence |
| Applicability predicates for every convention | 376-rule corpus not exhaustively assessed; existing selectors and typed facts are narrower than T9 semantic contracts | Independently source-locked predicate inventory and Pi parity |
| Qualified potential Driver paths, direction, lag, role/null and effect | No approved ATDD OoC→OoC causal projection or measured intervention in this source | Decision OS / PLT-107/115 steward decision |
| Approved generic Change Realization Contract and zero/direct/lever forms | PLT-110 is research-only; current Action-template contract is not this proposed public schema | PLT-110 owner versioned API review; separate lever evidence |
| T9 grammar and version compatibility | PLT-107 records v2 grammar exclusions, possible v3/v4 extension conflicts; source governance and migration unapproved | Compare exact published T9 contract and draft, seek steward authorization; **do not** implement now |
| Graph external unresolved target / conditional edge eligibility | Current Pi reasoner distinguishes `requires_missing` and does not magically resolve unknown targets or conditional predicates | Independent replay, explicit `GRAPH_GAP`/`UNKNOWN` and provenance |
| Verified effect versus model declaration | A rule lookup or semantic preflight cannot observe post-change effects or compliance | Stream B observations plus independent runtime/acceptance measurement |

## 6. Review packet and reproducibility

- **Source-lock / ledger verification:** `node --experimental-strip-types tools/atd-40-verify-ledger.ts` from repository root after installing the pinned dependencies.
- **Existing TypeScript + tests:** `npm run check`. **Pi/runtime/catalog checks:** `npm run smoke:pi` and `npm run smoke:catalog` (the latter needs populated external source directories per `package.json`); run on actual PR head/installed Pi environment, not inferences from source tests.
- **Independent replay:** verify S1–S7 against actual source revision/observation facts, plus negative/unknown controls and graph closure traces; explicitly distinguish source-test assertions from executed results.
- **No implied pass:** GitHub source inspection and issue comment exchange are verified; local test command success, 376 YAML body inspection, actual T9 parity, independent O1–O8, owner admission, approved schema and effect verification are **NOT verified**.
- **PR route:** draft only, `feature/atd-40-ooc-governance-contract` → `integration/atd-39-ooc-activation`; independent coordinator/reviewer acceptance before further integration. No direct `main` merge or consumer cutover.

**Source issue chain:** [ATD-40](https://linear.app/af8/issue/ATD-40) / [ATD-39](https://linear.app/af8/issue/ATD-39); Pass A [ATD-29](https://linear.app/af8/issue/ATD-29), governance [ATD-26](https://linear.app/af8/issue/ATD-26), Pass B [ATD-28](https://linear.app/af8/issue/ATD-28), Pass C [ATD-27](https://linear.app/af8/issue/ATD-27); research [PLT-107](https://linear.app/forge100/issue/PLT-107) / [PLT-110](https://linear.app/forge100/issue/PLT-110). Early handshake recorded in ATD-39 and ATD-41 issue comments on 2026-11-22.
