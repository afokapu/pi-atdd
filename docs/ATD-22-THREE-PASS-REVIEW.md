# ATD-22 / ATD-41 — systematic, systemic and adversarial review

**Author-side review date:** 2026-11-22. **Source of authority:** [ATD-22](https://linear.app/af8/issue/ATD-22) (OBS-001..004), delivered via [ATD-41](https://linear.app/af8/issue/ATD-41) and [draft PR #50](https://github.com/afokapu/pi-atdd/pull/50). The previous [PR #44](https://github.com/afokapu/pi-atdd/pull/44) was staged into integration only. **Coordinator:** [ATD-39](https://linear.app/af8/issue/ATD-39) and draft [PR #55](https://github.com/afokapu/pi-atdd/pull/55).

**Status:** This is an implementer-produced verification record, **not** independent review, source-issue acceptance, OoC admission or integration/main merge authorization. Record unknowns instead of approving them.

## 1. Systemic pass — how the change impacts the whole runtime

- **Source lock and architecture:** Canonical Bun, Flow and local convention YAML/relationships/selectors are unchanged. The reasoner continues to consume exact typed facts, enforce only source-authored mandatory `requires`, and preserve legacy lexical selector supports as distinguishable evidence. The new TypeScript AST adapters are source observers, not code execution, permissions, providers or semantic truth.
- **Pre-edit versus post-tool:** Real Pi `edit`/`write` and supported static quoted-heredoc preflight can compare existing/proposed content before mutation. Runtime-computed shell scripts have no trustworthy proposed bytes; Git/JJ post-tool observation and UNKNOWN are the honest backstop. A source-level present construct is never fabricated into an observed added delta.
- **Provider/phase boundary:** `phase` and role are not inferred from task text; authenticated, revision/seat-bound Flow provides workflow facts. Missing phase remains UNKNOWN. A validator finding is a separate revision/digest/file/detector proof, consumed only by authorized REFACTOR/reviewer paths and retracted when source changes.
- **Bun and test sensors:** `src/bun-route-auth.ts` separates a statically observed missing handler guard from mere mutation presence, direct entry guards, late/conditional/opaque guards, unrelated method fields, nested callbacks and mutable route aliases. Positive violations survive alias uncertainty; safe negatives do not. `test_urn_missing_binding` is separate from URN presence, and a source-URN review-only rule preserves truthfulness guidance even when headers appear valid. These are heuristic source witnesses, not runtime authorization or proof of actual test truthfulness.
- **Telemetry and CI:** Local activation telemetry retains sanitized fact IDs and UNKNOWN distinctions. `tools/atd-41-quality-audit.mjs --enforce` applies **unchanged** pinned upstream Bun quality thresholds to all new helpers and test isolation checks. Catalog/real Pi/attention/install smoke jobs and the full code/test job are distinct from original issue acceptance.

## 2. Systematic pass — authoritative source criteria

| Original criterion | Implemented evidence | Verdict and explicit uncompleted part |
| --- | --- | --- |
| **OBS-001 pre-edit** | `src/operational-observers.ts`, `src/layer-import-observer.ts`, `src/pi-activation.ts`; `tests/layer-import-observer.test.ts`, `tests/pi-activation.test.ts` inspect pre-mutation domain→integration and other authored outward imports, clean negatives, missing old source, ambiguous aliases, static shell targets | **PARTIAL:** dynamic/opaque shell content cannot be reliably inferred prior to execution, so only honest post-tool observation is possible; additional syntax/target forms remain UNKNOWN |
| **OBS-002 fires/doesNotFire** | `tools/sidecar-activation-matrix.ts` exhaustively verifies 359 source entries, 390 variants, **2,579 cases**, 718 source/sidecar digest checks. `tools/sidecar-witness-replay.ts` and tests bind **21 source-authored executable witnesses** to exact immutable case IDs: 10 architecture, 6 Bun authorization, 5 test-binding; 10 fires, 11 negative | **PARTIAL:** **2,558 cases lack independently inspectable file/diff/provider/detector witnesses**. They are individually recorded `UNQUALIFIED_NO_INDEPENDENT_OBSERVATION`, not marked PASS or N/A. A natural-language task-text replay does not establish the described situation |
| **OBS-003 provider phase** | `src/trusted-flow-phase.ts` and Pi trusted-phase tests from accepted ATD-42 stage; `src/reasoning-context.ts` rejects untrusted phase/role with missing/incorrect revision | **PASS, scoped:** no trusted provider => UNKNOWN; no chat phase invention. External owner authority or a generic T9 change path is not granted |
| **OBS-004 detector finding** | `src/validator-observer.ts`, live `src/pi-activation.ts` and reviewer reasoner produce real static TS import-boundary findings with detector/path/revision/SHA; tests verify REFACTOR-only consumption, GREEN exclusion, retract/reintroduce and both detector proof families | **PARTIAL:** the real adapter is bounded to source-inspected static TypeScript architecture imports. General external tool results, other validator kinds and independent reviewer acceptance are not proven |

**Reproduction on a current source checkout:**
```sh
npm run check
npm run smoke:catalog
npm run smoke:pi
npm run smoke:attention
npm run smoke:install
node --experimental-strip-types tools/sidecar-witness-replay.ts --output=/tmp/atd22-obs002-qualified.jsonl
# After checking out pinned afokapu/atdd-bun@5945d97e into .cache-sources/atdd-bun:
node tools/atd-41-quality-audit.mjs --enforce
```

**Verification pinning:** [Code run #45076675640](https://github.com/afokapu/pi-atdd/actions/runs/45076675640) passed at a **prior** source head `0d1f6db` and is **not** projected onto later code. Newer security-alias and reviewer changes require a **fresh current-head CI result** before any code-green statement. The qualified-case JSONL artifact and pinned digests, not source prose alone, define the reported witness count.

## 3. Adversarial pass — competing explanations and bypasses

- **Trust poisoning:** Wrong provider origin, absent revision, spoofed phase from chat/tool text, mismatched finding path/detector/revision, or missing exact source bytes must fail to produce trusted phase/finding authority. No missing evidence is converted into exemption.
- **Source confusion:** External npm imports and inward imports are clean controls; dynamic/aliased imports, partial parses, absent source snapshots, generated and vendored paths, and pre-existing violations must not yield false `import_added` receipts. Proof has separate source-present and source-added identities; stale support retracts and independent supports remain.
- **Bun authorization:** GET/HEAD routes and auth guards at the **affected handler entry** are source-backed negatives; an unguarded POST/PUT/PATCH/DELETE, even when protected elsewhere, is a positive. A nested callback, an unrelated object's `method` property, an indirect or late guard, computed/unresolvable routes, and aliased/mutable route or handler maps may not certify safety. A negated task like "do not touch authentication" does not override a witnessed GET-only negative, but unsupported source remains UNKNOWN.
- **Test bindings:** No test URN, non-test file, valid Acceptance binding and journey/E2E Train binding cannot claim a missing binding. A Train-only unit test or URN without a binding must activate `tester.acceptance.binding-declared`. A declared binding **still** receives an independent review-only truthfulness obligation; an attractive header is never proof that the test exercises/asserts the bound subject.
- **Delivery lifecycle:** GREEN cannot consume a real REFACTOR detector finding; both domain→integration and generic outward-layer reviewer proof families must be rendered. Removing violations retracts detector support; reintroducing source evidence redelivers. Dynamic shell writes fall back to repository observation rather than forged static proposals.
- **Overclaim prevention:** Matched/delivered rule count is not precision, recall or compliance. Eleven individually qualified negatives are not evidence that every one of the 2,579 examples is correctly activated; the remaining 2,558 are still a hard semantic acceptance gap.

## Integration reconciliation and refusal boundary

The active PR #50 branch is anchored to the **staged integration fork `567b2e513782b380c18f320d69edf140d61a36d4`**, while the coordinator integration head has moved independently. Draft PR #55 fixes exact-branch registration at the coordinator-owned intake without weakening source rows or turning PARTIAL into PASS. Until the independent owner/reviewer approves and integrates the coordinator change, PR #50's intake fails at provenance **before** examining OBS rows. That administrative failure is distinct from code-test outcomes and **does not** excuse the unsatisfied OBS-002 source witnesses.

**Disposition:** PR #50 and PR #55 stay draft; ATD-22 and ATD-41 stay In Progress; no force push, self-admission, unadmitted OoC registry, merge-to-main, or generic certification.
