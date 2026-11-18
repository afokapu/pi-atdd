# Policy extraction candidates — proposed, not activated

Principle: if existing code encodes WHAT is permitted or expected, consider a convention. If it verifies current reality, owns atomic state transitions, or prevents concurrent writers, it stays code. A proposal is not permission to weaken upstream rules.

| Candidate | Current source of truth | Proposed declarative obligation | Must remain executable | Migration danger |
|---|---|---|---|---|
| P01 Integration topology | atdd-flow/conventions/atdd-workflow.workflow/...lifecycle.convention.yaml; src/seats.ts; src/tasks.ts; src/vcs.ts | One main coordinator; named coordinator owns integration/<stream>; drivers derive delivery from exact integration parent, return to coordinator, coordinator delivers reviewed integration to main | Resolve JJ/Git exact refs, create/validate workspaces, assert ancestry and clean/stale state | A matching branch string alone does not prove exact lineage |
| P02 Role authority | atdd-flow/src/tasks.ts, src/seats.ts, src/reviews.ts, src/owner-inspection.ts | Explicit responsibilities for creating, transferring, reviewing and merging work; no impersonated operator approval | Signed/recorded authorization, optimistic update checks, PR permissions and revision binding | Linear assignee != authorized process owner |
| P03 Smallest effective change | atdd-flow/conventions/atdd-flow.collaboration; workflow.lifecycle; src/judgment.ts | Satisfy required acceptance with minimal scope; avoid speculative adjacent refactoring | Change-impact calculator, reviewer evidence, exception handling | An absolute file/line cap can outlaw legitimate small semantic changes |
| P04 Review semantics | atdd-flow/src/reviews.ts; atdd-bun/conventions/atdd-bun.review/** | Independent behavioral reconciliation after deterministic evidence, APPROVE/RETURN/ESCALATE, decision bound to exact revision | Compare head, CI, reviewer identity, evidence existence, prevent stale approvals | Green static checks do not prove behavior, and approval for an earlier commit is stale |
| P05 Reliable communication | atdd-flow/src/threads.ts, extensions/pi/index.ts, src/runtime-state.ts, src/reconcile.ts | Messages have explicit sender/recipient/run, immutable ID, receipt, retries and bounded escalation | Atomic queue publication, idempotency, token-fenced ownership, periodic reconciliation | Linear comments/mentions alone don't ensure a running Pi process received work |
| P06 Model routing | atdd-flow/src/judgment.ts, src/pi-wake.ts, src/seats.ts | Prefer weakest sufficient model, escalate when uncertain; review uses adequate capability | Portfolio availability and live Pi model switch, handle rate limits | A policy should not require self-assessment to guarantee correctness |
| P07 Handover | atdd-flow/conventions/atdd-workflow.workflow/...lifecycle; src/handover.ts; src/collaboration-policy.ts | Bounded handover with exact IDs, resume verification and no lost outstanding tasks | Context monitor, compaction/successor, session-binding ownership, recovery record | Target policy mentions same-session compaction while currently injected threshold prompt says do not compact |
| P08 User-owned vs generated fields | atdd-linear/src/sync.ts, src/notes.ts, atdd-flow/src/linear-mirror.ts | Specification owns normative acceptance; Linear owns assignment, priority, comments, task status and human intent | API synchronization, immutable mapping, pagination, retries and conflict detection | Existing mirror is Flow-to-Linear only; authority reversal must be explicit |
| P09 Micro commits and scoped verification | atdd-bun/src/hooks.ts | Prefer small independently verifiable PRs; select tests based on actual blast radius | Changed-file graph, imports, risk level, test runner, CI | Existing defaults cap staged files/changed lines/commits per push; hard caps may be arbitrary |
| P10 Convention alternatives | atdd/enforce/dispositions.py; upstream YAML metadata | Alternative realization is allowed only when it meets the original obligation and provides evidence | Semantic proof/acceptance checks, independent reviewer | Automatically downgrading strict to advisory invalidates the original contract |
| P11 Traceability and proof | atdd-bun/src/planner-kernel.ts, detectors/**; atdd-linear/src/evidence.ts | An acceptance must have meaningful executable witness | TypeScript plan parser, markers, test runner, and reviewers that challenge assertions | A test binding can be structurally valid and still assert unrelated behavior |
| P12 Source integrity | atdd-bun/src/integrity.ts; atdd/substrate/** | Rules and checkers cannot be silently mutated to achieve green | SHA locks, trusted provenance, CI pinned policy and protected required checks | An instruction-only mechanism can be bypassed by arbitrary shell edits |

## Already written versus new conventions

P01, P02, P03, P04, P05 and P07 already overlap substantial written Flow and review conventions. **Do not create duplicate rule IDs** just to remove Flow-specific names. Extract or specialize existing nodes with an explicit relationship to their canonical origins. P06 and P09 contain substantial policy hidden in code. P08 is a new authority contract requiring owner review. P10 is a verification-policy model, not a model-specific escape hatch.

## Evidence and approval protocol

Before adding or rewriting a convention:
1. Record exact source file, source commit and original normative text.
2. Show whether existing graph already expresses the same obligation.
3. Identify default realization, permitted alternatives, non-negotiable invariants and the proof each requires.
4. State upstream severity/treatment and any proposed change as a separate reviewable diff.
5. Add one positive and one negative fixture showing applicability.
6. Test that an alternative cannot waive acceptance/security or bypass independent review.
7. Record the reviewer/owner decision and only then activate the new rule.

The first coding slice reads existing YAML without changing it, and treats a missing applicability selector as a coverage gap.
