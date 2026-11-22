# ATD-36 — Seat bootstrap and the canonical launch

Linear: ATD-36 (team ATDD). Builds on PLT-117 (seat lifecycle) and PLT-118 (attention routing).

## Problem

A session launched with the attention variables (`PI_ATDD_ATTENTION_*`) but without a standalone
execution seat (`PI_ATDD_EXECUTION_*`) fails closed. Every attention tool returned only
"ATDD attention seat is not authorized", which did not say what was missing. The AF8 launch script
also set only the attention half.

## What changed

**Slice 1 (PR #38): refusal names the gap, seat bootstrap command**

- **Refusal names the gap.** When no seat is bound, the refusal lists the missing
  `PI_ATDD_EXECUTION_*` variables (`seatAuthorizationRefusal`, `missingExecutionVariables` in
  `src/execution-seat.ts`).
- **Startup warns.** With `PI_ATDD_ATTENTION_ROLE` set and no seat, `session_start` shows a warning
  naming the same variables (`src/execution-pi.ts`).
- **Still fail-closed.** Authorization logic is unchanged. A seat bound to another session, or a
  stale one, still refuses.
- **`atdd seat bootstrap`** (`src/seat-bootstrap.ts`) provisions the generation-1 lease from
  `PI_ATDD_EXECUTION_*`. Idempotent for the exact same binding; any other binding for the same seat
  is refused with "seat already assigned". It never prints the owner token.

**Slice 2 (stacked draft PR): the canonical launch**

- **`atdd launch`** (`src/launcher.ts`, wired in `src/cli.ts`) is the only supported way to start a
  governed session. It sets the profile, mode, role, identity and attention route, creates a fresh
  execution id shared by the route and the seat, bootstraps the standalone seat with `bootstrapSeat()`
  (coach task `*`, generation 1, session id from the session header), and only then starts `pi`.
- **Refusal.** It refuses before anything is written when either half is incomplete (attention route
  or execution seat), and it names every missing input (`--profile`, `--agent-dir`, `--task`, ...).
- **Dry run.** `atdd launch --dry-run ...` prints the plan. The owner token is shown as `<redacted>`.
- **Rule for every profile: never bare `pi`, never a hand-written env line.** Start governed agents
  only through `atdd launch`.

## Launch usage

```
atdd launch --role coach|worker|reviewer --label LABEL --profile PROFILE --project PROJECT \
  --coach COACH_ADDRESS --agent-dir ABSOLUTE_PI_AGENT_DIR [--task ATD-n] \
  [--model PROVIDER/ID | --tier low|medium [--via FAMILY]] [--cwd DIR] [--session FILE] [--dry-run] [-- PI_ARGS...]
```

- `--model` is explicit; otherwise `model-tier <tier>` resolves it (coach defaults to `medium`,
  worker and reviewer to `low`).
- Run ids: `PI_ATDD_EXECUTION_EXECUTION_ID` (and, for worker and reviewer, `PI_ATDD_ATTENTION_EXECUTION_ID`) are the same fresh random UUID per launch. Never a timestamp.
- Session id: a fresh UUID passed to Pi as `--session-id`. With `--session FILE`, the id is read from the session file header, and Pi receives `--session FILE`.
- Owner token: a fresh random value per launch, never printed.
- `MODEL_ID` is `provider/model` (for example `pi-claude-cli/claude-haiku-5-5`).
- `--label` becomes the session's attention identity (`PI_ATDD_ATTENTION_IDENTITY`).

### Starting workers and reviewers from a coach

A coach starts workers and reviewers by running `atdd launch` from its own shell. The coach's
process already carries its route, and the launcher uses it as authority:

- only a coach may start a governed session from a governed session;
- a coach may not start another coach;
- the new session must use the coach's own project and coach address.

Because pi runs in the foreground, the coach's shell waits until the worker or reviewer exits. A
background window (for example through rex) is a follow-up, not part of this slice.

### Startup refusal (session_start)

With `PI_ATDD_ATTENTION_ROLE` set, `session_start` refuses when the attention route is incomplete, and
also when a complete route has no execution seat. The refusal names each missing setting and blocks tool
calls until the session is started through `atdd launch`.

## AF8 launcher script: stopgap to retire

`~/.config/rex/af8/atdd-launch.sh` is a **stopgap to retire** once `atdd launch` is adopted. It sets
only the attention variables today, so its sessions are refused until the seat is bootstrapped.
This repository does not edit it, and nothing under `~/.config` is changed here. Its owner replaces
its `pi` invocation with `atdd launch` and removes the hand-written environment.

## Known limits and open decision

- **Relaunch of an existing seat is not covered.** A `--session FILE` relaunch of a seat that already
  has a lease gets a new execution id, which does not match the lease. Bootstrap then refuses with
  "seat already assigned" (tested), and Pi blocks tool calls (fail-closed). The owner must choose
  before the relaunch path is used:
  - (a) skip bootstrap for an existing lease and resume through the PLT-117 recovery path
    (`PI_ATDD_EXECUTION_RESUME=1` from a verified checkpoint), or
  - (b) refuse `--session FILE` for a seat that already has a lease.
  Neither is implemented here.
- A successor after a handoff or crash uses the PLT-117 handoff or recovery path, never a second
  bootstrap.
- The coach-tool form of the launcher (an agent-callable tool) is not implemented; the CLI is the
  supported entry point for now.

## Verification

`tests/seat-bootstrap.test.ts` (slice 1) covers ATD-36 A01 (refusal and startup name the missing
variables), A02 (a bootstrapped session is authorized; the CLI is idempotent and never prints the owner
token; a different execution id cannot adopt the lease; the run id is a UUID, never a timestamp) and A03
(stale or foreign seats still refuse).

`tests/launcher.test.ts` (slice 2) covers A04 (a coach and a worker from `planLaunch` are authorized after
bootstrap; a relaunch keeps the file's session id; the CLI starts pi with the planned session id and a
bootstrapped lease), A05 (a refused launch names the missing route or seat inputs and writes no lease),
A06 (two launches get different execution ids and owner tokens), A07 (the dry run never prints the owner
token; this rule and the stopgap note are written here).

A02 is not verified end to end against the AF8 launcher until that launcher is retired in favour of
`atdd launch` and a launched session is observed calling `attention_list`.
