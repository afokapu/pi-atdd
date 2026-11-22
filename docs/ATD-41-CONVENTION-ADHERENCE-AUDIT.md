# ATD-41 — Toolkit convention adherence audit (scoped, not certification)

**Authority:** [ATD-22](https://linear.app/af8/issue/ATD-22) owns OBS-001..OBS-004; [ATD-25](https://linear.app/af8/issue/ATD-25) owns inference/proof; [ATD-30](https://linear.app/af8/issue/ATD-30) owns observation telemetry. [ATD-41](https://linear.app/af8/issue/ATD-41) is the delivery record; [ATD-39](https://linear.app/af8/issue/ATD-39) coordinates independent acceptance. PR: [#44](https://github.com/afokapu/pi-atdd/pull/44), feature branch to integration branch only.

## Audit boundary

This is an **author code/source audit**, not a run of every toolkit detector or independent acceptance. The pinned package includes 356 Bun and two Flow source conventions, plus 18 pi-atdd conventions; the activation sidecar expresses 359 source entries and 390 rule variants, including split parts. Applicability is scoped to the actual task, repository and runtime. This project is a Node/Pi TypeScript package; Bun-specific requirements (such as `bun:test` imports) are **not automatically normative** for its Node tests. No blanket pass is possible for rules without an explicit applicability and evidence evaluation.

At the pre-audit head `355f5ece22879e13b748acea7f40a0e389ccfd3b`, `.github/workflows/checks.yml` ran `npm run check` and Pi/catalog smokes, **not a full active-convention lint**. The tracker job was non-blocking. The code CI run [45036392949](https://github.com/afokapu/pi-atdd/actions/runs/45036392949) was green, but coordinator acceptance [45037851310](https://github.com/afokapu/pi-atdd/actions/runs/45037851310) failed at checker bootstrap. No independent review approval was present. Recheck these at the **new** commit; prior CI does not attest later edits.

## Rule and source acceptance evidence

| Rule or source acceptance | Applicability / evidence | Verdict for this work |
|---|---|---|
| `shared.tracker.issue-mandatory` / `coder.tracker.issue-in-branch-and-pr` | ATD-41 in issue, feature branch and PR body; Linear remains In Progress | **PASS on reference and status; CI job not a blocking gate** |
| `shared.convention.propose` | PR #44 changes runtime, tests and docs; no canonical convention YAML, relationships or selectors | **PASS for no canonical mutation** |
| `coder.runtime.typecheck-enforced` | TypeScript checker is invoked in the normal check path and code CI succeeded at pre-audit head; Bun application scope does not directly match this package | **Observed typecheck; Bun-specific applicability not asserted** |
| `coder.architecture.hierarchy-import` | Scoped AST observations activate the existing canonical rule on verified domain-to-integration imports, but aliases/other patterns are only partial | **PARTIAL operational coverage; not a repo-wide compliance pass** |
| `coder.quality.comments` | Source-authored rule exists, but Bun detector was not run on this package; raw source-line estimate suggests some modified files may fall below its 10% threshold | **UNVERIFIED applicability and official finding** |
| `tester.red.behavioral-assertion`, `tester.test.isolation-no-live-state` | Node fixture assertions and temp paths are present, but no Bun-native detector or RED-first record is evidenced | **UNVERIFIED under any applicable stack-neutral interpretation** |
| `reviewer.reconciliation.behavioral` | Draft PR and no independent approval; real Pi smokes do not replace semantic review | **OPEN** |
| ATD-22 OBS-001 | Pre-edit evidence for selected quoted shell proposals; dynamic/compound shell commands cannot be represented as a proven pre-change source | **PARTIAL**, despite the new fail-closed regressions |
| ATD-22 OBS-002 | All 2,579 sidecar examples were replayed as task prose; all are `UNQUALIFIED_TASK_TEXT_ONLY` | **PARTIAL / not proven** |
| ATD-22 OBS-003 | No phase guessed from task text; trusted-only revision-bound fixtures | **PASS within scope; live provider unconnected** |
| ATD-22 OBS-004 | Synthetic revision-bound detector support/retraction; no live validator adapter or REFACTOR consumption | **PARTIAL** |

## Specific code audit corrections in this commit

1. `src/operational-observers.ts`: a non-domain or excluded path previously returned `sourceObserved: true, deltaObserved: true` even with **no** source contents or prior snapshot. Both flags now depend on actually supplied evidence; regression covers absent and partial inputs. This avoids overstating a negative/source witness.
2. `src/shell-targets.ts`: the proposed-source extractor previously accepted the first literal `cat` heredoc in a compound script, even if a later shell command could overwrite the same path. The extractor now accepts only a standalone single quoted `cat` heredoc; compound commands stay UNKNOWN until post-tool inspection. Regression covers preceding commands, subsequent overwrite and multiple writes.

## Exit criteria still open

- Run the new regressions, full TypeScript checks and Pi/catalog smokes at the new feature head, preserving exact run URLs.
- Determine actual applicable Bun/Flow/core rules for this Node/Pi package, including quality and isolation, and execute the correct original detectors rather than relying on sidecar-text probes.
- Obtain an independent convention-level and behavioral review of the changed modules against authored rule statements, exceptions and accepted source issue criteria.
- Record per-rule PASS / FAIL / UNKNOWN / NOT_APPLICABLE with rule ID, source revision, inspected change/line and detector or reviewer evidence. This current matrix is **sampled, not exhaustive**. It cannot close ATD-22 or authorize PR merge.

## Follow-on code corrections — unresolved import forms

The bounded TS observer now recognizes a root `domain/` tree and static re-exports as architecture dependencies, avoiding a false negative when feature structure is flat. Dynamic `import()`, `require()`, `import type()`, `import = require()` and unresolved path aliases no longer produce an unjustified clean negative; they return explicit UNKNOWN reasons until a resolver supplies evidence. Added executable positive and negative cases in `tests/operational-observers.test.ts`.

This is a **conservative observation fix**, not module-resolution parity, full cross-language coverage, a new convention or independent acceptance. Original OBS-001/002/004 and reviewer gates remain partial/open; reproduce new behavior at the current commit before claiming a test result.

## Review finding: explain consequential implementation invariants

`src/reasoning-context.ts` now documents the trust boundary, legacy-selector false-activation distinction, mandatory-only dependencies, stable fact IDs, multi-support retraction and the coexistence of matched and UNKNOWN. `src/pi-activation.ts` now documents ambiguous edits, source-read failure, and preflight versus final verification. The source-line estimates moved from 4.04% to 11.44% (reasoning context) and 9.66% to 10.79% (Pi activation) for nonblank comment-leading lines, without adding filler or changing runtime behavior. This is a source-review quality improvement; the official Bun metric detector is **not** claimed to have run against this Node/Pi package.
