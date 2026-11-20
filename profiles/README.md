# Structure profiles (PLT-84)

A **structure profile** is data, not rules. A stack-neutral convention core is written in **roles**
(domain, application, integration, presentation, boundary, composition root, unit/acceptance/e2e
test, plan artifact). Anything concrete it needs, such as a path, a suffix, a URN shape, an idiom or
a tool, comes from the active stack's profile through a **profile key**.

| File | Purpose |
|---|---|
| `vocabulary.yaml` | The **closed** key vocabulary: 8 groups, every key documented. |
| `profile.schema.json` | JSON Schema of a profile file. Generated from the vocabulary by `node --experimental-strip-types tools/profile-vocabulary-schema.ts`; never edit by hand. |
| `src/profile-vocabulary.ts` | Loader, key expansion, `isVocabularyKey`, `proposalProblems` and the schema generator. |

## The eight groups

| Group | Holds | Example key (ATDD-Bun value) |
|---|---|---|
| `roles` | role names, role locations, how a file gets a role | `roles.domain.path` (`**/domain/**`) |
| `roots` | source, test, e2e and plan roots; the never-scanned trees | `roots.excluded` (`node_modules, dist, build, _generated`) |
| `layout` | wagon, feature and commons directories; artifact placement | `layout.feature_dir` |
| `suffix` | file-name suffixes per file kind | `suffix.source` (`.ts, .tsx`) |
| `urn` | URN shapes, and the syntax that binds a file to one | `urn.binding.acceptance` (`// Acceptance: acc:…`) |
| `idiom` | the stack's construct for a neutral concept | `idiom.auth_guard` |
| `enforcement` | stack-wide enforcement facts (runner, default disposition, suppression syntax) | `enforcement.runner` (`atdd-bun`) |
| `tooling` | package manager, lockfiles, languages, test runner, helper commands | `tooling.lockfile.native` (`bun.lock, bun.lockb`) |

Parametric keys (`roles.<role>.path`, `suffix.<file_kind>`, `urn.<artifact>`, `urn.binding.<artifact>`)
accept only the parameter values listed in the group's `params`.

## What is *not* a profile key

These stay with the rule:

* **Per-rule severity and disposition.** They belong to the rule's core `verification`. This resolved
  the PLT-84 pilot conflict on `enforcement.severity` (2 vs 3: two rules, two severities).
* **Detector, validator and finding ids of one rule.** They are part of the stack realization
  (`bunOnly`). The core names the check generically.
* **Rule-specific examples and task terms.** They go in the core activation (neutral) or stay in the
  realization.

`roots.excluded` is **one list per stack**. A rule whose checker owns the exact classification says so
in its own verification. This resolved the pilot conflict on `roots.excluded` (one list phrased four ways).

## Proposing a new key

The vocabulary only grows through a governed path, like `shared.convention.propose` for conventions:

1. **The deriver never invents a key silently.** If no key fits, it adds an entry to `proposedKeys` in
   its output: `{ key, group, meaning, bunValue, whyNoExistingKey }`.
2. **Mechanical check.** `proposalProblems(key)` must return nothing: the key is in one of the eight
   groups, follows `<group>.<name>[.<name>]` in snake_case, and does not already exist. A classification
   target `profile:<key>` must be a vocabulary key or a proposed key; anything else fails the check.
3. **Auditor.** The auditor confirms that no existing key covers the meaning.
4. **Owner approval.** Proposals are collected and de-duplicated across conventions. Only owner-approved
   keys are added to `vocabulary.yaml`, with `version` bumped and the schema regenerated. A convention that
   depends on a pending proposal is not frozen.
