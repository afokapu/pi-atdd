# PLT-96 — code-changing work is bound to an issue in the configured tracker

Status: feature branch, draft PR, not merged. Owner decision 2026-11-19.

```mermaid
flowchart LR
  T[Task implies a code change]:::ev --> Q{Tracker configured?}:::gate
  Q -- no --> N[Notice: exit 3, never a pass]:::warn
  Q -- yes --> I{Issue id in branch and PR body?}:::gate
  I -- no --> F[Fail: exit 1]:::bad
  I -- yes --> P[Pass: bound to tracker issue]:::ok
  classDef ev fill:#dbeafe,stroke:#2563eb
  classDef gate fill:#fde68a,stroke:#d97706
  classDef warn fill:#fef9c3,stroke:#ca8a04
  classDef bad fill:#fee2e2,stroke:#dc2626
  classDef ok fill:#dcfce7,stroke:#16a34a
```

## Problem

`planner.plan.confirm-binds-an-issue` (ATDD-Bun, vendored unchanged) requires a **local** ATDD issue record per repository modification. The external tracker is an optional downstream sync, so code, CI and cloud-config changes could land with no tracker issue the owner can see.

## Rule set

Package-authored under `catalog/pi-atdd/conventions/<profile>/<area>/` (PLT-87 naming, lint N-001 applies).

| Rule id | Profile | Obligation | Selected by | Enforcement |
|---|---|---|---|---|
| `shared.tracker.issue-mandatory` | shared | A code change (repo file, CI, deploy/infra, cloud build config) is bound to a tracker issue before its first change; no issue → ask, create only with approval; id in branch and PR body; status kept current | task-start, code-change terms | **Validator** `atdd tracker check` (branch + PR body + changed paths); CI must run it; status = text |
| `shared.tracker.unconfigured-notice` | shared | No tracker configured → say so explicitly; never pass silently, never invent a tracker or id | task-start, `tracker` / `issue tracker` terms | **Validator** notice (exit 3) |
| `coder.tracker.issue-in-branch-and-pr` | coder | Branch name and PR body carry the id; status In Progress → Done, blocked = comment | task-start, `pull request` / `branch` / `push` terms | Validator (branch and body); status = text |
| `planner.tracker.issue-before-ratify` | planner | Ratifying a plan binds it to the local issue **and** to a tracker issue | task-start, `ratify` / `decomposition` / `confirm` terms | Text (validator does not read plans) |

Code-changing is **any repository file** (documentation included), classified as `repo-file`, `ci`, `deploy-infra` or `cloud-build` for reporting. Read-only work needs no issue.

## Tracker by configuration

The tracker is named in `atdd-pi.yaml`, never in code:

```yaml
schema: pi-atdd/config/v2
tracker:
  kind: <tracker name>
  issuePattern: '<regular expression matching an issue id>'
```

Absent or empty `tracker:` means **unconfigured**: the check returns `notice`, not `pass`. Invalid `kind` or pattern is a configuration error. `tests/tracker-issue.test.ts` (A4) fails if the module names a tracker product.

## Relationship to `confirm-binds-an-issue`

**Extends, does not contradict.** The local binding stays the iron rule (issue, branch, worktree). `planner.tracker.issue-before-ratify` adds the tracker link and `requires` the local rule (`catalog/pi-atdd/relationships.yaml`). The vendored YAML is byte-identical; the bundled Bun and Flow digests are unchanged.

## Selection and the page-budget decision

- Task start: broad code-change wording selects the obligation and its notice together (review P1). Non-code wording still reports an applicability gap.
- Edit/create: a write to any repository file is code-changing by definition, so `tracker-code-write` selects the obligation and notice on every write (`always`, operations `edit`/`create`). This masks the coder-convention gap for writes, since a tracker rule now matches them.
- **Measured conflict and resolution (separate commit, labelled "budget raise").** PLT-79 (`tests/shell-delivery.test.ts`, t10) requires a blocked write to pass on one retry, which needs the write's whole fresh rule set in one page. Measured for the t10 write:
  - Before (12,000): first page 11,963 chars = header 611 + hierarchy 2,501 + phase 3,044 + tracker mandatory 1,696 + notice 1,480 + binding 2,626. Retry still needs `tester.test.carries-urn-identity` (about 2,600), so the retry is blocked again.
  - Shrink tried first: the obligation cut to one sentence and the notice dropped on edit/create gives a first page of 9,911 chars, and about 12,500 with carries-urn. That still misses 12,000 by about 500 chars; the rest is renderer overhead (source, digest and evidence lines per rule), which a rule cannot shrink.
  - Resolution: the two pre-action budgets (shell preflight and pre-edit) rise from 12,000 to 16,000; the post-tool budget is unchanged. Result: `shell-delivery` 19/19, `npm run check` 137/137, smoke:catalog, smoke:install and smoke:pi pass.
  - Alternative not taken: drop edit/create selection, which the review P1 rejects.
- Change-time enforcement is the validator (`atdd tracker check`, which now fails when `--changed` is omitted) and CI.

## Enforced vs text-only

| Obligation | Enforced | How |
|---|---|---|
| Issue id in branch name and PR body; change set with no id fails | Yes (validator, exit 1) | `atdd tracker check` |
| No tracker configured is visible, not a pass | Yes (exit 3 + message) | `atdd tracker check` |
| Rules selected for coder, planner and coach task starts | Yes (tests) | `tests/tracker-issue.test.ts` A1 |
| Issue status kept current (In Progress / Done) | **No** | Text obligation; no tracker read |
| Issue created or asked for before the first change | **No** | Text obligation |
| Planner links plan to tracker issue | **No** | Text obligation |
| Cloud build settings changed in a console (outside the repo) | **No** | No file to observe |
| Repository-wide CI running the validator | **No** | Not added in this PR; needs a workflow change (owner decision) |

## Verification

- `npm run check`: typecheck and the full suite pass (12 new in `tests/tracker-issue.test.ts`). CI also runs `smoke:catalog`, `smoke:install` and `smoke:pi`; all three pass locally against the pinned upstream checkouts.
- Seeded case: a `src/` change with no issue id in branch or body fails (`A2`); the CLI exits 1.
- Pins follow PLT-98: `vendor/catalog.lock.json` holds the `pi-atdd` digest (`00a1de5f…`, recomputed after rebasing onto PLT-100), and the tests compare ids, kinds, revisions and digests against that file rather than against rule or edge counts. PLT-100's coach rules and edges are kept; `relationships.yaml` now carries both families in one registry.
- The N-004 rename-parity probe now allows exactly one PLT-96 addition by scenario: "set up a jujutsu worktree for the integration branch" activates the tracker rules because the `branch` term matches. Any other new tracker activation fails the test.

## Open questions for the owner

1. Should a CI workflow run `atdd tracker check` on every PR? (Not added here.)
2. Which tracker `kind` and `issuePattern` should this workspace configure? (Not set here: `atdd-pi.yaml` is not changed.)
3. Is docs-only work (`README.md`, `docs/`) also code-changing? The rule says yes, as written. Confirm.
4. Should `tracker check` also read the PR body from the PR itself (GitHub API) instead of a file?

## Pre-existing observation (not changed here)

`package.json` `files` lists `extensions`, `src`, `vendor`, `selectors`, `README.md` but not `catalog/` or `conventions/`. Git-based install (the README's documented path) carries them. An npm tarball would lack the pinned `pi-atdd` source and fail to load. Fix in a separate change.
