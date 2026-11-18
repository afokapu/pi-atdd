# Adapter contracts for later PRs (not implemented in PR 1)

All adapters are replaceable. The agent runtime and graph kernel must never assume that the UI/work tracker is Linear. These contracts describe design requirements, not completed code.

## WorkProvider (Linear in V1)

- getTask(taskId): stable ID, source acceptance refs, scope, state, permissions, concurrency/version token, external URLs.
- claimTask(taskId, actor, expectedVersion): atomically establish accountable worker, without treating a username in a comment as proof of identity.
- publishActivity(taskId, actor, kind, evidenceRef, dedupeKey): idempotent progress, blocker, review request, approval or return with bounded text.
- recordReview(taskId, revision, reviewerPrincipal, verdict, evidence): APPROVE/RETURN/ESCALATE tied to the exact immutable code revision; reject self-approval.
- completeTask(taskId, revision, expectedVersion): only after independent mandatory evidence; preserve human-owned fields/comments.

Linear issue/project state is authoritative for scheduling/assignment. The versioned repository plan remains authoritative for the normative behavior required by its acceptance criteria. Synchronization must declare field-by-field ownership (not assume two-way writes).

## ConventionProvider

- resolve(task, paths, operation, sourceDigest) returns stable rule IDs, statements, provenance, activation evidence, and mandatory prerequisite closure.
- unresolved applicability is an error or warning requiring review, not a successful empty answer.
- treatments remain the upstream strict/advisory/suppress-and-clean/documentation-only values until explicit policy migration.
- proposeAlternative(rule, implementationEvidence, reviewer): a proposed realization does not mutate canonical YAML and cannot self-waive invariants.

## WorkspaceProvider (Jujutsu)

- createDriver(taskId, coordinatorId, exactIntegrationHead, workspacePath) checks immutable parent revision and uses explicit JJ workspace/bookmark operations. Never infer the base from a mutable branch name.
- inspect(workspace) reports actual revision, dirty/working state, colocation and ancestry.
- returnDelivery(deliveryRevision, targetIntegrationRevision) refuses stale/mismatched bases and unresolved conflicts; reviewer evidence is bound to deliveryRevision.
- mergeToMain requires a separately authorized main principal and current evidence; a Linear comment is not merge authorization.
- retire(workspace) refuses unmerged or active work, never discards another agent's state.
- No automatic nested integration coordinator. One primary main authority.

## Local delivery transport

- publish(messageId, fromPrincipal, toRunId, taskId, payloadRef, dedupeKey) persists before notifying.
- receive(runId, ownerToken) claims only records belonging to the exact live recipient; replacement invalidates old ownership.
- acknowledge(messageId, runId, outcome) idempotently completes delivery; processing/review is a separate task event.
- reconcile() recovers missed notifications and crash windows with bounded retries and no prompt storms.
- Long-form decisions and human-readable status go to WorkProvider; process wakes, transient queues and receipts remain local.

## VerificationProvider

- select(scope, changedPaths, sourceGraph, acceptances) returns targets plus coverage/confidence. Unknown dynamic dependencies require broader checks.
- run(targets, revision) executes language-specific tests with no shell interpolation and returns immutable structured evidence.
- fullGate(revision, immutablePolicy) independently verifies merge-blocking invariants in CI. The Pi model cannot be the only verifier.
- Evidence joins taskId + acceptanceId + exact revision + test identity + trusted CI run, never just a green emoji or comment.

## Operational safety

- Interface state changes require idempotency keys and explicit principal identity.
- External webhook events are untrusted until signature, tenant/team, event ID and target issue are verified.
- Avoid copying raw source, test output or credentials into Linear comments; send bounded evidence references and redacted summaries.
- Failure defaults: unresolved convention or dirty workspace does not silently proceed to reviewed/completed; disconnected Linear does not lose local work; absent Pi session cannot consume a message.
- Every adapter gets a mocked provider contract test and a fault-injection test before first production task.
