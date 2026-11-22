# ATD-41 — Stream B structural observation handoff (proposal, not authority)

**Owner / issue:** [ATD-41](https://linear.app/af8/issue/ATD-41); source issues [ATD-22](https://linear.app/af8/issue/ATD-22), [ATD-25](https://linear.app/af8/issue/ATD-25), [ATD-30](https://linear.app/af8/issue/ATD-30).

**Parent integration charter:** [ATD-39](./ATD-39-INTEGRATION-COORDINATION.md).

**Repository / branch:** `afokapu/pi-atdd`, `feature/atd-41-structural-activation`; PR base `integration/atd-39-ooc-activation`; original fork `main@9abc1a087db8d3d50f4e7badbd0320fe68733ca1`; common charter commit `54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85`.

**Upstream source pins (CI, not modified):** ATDD-Bun `5945d97e18310e7c862c08e73985400935d21346`; ATDD-Flow `2a66019a5ecf2b7a9f999ebfa04d04c9f548f19a`. Runtime convention digests are retained by the existing `Catalog.provenance`.

## Observation contract

`src/operational-observers.ts` classifies source/test/e2e/declaration/generated/vendor files with path/source evidence and UNKNOWN on unsupported paths. Bounded TypeScript syntax analysis recognizes a **relative, same-feature `domain/` → `integration/`** static import, with an **added** fact only when a before/after pair is available and parseable. A present import without an old source is positive present-code evidence, *not* a proven addition. This is source syntax, not resolved module identity, semantic dependency proof, or code compliance.

`src/reasoning-context.ts` keeps legacy selectors/path-level applicability for compatibility and adds positive typed `file_kind`, `code_construct`, `change`, and revision-bound detector `finding` support, fed to the existing `PositiveReasoner`. It does not rewrite canonical conventions or infer missing authoritative fields. A trusted provider **must** explicitly supply a revision and phase; the Pi runtime supplies no such phase by guessing. A finding must arrive via the explicit detector-result observation origin for a review operation, match the observed path/revision, and carry detector/evidence identifiers. This is an adapter boundary, not proof that an external detector ran.

`src/pi-activation.ts` assembles a proposed new source before Pi `edit`/`write`, compares it with a safe, actual prior file snapshot, and supplies the typed delta to the reasoner **before mutation**. For `bash`, only a bounded, quoted literal `cat` heredoc with a statically observed target yields proposed contents; target-only and dynamic writes do **not** fabricate new contents. The existing post-tool Git/JJ observer notices changes after opaque mutations and can derive *present* structural facts, but does not retroactively claim pre-edit interception. Source changes reassert/retract supports under a stable scope; independent path/selector supports may remain, with distinct proofs.

`tools/atd-41-observation-envelope.ts` (reference adapter, excluded from the published runtime) proposes a **pure in-memory** coordinator evaluation envelope containing event ID, origin/provenance, actual revision when known, path hint, observed typed facts with evidence IDs, missing-fact reasons, source-locked convention IDs/mandatory `requires` paths/proofs and `observation_only_no_authority`. It is **not** a public T9 API, an OoC definition, a provider's declared Change Path, a permission, or a merge/compliance verdict. It must **not** be persisted to sanitized local telemetry because proof and path hints may contain private paths.

## Negative controls and deliberately unresolved coverage

- **Positive:** import added in an inspectable proposal; Bun mutating route in a generic file; leading test URN; explicit revision-bound detector finding; surviving independent evidence after another support retracts.
- **Negative:** same import unchanged, internal/non-domain imports, GET-only Bun route, unrelated DELETE object, vendored/generated source, retracted syntax, detector evidence removed.
- **UNKNOWN:** absent old source, unmatched or opaque tool mutation, partial syntax parse, aliased/unresolved import, unsupported file kind, absent detector run, missing trusted phase, unavailable repository revision or post-tool inspection. UNKNOWN does not establish `NO_RULE_REQUIRED`.
- **Known legacy false activation:** negated task language (“Do not touch authentication”) can still select security guidance on GET-only code through the untouched lexical selector. The labeled replay records that as **one spurious activation**, not detector precision. The existing broad domain-edit rule can activate hierarchy guidance without an import delta; inspect the *structural derivation* separately. Do not interpret raw telemetry match counts as precision or agent effectiveness.
- **Observer coverage is intentionally partial:** dynamic imports, path aliases, arbitrary shell scripts, non-TypeScript languages, handler/request-body constructs beyond the existing Bun route adapter, all upstream `fires`/`doesNotFire` sidecar examples, and host hooks other than Pi are not closed by this slice. Files with no before-snapshot cannot be called “unchanged.” Source locks and mandatory CI remain mandatory.

## Reproducible checks / evidence references

- `tests/operational-observers.test.ts`: explicit classification, before/after positive/negative/partial cases, quoted heredoc.
- `tests/operational-activation.test.ts`: labeled `fires`/`doesNotFire` samples with explicit structural versus lexical evidence, provenance, retract/dedup, 2 independent detector supports, trusted phase, envelope.
- `tests/pi-activation.test.ts`: Pi hook interception for `edit`/`write`/static `bash`; opaque shell post-observation, no false `added` claim; local log sanitization and dedup.
- `tools/sidecar-activation-matrix.ts` and `tests/sidecar-activation-matrix.test.ts` enumerate and digest-check the **entire** manifest/splits, probe each example as untrusted text and declare each case unqualified for structural acceptance.
- Existing `tests/ambiguous-discovery-audit.test.ts` continues to characterize known false positives/misses; it does *not* silently ratify them.

**Verified code/test checkpoint:** [GitHub Actions pi-atdd checks #298](https://github.com/afokapu/pi-atdd/actions/runs/45035993400) succeeded at code/test commit `d632e4bb42f3e3777fd254db4a1f91a89163b3d7`, including strict TypeScript, **413/413 tests**, and real Pi/catalog/attention/install smokes. This verification is code/fixture execution, **not** independent source-level semantic acceptance, runtime compliance, owner OoC admission, an approved T9 Change Realization Contract, merge authority or consumer cutover. Check the PR status again for commits after this checkpoint.

**Coordinator follow-up:** compare the proposed envelope with Stream A's separately reviewed candidate/admission distinctions and owner-governed Change Realization Contract. Only the integration coordinator may accept this boundary after independent review, pinned source checks and current-head green CI; no worker merges this branch to `main`.

## ATD-22 original-spec gate: per-criterion intake (not an approval)

The source specification [ATD-22](https://linear.app/af8/issue/ATD-22) is authoritative; ATD-41's B-01..B-05 wrapper does **not** supersede OBS-001..004. The matrix below separates concrete tested slices from unresolved acceptance. These statuses are **pre-independent-review** and must be reevaluated at the actual PR head.

| Criterion | Status | Evidence and tested positive/negative boundary | Residual gap |
|---|---|---|---|
| **OBS-001: pre-edit structural change** | **PARTIAL** | `tests/pi-activation.test.ts` tests `write`, exact `oldText/newText` edit and a quoted literal `cat` bash heredoc on `src/orders/domain/price.ts`, with `change:domain_to_integration_import_added` before mutation; `tests/operational-observers.test.ts` checks unchanged, removed, internal-only, vendored/generated, partial and alias negatives; `tests/operational-activation.test.ts` independently checks the structural Datalog proof for `coder.architecture.hierarchy-import` | Dynamic shell writes cannot provide verifiable proposed new source; other import target layers, resolved aliases and import edits outside this bounded shape are not observed |
| **OBS-002: full sidecar `fires`/`doesNotFire`** | **PARTIAL / NOT PROVEN** | `tests/sidecar-activation-matrix.test.ts` and `tools/sidecar-activation-matrix.ts` enumerate **all** manifest entries and split parts, verify exact source/sidecar SHA-256, and replay every individual example as untrusted task-only text through the same Datalog reasoner; CI emits `ATD41_OBS002_CASE` for each and a summary | Natural-language example descriptions are **not** witnessed source/diff/phase/detector situations. Every such case is marked `UNQUALIFIED_TASK_TEXT_ONLY`, never a PASS or valid false-negative/false-positive verdict. The six separately hand-built structural fixtures do not substitute for an executable full corpus |
| **OBS-003: trusted phase/UNKNOWN** | **PASS (scoped)** | `tests/operational-activation.test.ts` rejects Pi-origin phase and trusted phase without revision, proves no phase inferred from task prose, and accepts an explicit revision-bound trusted provider phase. Legacy profile fixture now pins its synthetic revision | No real Flow/coordinator provider is connected to this slice; real provider source authenticity remains an integration dependency |
| **OBS-004: detector finding after run, gated consumers** | **PARTIAL** | `tests/operational-activation.test.ts` asserts reviewer-only detector results require `origin=detector-result`, actual file and revision match, stable detector/evidence identifiers, independent supports and retraction. `src/reasoning-context.ts` exposes explicit `finding` facts without granting authority | No real validator process adapter is wired to a Pi tool result yet; REFACTOR-phase findings from trusted provider are not ingested as independent consumer route. A synthetic fixture is *not* proof a real validator ran |

**Full matrix reproduction (separate from the six executable witnesses):**

```sh
node --experimental-strip-types tools/sidecar-activation-matrix.ts --output=/tmp/atd-41-sidecar-matrix.jsonl
```

The tracked sidecar is **358 upstream source conventions plus one package-authored sidecar**, comprising 343 frozen rewrites, 15 split sources → 46 part variants, and the package-authored case. This yields **359 source entries / 390 rule variants**. Each `fires` and `doesNotFire` record carries the manifest source/sidecar hashes, expected label and exact index, actual *task-text-only* activation, an explicit qualification and missing-evidence reasons. Source/sidecar hash checks guard against accidental corpus replacement; the rule engine remains independent of source authoring. All case-wise outcomes are printed in CI even when unqualified; **raw text-match totals cannot establish OBS-002 pass, precision, recall, compliance or OoC admission**.

**Verified complete code/test checkpoint:** At `d632e4bb42f3e3777fd254db4a1f91a89163b3d7`, [GitHub Actions #298](https://github.com/afokapu/pi-atdd/actions/runs/45035993400) passed **413/413 tests**, strict TypeScript, real `smoke:catalog`, `smoke:pi`, `smoke:attention`, `smoke:install` and tracker check. The complete sidecar inventory is **2,579** examples (**1,485 `fires` / 1,094 `doesNotFire`**), **718** checked source/sidecar digests (0 drift); text-only task probe finds **18** positive text matches and **11** negative text matches, but **2,579/2,579 are UNQUALIFIED** because prose does not furnish independently witnessed file/diff/provider facts. The separate six source-witnessed controls yield **3 structural positives, 2 clean negatives, 1 known lexical false activation**. These counts cannot serve as full-OBS-002 pass, structural precision or recall. A documentation-only commit after the checkpoint must receive its own CI result before being called current-head green.

**ATD-39 handoff decision:** Integrate only after cross-stream review of this typed observation envelope and explicit disposition of OBS-002/004 gaps. No waiver, new provider authority, substitute Change Path, admitted OoC or T9 contract is implied. No direct merge to `main`.


**Coordinator-controlled intake status:** [ATD-39 acceptance run #2](https://github.com/afokapu/pi-atdd/actions/runs/45035993407) on this PR failed at the checker-bootstrap step, **before** inspecting original acceptance: its event base checkout was `54edcf0`, which lacked `tests/integration-contract-check.test.mjs` added later on the integration branch (now `e7933f9`). This is [reported to ATD-39](https://linear.app/af8/issue/ATD-39); Stream B does not repair coordinator workflow on a worker branch. Independently of that failure, OBS-001, OBS-002 and OBS-004 remain PARTIAL and therefore are not merge-ready.
