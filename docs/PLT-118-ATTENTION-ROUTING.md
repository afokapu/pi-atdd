# PLT-118 — Task-addressed attention, coach activation and recovery

Parent: [PLT-117](https://linear.app/forge100/issue/PLT-117).
Implementation: [PLT-118](https://linear.app/forge100/issue/PLT-118).
This design extends, rather than replaces, the PLT-101 Attention Strip.

## Visual summary

```mermaid
sequenceDiagram
  participant A as Worker or Reviewer A
  participant S as Signed task-scoped spool
  participant C as Accountable Coach seat
  participant R as Task delivery receipt
  participant B as Worker B (successor)
  A->>S: Raise signed item with task and coach route
  S->>C: Pi polls and checks current seat lease
  alt Current Coach is authorized
    C->>C: Coalesced Pi follow-up wakes idle Coach
    C->>S: attention_list; decide within grant
    C->>S: Atomic signed resolution
  else Seat absent or stale
    Note over S,C: Durable item stays pending; no foreign Coach receives it
  end
  B->>R: Read task-level settled-turn delivery receipts
  B->>S: Fetch pending resolution revisions for same task
  S-->>B: Inject resolution on next authorized turn
  B->>R: On settled turn, persist receipt
```

## Identity and boundary

- `profile` is the existing profile isolation boundary.
- One project Coach can receive separate items for multiple tasks. Its logical seat may be project-scoped (`taskId=*` in the PLT-117 execution binding), while every individual attention item retains a concrete task ID.
- `projectId`, `taskId` and `coachAddress` are stamped by the
  **trusted launcher**, never by the model's `attention_raise` parameters.
- `sourceExecutionId` identifies the originating worker/reviewer attempt.
  A later worker with the same authorized task can receive its decision.
- The runtime seat lease belongs to PLT-117; `pi-atdd` delegates authority
  to that adapter and fails closed for a routed session without an owner.
- The optional Linear issue reference is descriptive, not a recipient.
- `reviewer` uses the same attention-raising capability as `worker`.

The signed event remains the authoritative record; a Pi hidden session entry
is a cache for UI reconstruction. A coach action reads the current spool under
a filesystem lock, verifies item ownership and revision, writes the signed
state first, then updates the hidden session state. A same-user process with
access to the HMAC key remains a documented PLT-101 security limitation.

## State and notification behavior

**Given** two coaches in the same profile, **when** a worker raises an item
for coach A, **then** coach B does not see its content in the widget,
`attention_list`, model context or state transition tools.

**Given** a newly raised item, **when** the accountable Coach Pi process
polls the spool, **then** it sends one model-visible Pi-native follow-up
with `triggerTurn: true`; an idle coach starts a turn and a busy coach
receives the follow-up when it settles. Repeated polls do not re-notify
the same item. Each coach turn receives a bounded list of actionable items.

**Given** a coach session replacement, **when** the verified current seat
starts, **then** its spool scan reconstructs unresolved items without
depending on the predecessor's session JSONL.

**Given** a resolution for a worker that has since been replaced,
**when** a new authorized worker begins the same task, **then** the signed
resolution is delivered in context. A successful settled turn publishes
the task-scoped revision receipt for subsequent worker sessions.

**Delivery guarantee:** durable state transitions are serialized under
a single writer lock. In normal settled runs each revision is delivered
once across worker replacements. If an agent crashes after seeing context
but before its settled-turn receipt is committed, the resolution may be
replayed. That replay is intentional at-least-once recovery; exactly-once
LLM processing across crashes cannot be guaranteed.

## Legacy records and migration boundary

Old PLT-101 items have no `route`. New scoped coaches never receive them,
even if they share the same Pi profile. `attention_quarantine_status`
exposes only a count of such verified live records; the Coach UI warns when
that count changes. Summaries cannot be shown or arbitrarily assigned
without an owner-reviewed migration. The original unscoped role remains
available for authorized legacy handling.

No existing item is automatically rewritten and no new hosted queue,
Flow Desk copy or Linear task database is created.

## Verification

- `tests/attention-routing.test.ts`: pure launcher-bound route and
  coach/task matching.
- `tests/routed-attention.test.ts`: two coaches, unauthorized seat,
  reviewer, idle/busy follow-up, durable resumption, task-level receipts,
  quarantine and backward compatibility.
- `tests/attention-strip.test.ts`: PLT-101 baseline for types, TTL,
  HMAC, trust, restart and owner-answer scope.
- `npm run smoke:attention`: isolated real Pi RPC extension-load and
  command-discovery check. Does not make LLM model calls.
- GitHub CI: `npm run check`, `smoke:catalog`, `smoke:pi`,
  `smoke:attention` and `smoke:install`.

Known limits: same-OS-user HMAC key sharing; no automatic migration of
ambiguous legacy recipients; no provider rate-limit test; no parity claim
for Claude Code/Codex (PLT-116 separately governs those hooks).
