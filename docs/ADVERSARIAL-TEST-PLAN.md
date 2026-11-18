# Adversarial migration risks and proof plan

These are blockers or unresolved questions, not completed work. Severity reflects consequence, not probability. Required merge controls stay independent of Pi.

| Risk | Source evidence | Failure to simulate | Required treatment |
|---|---|---|---|
| R01 High: model ignores convention | Pi agent hooks only supply messages; tools such as shell commands can bypass read/edit hooks | Worker writes a violating file via bash or agent crash | Context injection is assistance, not authorization; CI independently verifies mandatory invariants |
| R02 High: source graph drift | ATDD YAML and relationship graph evolve separately | Content edits without source revision update, duplicate IDs, missing nodes, duplicate YAML keys | SHA-256 content lock and explicit failing validation |
| R03 High: source statements overlap or contradict | Flow lifecycle convention versus currently injected handover prompt | Compaction permitted by target, prohibited by runtime instruction | Record both versions; choose through owner-approved transition, test both paths |
| R04 High: active merge gate lost | Bun-generated CI, ratchet and branch status checks | Remove Bun before new job is required | Parallel CI, exact status-check migration, rollback available |
| R05 High: stale JJ base accepted | Flow src/vcs.ts and src/tasks.ts | Integration head moves after driver starts; unrelated commit appears at delivery head | Exact base check, ancestry, conflict and fast-forward/clean state verification |
| R06 High: spoofed agent authority | Flow roles, Linear account/app identity | Driver posts 'approved by main' in a comment | Principal identity and permissions checked from signed/API identity, not comment text |
| R07 High: lost agent message | Flow immutable thread queue and Pi wake transport | Webhook never arrives, restart mid-consumption, duplicate event, stale process | Durable inbox + idempotent receipt + token fenced single owner + reconciliation |
| R08 High: self-certifying review | Flow src/reviews.ts | Coder issues APPROVE for its own revision; approval reused after commit changed | Independent reviewer and matching exact clean revision/CI evidence |
| R09 High: wrong acceptance proof | Bun/ATDD structural traceability | Test has correct acceptance ID but asserts unrelated trivial condition | Semantic review + meaningful tests + required integration evidence |
| R10 High: conflicting rule disposition | ATDD Python dispositions vs Bun strict all-profile gate | Advisory becomes strict (or inverse) after resolver migration | Preserve metadata.disposition and distinguish policy from detection; explicit owner-approved change |
| R11 Medium: false impact analysis | Bun coarse affectedProfiles, Python import/reexport/dynamic loading | Dynamic import or config change escapes reverse-dependency graph | Confidence signal and conservative broader verification |
| R12 Medium: too many irrelevant rules | Large convention graph; weak models overloaded | Task activates all coder or planner profiles | Fine selectors, bounded context, explain matching paths/terms and flag truncation |
| R13 Medium: test invocation injection | Agent suggests arbitrary pytest flags and paths | Leading --option, absolute path, .. traversal, symlink escape | Explicit repository-relative Python targets, argument array, no shell, bound timeout |
| R14 Medium: Linear projection overwrites humans | atdd-linear sync protects user notes and owns certain fields | Agent sync overwrites project, cycle, assignee, human comments | Field ownership contract, idempotent PATCH, conflict detection, preserve notes |
| R15 Medium: status sync lies | A test result is attached to a different commit/issue | Replay old passing JUnit result | Bind evidence to issue, acceptance ID, commit and trusted CI run |
| R16 Medium: plugin coupled to Python executable | Pi extension executes Python kernel | Wrong interpreter or missing PyYAML/pytest | Clear diagnostics, preflight, published packaging and pinned versions |
| R17 Medium: treatment versus binding confusion | atdd/enforce/dispositions.py explicitly separates namespaces | Treat 'bound' as 'strict' or vice versa | Typed distinct fields, unknown values fail closed |
| R18 Medium: tests suppress legitimate alternatives | Python FastAPI missing-auth convention checks a particular Depends pattern | Correct global authorization middleware rejected by static form checker | Preserve strict rule until approved alternative realization and independent evidence; no auto bypass |

## First PR tests

The first slice deliberately addresses R02, R12, R13 and the no-silent-waiver part of R10. Tests use an exact snapshot of three canonical convention YAML files from atdd-extensions commit 3aa141ecca1bf96d38964c1b8d4cf2e62b8efdfe. The small relationship fixture contains an upstream-authored nplus1 -> performance requires edge; it is **not** the production catalog.

* Positive: security route activates auth convention; N+1 task activates performance principle via requires edge.
* Negative: docs-only edit returns 'unresolved', not 'no applicable conventions'.
* Negative: missing graph endpoint, duplicate YAML key, altered locked source and unknown selected rule fail.
* Positive/negative: only chosen pytest node executes; a different failing test remains unselected; explicit failing test returns failed evidence.
* Negative: option/path traversal/missing test file cannot be passed to pytest.
* Pi smoke: entrypoint registers hooks; unconfigured repositories are left alone.

## Remaining mandatory tests before replacing Flow/Bun

* Real canonical graph load, schema/fingerprint parity and treatment audit across all enabled profiles.
* Explicit test of an accepted implementation alternative that proves the same invariant and one invalid alternative that is rejected.
* JJ: new/dirty/stale bookmark, non-colocated repo, nested coordinator, wrong integration base, multiple drivers, revoked permissions, concurrent worktree creation.
* Messaging: crash between queue intent and message publication; duplicate webhook; process handover during delivery; lost wake; out-of-order retry; model rate limit mid-review.
* Linear: wrong team/project and cross-account link, wrong app actor, pagination, conflict/human note preservation, idempotent replay and missing authorization.
* Cutover: old and new checks side-by-side at the same commit; no undocumented waiver; generated artifacts owner-marked, required status replaced, rollback verified.
