# Changelog

Headings use Pi's format (`## [x.y.z] - YYYY-MM-DD`), so Pi can read this file for its changelog notices. Pi 1.5.2 does not show a notice for a plain pin bump; see `docs/RELEASE-0.4.0.md`.

## [0.6.2] - 2026-11-28

### Fixed

- Convention pages no longer omit the same low-ranked rules every turn: task guidance is tracked per rule, omitted rules are carried to later turns, and the post-tool redelivery cap is replaced by a bounded 256-entry queue with an explicit overflow notice. Non-blocking pages no longer promise a retry that cannot deliver the omitted rules. Rules are delivered once; a still-active rule is redelivered only when its proof changes. (ATD-46)

## [0.6.1] - 2026-11-28

### Fixed

- Resolved or reassigned attention items are no longer re-announced by the poll and wake path; a reopened item is announced once. Already-queued wakes and the read-to-delivery race remain limits. (ATD-53)

## [0.6.0] - 2026-11-28

### Changed

- **BREAKING:** Removed external (Flow-owned) seat mode and `ownsFlowExecution`. `PI_ATDD_EXECUTION_MODE=external` now refuses startup with `external seat mode was removed in 0.6.0; start with atdd launch`. (ATD-50)

### Removed

- CI no longer checks out atdd-bun or atdd-flow or runs `smoke:catalog`; a vendored lock-based drift test replaces it. (ATD-50)

### Fixed

- Idle attention refresh no longer warns `durable ATDD state is locked` on brief collisions: it uses lock-free reads, a bounded wait, and one warning for a stuck lock. (ATD-47)

## [0.5.1] - 2026-11-28

### Fixed

- Automatic 85% handoff in jj-colocated repositories: records are written outside the working copy, with a validated directory chain and recovery from both stores. CI runs a smoke test with pinned jj-cli. (ATD-48)

## [0.5.0] - 2026-11-27

### Added

- A plan under `plan/pi-atdd` with 109 declared acceptances and test bindings.
- Generated activation selectors and profile-aware root resolution.
- A delivery-gate smoke combining type checks, tests and real Pi loads, plus a human reviewer checklist for draft migration claims.

### Changed

- Profile vocabulary v4 retains v3 aliases.
- The plan uses the capability layout; the `src/` and `tests/` layout moves remain unfinished.

## [0.4.0] - 2026-11-22

First versioned Pi package. Install with `pi install git:github.com/afokapu/pi-atdd@v0.4.0`; upgrade by bumping the pinned tag. Licence status and open items: `docs/RELEASE-0.4.0.md`.

### Added

- Mode by intent: `set_atdd_mode` tool and ATDD-repo guard; the ATDD or plain choice is remembered per repo.
- Model tiers by role: rules, resolver, brief lint and agent helper.
- Coach convention: named instances, action tiers, orchestrate-not-build.
- Attention Strip: typed worker-to-Coach attention, routed by task and Coach.
- Automatic context handoff at 85% usage, and automatic context renewal for Coach and workers.
- Optional Coach state section in shared handoff records.
- Every code-changing task is bound to a tracker issue; the tracker check is configuration-driven.
- Stack-neutral core conventions with a Bun realisation.
- Execution seats are resumable across seats, with fenced ownership.
- Split-part legacy aliases resolve to their loaded rules.
- Attention list details, a mid-run checkpoint, and no duplicate replay.
- Local activation telemetry: a bounded, privacy-safe record of which conventions were inspected, activated, missed or delivered.
- Structural discovery facts derived from source syntax (Bun routes and test URN syntax), available in the installed Pi runtime.
- CI runs the tracker-issue check on each pull request as a non-blocking notice (exit 3 is a notice, not a failure).

### Changed

- Profile-first convention ids and `shared.convention.propose`.
- Vocabulary rename (pi-atdd PR #26). Tag `v0.3.0` was cut from that change without a `package.json` bump; this release is the first whose version matches its tag.
- Bundled sources are pinned by id and digest; smoke tests use isolated Pi profiles.
- Coach relaunch uses a real busy/idle signal.
- Post-tool reconciliation is bounded: capped output, build output skipped, read-only, redelivery counts cleared on reset.

### Fixed

- Planner coverage conventions are committed (they were hidden by the `coverage/` ignore).

## [0.2.0] - 2026-11-19

ATDD-Bun baseline, frozen. See `docs/RELEASE-0.2.0.md`.

### Added

- Graph delivery fixes, convention sidecar pinned to the canonical YAML, and D008 pilot-validity docs.
