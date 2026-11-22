# ATD-36 — Seat bootstrap for launcher-started sessions

Linear: ATD-36 (team ATDD). Builds on PLT-117 (seat lifecycle) and PLT-118 (attention routing).

## Problem

A session launched with the attention variables (`PI_ATDD_ATTENTION_*`) but without a standalone
execution seat (`PI_ATDD_EXECUTION_*`) fails closed. Every attention tool returned only
"ATDD attention seat is not authorized", which did not say what was missing.

## What changed

- **Refusal names the gap.** When no seat is bound, the refusal lists the missing
  `PI_ATDD_EXECUTION_*` variables (`seatAuthorizationRefusal`, `missingExecutionVariables` in
  `src/execution-seat.ts`). A partial binding names only the variables that are missing.
- **Startup warns.** With `PI_ATDD_ATTENTION_ROLE` set and no seat, the session shows a warning
  at `session_start` naming the same variables (`src/execution-pi.ts`).
- **Still fail-closed.** Authorization logic is unchanged. A seat bound to another session, or a
  stale one, still refuses; the message then says the seat is not owned by this session.
- **Launcher-callable bootstrap.** `atdd seat bootstrap` (`src/seat-bootstrap.ts`) provisions the
  generation-1 standalone lease from `PI_ATDD_EXECUTION_*`. It reads the environment only, is
  idempotent for the exact same binding, refuses any other binding for the same seat with
  "seat already assigned" (a different session or a different execution id), and never prints the
  owner token.

## Launcher contract (proposed; not applied)

`~/.config/rex/af8/atdd-launch.sh` is outside this repository and is not edited here. The
proposed change, for its owner to apply, before `rex window new`:

1. **Run id, fresh per launch.** `RUN_ID` is a random UUID generated for each launch (for example
   `uuidgen | tr A-Z a-z`). It is never built from a timestamp, because a second-precision timestamp
   is not unique per launch. Use it for both:
   - `PI_ATDD_EXECUTION_EXECUTION_ID=$RUN_ID` (coach and worker), and
   - `PI_ATDD_ATTENTION_EXECUTION_ID=$RUN_ID` (worker only). This replaces the timestamp-based id
     the launcher builds today. The attention route compares it with the execution id, so the two
     must be the same value.
2. **Session id.**
   - New session: a fresh UUID. Pass it to Pi as `--session-id $SESSION_ID` and export
     `PI_ATDD_EXECUTION_SESSION_ID=$SESSION_ID`.
   - `--session FILE` relaunch: the id is read from the session file header (first line, field
     `id`), not generated, so Pi's session id stays the same as before.
3. **Owner token, fresh per launch.** `PI_ATDD_EXECUTION_OWNER_TOKEN` is a random token, not written
   to logs.
4. **Remaining seat variables:** `PI_ATDD_EXECUTION_MODE=standalone`, `PROJECT_ID=$PROJECT`,
   `TASK_ID` (`*` for a coach, the task for a worker), `COACH_ADDRESS` (equal to
   `PI_ATDD_ATTENTION_COACH_ADDRESS`), `SEAT_ADDRESS` (the coach address for a coach, a seat name for
   a worker), `MODEL_ID` (from `model-tier`), `GENERATION=1`.
5. **Bootstrap, then launch.** Run `atdd seat bootstrap` with that environment, and abort the launch
   if it fails. Then pass the same variables to `rex window new`, as the existing `ENV` array does.

## Known limits and open decision

- **Relaunch of an existing seat is not covered by this proposal.** A `--session FILE` relaunch
  whose seat already has a lease gets a new `RUN_ID` and owner token, which do not match the lease.
  Bootstrap then refuses with "seat already assigned" (tested), and Pi blocks tool calls
  (fail-closed). The owner must choose one of these before the launcher change is applied:
  - (a) the launcher skips bootstrap for an existing lease and Pi resumes through the PLT-117
    recovery path (`PI_ATDD_EXECUTION_RESUME=1` from a verified checkpoint), or
  - (b) the launcher refuses `--session FILE` for a seat that already has a lease.
  Neither is implemented here.
- A successor after a handoff or crash uses the PLT-117 handoff or recovery path, never a second
  bootstrap.
- The model id is recorded at bootstrap and updated on a model switch. The launcher must supply a
  non-empty value.

## Verification

`tests/seat-bootstrap.test.ts` covers:

- ATD-36 A01: refusal and startup name the missing variables.
- ATD-36 A02: a launcher-bootstrapped session is authorized; the CLI is idempotent and never prints
  the owner token; a second launch with a different execution id cannot adopt the lease; the launcher
  proposal in this document uses a fresh random UUID per launch, never a timestamp, and reads the
  session id from the file header on relaunch.
- ATD-36 A03: stale or foreign seats still refuse.

A02 is not verified end to end until the launcher change is applied and a launcher-started session
is observed calling `attention_list`.
