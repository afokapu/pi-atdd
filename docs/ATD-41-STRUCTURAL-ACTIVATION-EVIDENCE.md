# ATD-41 — Stream B structural observation handoff (proposal, not authority)

**Owner / issue:** [ATD-41](https://linear.app/af8/issue/ATD-41); source issues [ATD-22](https://linear.app/af8/issue/ATD-22), [ATD-25](https://linear.app/af8/issue/ATD-25), [ATD-30](https://linear.app/af8/issue/ATD-30).

**Parent integration charter:** [ATD-39](./ATD-39-INTEGRATION-COORDINATION.md).

**Repository / branch:** `afokapu/pi-atdd`, `feature/atd-41-structural-activation`; PR base `integration/atd-39-ooc-activation`; original fork `main@9abc1a087db8d3d50f4e7badbd0320fe68733ca1`; common charter commit `54edcf0cda4b435bb3b6dd1e9c4ea368baf3cc85`.

**Upstream source pins (CI, not modified):** ATDD-Bun `5945d97e18310e7c862c08e73985400935d21346`; ATDD-Flow `2a66019a5ecf2b7a9f999ebfa04d04c9f548f19a`. Runtime convention digests are retained by the existing `Catalog.provenance`.

## Observation contract

`src/operational-observers.ts` classifies source/test/e2e/declaration/generated/vendor files with path/source evidence and UNKNOWN on unsupported paths. Bounded TypeScript syntax analysis recognizes a **relative, same-feature `domain/` → `integration/`** static import, with an **added** fact only when a before/after pair is available and parseable. A present import without an old source is positive present-code evidence, *not* a proven addition. This is source syntax, not resolved module identity, semantic dependency proof, or code compliance.

`src/reasoning-context.ts` keeps legacy selectors/path-level applicability for compatibility and adds positive typed `file_kind`, `code_construct`, `change`, and revision-bound detector `finding` support, fed to the existing `PositiveReasoner`. It does not rewrite canonical conventions or infer missing authoritative fields. A trusted provider **must** explicitly supply a revision and phase; the Pi runtime supplies no such phase by guessing. A finding must arrive via the explicit detector-result observation origin for a review operation, match the observed path/revision, and carry detector/evidence identifiers. This is an adapter boundary, not proof that an external detector ran.

`src/pi-activation.ts` assembles a proposed new source before Pi `edit`/`write`, compares it with a safe, actual prior file snapshot, and supplies the typed delta to the reasoner **before mutation**. For `bash`, only a bounded, quoted literal `cat` heredoc with a statically observed target yields proposed contents; target-only and dynamic writes do **not** fabricate new contents. The existing post-tool Git/JJ observer notices changes after opaque mutations and can derive *present* structural facts, but does not retroactively claim pre-edit interception. Source changes reassert/retract supports under a stable scope; independent path/selector supports may remain, with distinct proofs.

`src/observation-envelope.ts` proposes a **pure in-memory** coordinator evaluation envelope containing event ID, origin/provenance, actual revision when known, path hint, observed typed facts with evidence IDs, missing-fact reasons, source-locked convention IDs/mandatory `requires` paths/proofs and `observation_only_no_authority`. It is **not** a public T9 API, an OoC definition, a provider's declared Change Path, a permission, or a merge/compliance verdict. It must **not** be persisted to sanitized local telemetry because proof and path hints may contain private paths.

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
- Existing `tests/ambiguous-discovery-audit.test.ts` continues to characterize known false positives/misses; it does *not* silently ratify them.

**Evidence status at authored handoff:** tests have been **written**, not independently executed at the time this document was authored; TypeScript typecheck, targeted tests, real Pi smoke, catalog parity, install smoke and current-head CI are **UNVERIFIED pending actual run evidence**. Use the draft PR checks for current-head results. No runtime compliance, owner OoC admission, semantic T9 binding, source-authored Change Realization Contract, autonomous merge gate or cutover is claimed.

**Coordinator follow-up:** compare the proposed envelope with Stream A's separately reviewed candidate/admission distinctions and owner-governed Change Realization Contract. Only the integration coordinator may accept this boundary after independent review, pinned source checks and current-head green CI; no worker merges this branch to `main`.
