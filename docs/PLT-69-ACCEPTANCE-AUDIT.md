# PLT-69 — Adversarial acceptance audit (author assessment)

**Parent:** [PLT-69](https://linear.app/forge100/issue/PLT-69). **Code:** [stacked PR #2](https://github.com/afokapu/pi-atdd/pull/2), based on the PR #1 branch. **Verdict:** RETURN / PARTIAL, not ready to declare all acceptance criteria complete. Do not merge PR #2 or retire the old toolkits based on typecheck/smoke tests alone.

The eight canonical Given/When/Then acceptance files are in plan/acceptances/E002-* and are checked with the unchanged ATDD-Bun acceptance V2 schema. Test source markers are structural connections; evidence below states what each test actually proves.

| Criterion | Implementation / evidence | Author status |
|---|---|---|
| D001 — automatic context | src/reasoning-context.ts, src/pi-activation.ts; tests/reasoning-context.test.ts and tests/pi-activation.test.ts demonstrate path/layer/operation facts and automatic Pi events without querying a skill | PARTIAL: real typed activation works for authored examples, but default selectors still do not cover every bundled rule; authoritative phase and role facts require future work-provider integration |
| D002 — recursive positive inference | src/inference.ts, tests/inference.test.ts: safe head variables, no negative premises, finite recursive cycle, duplicate materialization checks and bound on joins | PASS for finite positive rules in these scenarios; not a benchmark establishing Datalog as universally optimal |
| D003 — insertion/retraction and multiple supports | tests/inference.test.ts: two independent derivations, removal of one, removal of all, a recursive self-support cycle, repeated insertion and evidence changes; tests/benchmark-inference.test.ts compares incremental vs cold full-corpus replay | PASS for tested cases; benchmark is environment-dependent; no proof of all possible rule programs, and no claim of globally superior performance |
| D004 — explanation / useful guidance | src/render-reasoning.ts, tests/render-reasoning.test.ts: canonical path, source SHA, original authored guidance, mandatory relationship path/reason, trigger proof, exceptions, detector reference and bounded token-like character budget | PASS for authored fixture and bounded payload; exact token counts and agent comprehension are NOT proven |
| D005 — unknown and incomplete graph | src/reasoning-context.ts, tests/reasoning-context.test.ts: unknown trusted phase/authority, missing mandatory endpoints, 44 unresolved external Bun edge references, no invented Flow links | PASS for those negative cases; graph closure remains INCOMPLETE |
| D006 — Pi lifecycle + bypass | src/pi-activation.ts and src/repository-observer.ts, tests/pi-activation.test.ts and tests/repository-observer.test.ts: first edit, retry de-dup, new task reset, bash bypass, committed Git changes, no-repository UNKNOWN | PARTIAL: Git local observation works; JJ is best effort without parity tests, Git-ignored files and unobservable custom tool modifications remain possible, and this is not a security enforcement boundary |
| D007 — governed challenge | src/challenge.ts, tests/challenge.test.ts: immutable pending request, correct canonical digest, affected rule relationships, evidence references and no self-approved/unverified decision | PARTIAL: tested with a mocked trusted reviewer; real authenticated Linear or other external reviewer adapter is not wired; cannot waive mandatory CI |
| D008 — improved agent decisions | src/effectiveness.ts, tests/effectiveness.test.ts and docs/D008-OUTCOME-PROTOCOL.md: independent rerun catches a false-green claim, matched-pair summary tracks correct/failed tests, latency and injected tokens | **NOT SATISFIED.** A real Qwen2.5-Coder-0.5B graph/control Pi/JJ smoke ran, but all four agents made zero tool calls and changed no source; the 1-pass/2-fail independent acceptance stayed red in both conditions. It was not an equal-base, independently attested weak/strong D008 comparison. A qualified paired experiment remains a release blocker |

## Architecture and migration cautions

- The source of normativity remains the offline SHA-locked, byte-identical Bun/Flow YAML. New typed inference rules are **adapter applicability rules**, not disguised edits or authoritatively declared new relationships.
- Only **mandatory requires** relationships derive prerequisites. Other typed edges remain available as authored context but do not become new hard obligations automatically.
- A missing context fact is UNKNOWN; it cannot be inferred as false, an exception, a waiver, or a merge permission.
- Retraction over-deletes affected derivations and locally rederives from surviving extensional and unaffected positive facts; self-supporting cycles without grounded support cannot persist.
- A Pi pre-edit block can be retried or bypassed via bash. Post-tool inspection reduces missed guidance in Git/JJ worktrees; it cannot ensure correctness or supersede independently required CI and behavioral review.
- Reviewer capability checks are an interface that must be implemented by an externally authenticated adapter. A string appearing in a comment is not authority.
- D008 outcomes require qualified, tool-executing paired agent trials and an authenticated evaluator. The [0.5B pilot](../experiments/weak-model-pi-jj/REPORT.md) is an unqualified feasibility result; do not put fabricated improvement into the ledger or close PLT-69 because its harness passed.

## Review boundary

Request an independent semantic review only after code-specific acceptance cases are stable. Keep this PR a draft until D006 and D007 integration boundaries are explicit, D008 experiment results exist, unresolved graph references are governed, and the original PLT-64 branch reaches its own review boundary. A passing CI report is evidence of current test success, not approval.

## Adversarial failure discovered during implementation

The first recursive retraction regression test exposed **mutable-premise corruption**: the join evaluator stored references to its scratch match array rather than immutable copies. A later candidate could rewrite a previously recorded proof, sometimes making a live derivation appear to depend on itself. This would corrupt both explanation fidelity and reverse-dependency lineage. Fixed in src/inference.ts by snapshotting every derived support's premise array. Added a specific multi-root cyclic survival and cross-join lineage test; both pass in the corrected CI suite.

The D008 checker was also tightened to reject uncommitted worktree changes, result revisions that do not descend from the trusted baseline, and acceptance test files changed by the coding agent. A passing test run against an agent-rewritten test is not independent evidence. Write-once challenge records now verify their content-derived IDs when read and before authenticated review.

## Current verified CI

[GitHub Actions run 44279189265](https://github.com/afokapu/pi-atdd/actions/runs/44279189265) passed after the immutable-support correction, including TypeScript typechecks, unit/integration tests, the full pinned catalog, actual Pi RPC registration and local package installation. Subsequent documentation-only changes require a fresh status check at the final PR revision. **D008 remains without a valid matched model comparison.**


## Independent review reconciliation — 2026-11-18 (PR #2, review 5954595568)

Independent reviewer verdict: **RETURN / changes required**, not APPROVE. The five inline findings were reproduced or bounded with five additional canonical GWT acceptance records in plan/acceptances/E003-* and executable tests.

| Finding | Code response | Regression witness |
|---|---|---|
| Omitted conventions marked as delivered | renderReasonedPage() returns exact emitted/omitted IDs; Pi records only emitted proof signatures, pages remaining guidance across blocked retries | tests/pi-activation.test.ts, E003-UNIT-201, 18 simultaneously applicable synthetic rules |
| D008 trial-selected unrelated passing tests or mutated helpers | verifyTrial() requires an independently attested acceptance manifest with exact task/base/acceptance targets and a strict allowlist for every changed tracked file; all other files, including imported test helpers, remain protected | tests/effectiveness.test.ts, E003-INTEGRATION-202 |
| Baseline and graph use different evaluator targets | compareTrials() rejects unequal manifest digests, target lists, policy digests, acceptance IDs or run classes, instead of computing passDelta | tests/effectiveness.test.ts, E003-INTEGRATION-203 |
| Symlink-parent path escape | Pi pre-edit containment traverses the existing path components using lstat and rejects symlinks, including symlink targets | tests/pi-activation.test.ts, E003-UNIT-204 |
| Inference exception can expose partial facts | After any exception during a mutation, PositiveReasoner is poisoned; read, query, update and counters reject reuse until reconstruction | tests/inference.test.ts, E003-UNIT-205 |

**Verified CI:** [GitHub Actions 44288561019](https://github.com/afokapu/pi-atdd/actions/runs/44288561019) passed on the tested revision, including TypeScript checks, bundled Bun/Flow source verification, real Pi RPC and local package installation. The source itself remains subject to reviewer reconciliation on the final head.

### What this does *not* close

D008 remains **NOT SATISFIED**; the exploratory real 0.5B model did not execute Pi tools and no qualifying weak/strong model comparison exists. The trusted manifest verifier is only an interface; a real authenticated evaluator, independent semantic review and recorded equal-base trials remain required. A mocked verifier used in a regression does not attest real trials. The physical path check reduces symlink escapes but does not eliminate time-of-check/time-of-use races, alternate mount namespaces or malicious tools. The Pi rendering receipt proves delivery of text to Pi, not that the agent read or followed it. The original 44 unresolved external graph edges, incomplete activation selectors and Flow/Bun migration gates remain explicit.
