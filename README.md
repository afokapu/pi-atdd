# pi-atdd

A **TypeScript-only Pi extension** containing a versioned, offline catalog of ATDD engineering conventions and their authored relationships. The extension does not require Python, a separate ATDD-Bun/Flow checkout, or internet access **at runtime**.

[PLT-64](https://linear.app/forge100/issue/PLT-64) · [Draft PR #1](https://github.com/afokapu/pi-atdd/pull/1) · [Migration program PLT-63](https://linear.app/forge100/issue/PLT-63)

## Included conventions

The package vendors YAML from reviewed source revisions, **byte-for-byte except the `rule_id` field** since PLT-87 (see below):

| Catalog | Commit | Contents |
|---|---|---|
| [ATDD-Bun](https://github.com/afokapu/atdd-bun) | `5945d97e18310e7c862c08e73985400935d21346` | 356 conventions plus the original 508-edge relationship graph |
| [ATDD Flow](https://github.com/afokapu/atdd-flow) | `2a66019a5ecf2b7a9f999ebfa04d04c9f548f19a` | 2 conventions |

The files are committed under `vendor/atdd-bun/` and `vendor/atdd-flow/`. Original folder structures, YAML, terminology, exceptions and disposition are preserved. `vendor/catalog.lock.json` records provenance, while `src/catalog.ts` independently pins content SHA-256 digests.

No network access is needed to resolve rules after installation. A package update can import newer upstream conventions in a reviewed PR; it must pass exact-source parity and graph integrity tests.

**Graph limitation:** the original 508 Bun edges include **44 edges referencing external rule IDs** not present in these two catalogs. They remain visible as unresolved references. A required unresolved dependency blocks its resolution; they have not been invented, ignored or silently waived. The Flow rules are loaded but are not automatically joined to Bun's graph by invented edges.

## Setup and use

A reviewed version can be installed with Pi:

```sh
pi install --local git:github.com/afokapu/pi-atdd@<reviewed-tag>
```

This Git/package installation initially needs access to the package source; **subsequent Pi sessions do not need to reach GitHub or npm to read conventions**. The package contains its own YAML.

For a local development checkout:

```sh
npm install
npm run check
npm run smoke:pi
npm run smoke:install
```

No consumer `atdd-pi.yaml` or sibling repositories are required. The Pi extension automatically uses its embedded catalog and initial activation selectors in trusted projects.

### ATDD or plain (PLT-93)

Each session runs in `atdd` mode (conventions and edit guards) or `plain` mode (the extension stays loaded but injects and blocks nothing). The mode is resolved in this order:

1. Explicit words in your message: "plain", "plain mode", "no ATDD", "without ATDD" → plain; "use ATDD", "with ATDD" → atdd.
2. `PI_ATDD_MODE=plain|atdd` (agents and fleets set this).
3. The repository record `.atdd-pi/mode` (gitignore or commit it, as you prefer).
4. A repository that declares ATDD (`atdd-pi.yaml` or a `plan/` directory) → atdd, no question.
5. Otherwise an interactive (TUI) session asks once, "ATDD or plain?", and can remember the answer for the repository. Print, JSON and RPC runs never ask and default to atdd.

`/atdd on`, `/atdd off` and `/atdd status` switch or show the mode within a session; a change is announced in one line. Outside a repository nothing is injected and edits are not refused; an edit target outside the repository is also allowed in both modes, unless it physically resolves back into the repository.

The standalone TypeScript CLI can also query the catalog without Pi:

```sh
npm run atdd -- context --task "Review integration branch" --path src/workspace/driver.ts --operation edit
npm run atdd -- verify --target tests/payments.test.ts
```

The first command returns 3 if no selector matches; that means an **applicability gap**, not permission to ignore conventions. The tests are targeted; independent CI must still perform mandatory gates.

## Adding conventions

Keep bundled upstream rules unchanged. Additional rules can be authored separately in the project or bundled in a later reviewed package release.

For project-specific additions, create `extra/conventions/local.checkpoint.convention.yaml` and optionally `extra/relationships.yaml`, using the existing convention YAML format. An extra relationship may refer to an existing bundled rule.

Declare an additive catalog and selectors:

```yaml
# atdd-pi.yaml, optional
schema: pi-atdd/config/v2
extraSources:
  - id: my-project
    kind: extension
    path: extra
    sha256: <exact-sha256-of-extra>
extraSelectors:
  - extra-selectors.yaml
```

Use `npm run atdd -- digest --source extra --kind extension` in a development checkout to compute the hash. Define `extra-selectors.yaml` with `schema: pi-atdd/selectors/v1` and `selectors: [ ... ]`. IDs must be unique; no supplied custom source can overwrite an existing bundled convention. A source hash change requires deliberate revalidation.

`sources:` and `selectors:` remain supported for explicit testing/migration overrides, but are not needed for normal installation. New package-wide conventions should be added as reviewed, versioned YAML and tested for graph references and applicability.

## Current scope and exclusions

Implemented: TypeScript graph parser, locked offline bundle, on-demand context resolution through Pi, pre-edit guidance, explicit test runner, Given/When/Then acceptance records validated against ATDD-Bun V2, real Pi package-install smoke, source-level migration ledger and adversarial tests.

Not yet proven: complete rule activation for all 358 nodes, closure of external graph dependencies, extraction of code-embedded policies, acceptance traceability parity, Jujutsu integration branches, durable agent messaging, Linear integration, or a safe consumer cutover. Existing ATDD-Bun and Flow consumers remain unchanged. PR #1 is a draft; **do not treat catalog presence as full graph or verification parity**.

[Acceptance audit](docs/ACCEPTANCE-AUDIT.md) · [Migration ledger](docs/MIGRATION-LEDGER.md) · [Code-to-convention candidates](docs/CONVENTION-CANDIDATES.md) · [Adversarial checks](docs/ADVERSARIAL-TEST-PLAN.md)


## PLT-69 — incremental inference (stacked draft PR #2)

The Pi adapter now uses a **positive, typed, provenance-aware inference engine** instead of keyword/path matching alone. Existing selectors emit explicit evidence facts; TypeScript inference derives applicable rules and transitive mandatory requirements. Adapter-authored facts include observed task/operation/file/layer and (only from a trusted provider) phase/authority. Absent facts remain UNKNOWN, not false or waived.

The engine materializes finite recursive positive rules, keeps independent proof supports, and performs dependency-directed deletion plus local rederivation to remove obsolete evidence—including recursive cycles without surviving base facts. The original offline Bun/Flow YAML, dispositions, and 508 relationship edges remain byte-identical; the 44 external references are still reported and missing mandatory dependencies make a context INCOMPLETE.

Pi sends the relevant original guidance, canonical source, provenance digest, proof facts and authored relationship reasons within a bounded context. First-edit guidance is not an enforcement claim. A read-only Git/JJ observer attempts to notice changes made via shell/custom tools after execution and informs Pi; if the repository cannot be inspected, the result is UNKNOWN and CI remains authoritative.

- **Engine:** src/inference.ts; src/reasoning-context.ts
- **Pi:** src/pi-activation.ts, src/render-reasoning.ts, src/repository-observer.ts
- **Challenge:** src/challenge.ts (write-once, pending independent authenticated review; no self-waiver)
- **Mandatory outcome:** [D008 experiment](docs/D008-OUTCOME-PROTOCOL.md) and [PLT-69 acceptance audit](docs/PLT-69-ACCEPTANCE-AUDIT.md)

**D008 remains NOT SATISFIED.** A [real paired 0.5B Pi/JJ smoke](experiments/weak-model-pi-jj/REPORT.md) ran with and without the graph, but neither condition made any actual Pi tool calls or changed code. The [tool-use validity gate](docs/D008-OUTCOME-PROTOCOL.md) now marks such attempts unqualified. Fixture tests and successful evidence collection do not prove graph effectiveness. Authenticated, equal-base weak/strong agent trials and independent behavioral review remain outstanding.


## PLT-87 — profile-first convention ids

Every convention id is `<profile>.<area>.<rule>` (profile: `planner`, `tester`, `coder`, `reviewer`, `coach`, `shared`) and lives at `<source>/conventions/<profile>/<area>/<id>.convention.yaml`. A profile selects its conventions by prefix; `shared.*` reaches every profile (`rulesForProfile` in `src/catalog.ts`).

- `conventions/aliases.json` maps all 358 v0.2.0 ids to the new ids (one-to-one, plus the 46 sidecar split-part ids). Old ids keep resolving in selectors, extension graphs and challenges.
- `conventions/provenance.json` records old and new path and SHA-256 for every file; restoring the old `rule_id` reproduces the v0.2.0 bytes exactly. `relationships.yaml` is re-keyed and isomorphic to v0.2.0 (508 edges, 44 external).
- `catalog/pi-atdd/` holds package-authored conventions, starting with `shared.convention.propose`: agents propose new or changed rules with evidence and never edit active ones.
- Tooling: `tools/profile-naming/` (`map.py`, `move.py`, `sidecar.py`, `probe.ts`). Tests: `tests/profile-naming.test.ts` (N-001 to N-005).
