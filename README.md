# pi-atdd

**TypeScript-only Pi extension** for on-demand engineering conventions. ATDD-Bun and ATDD Flow are the canonical convention sources; this package reads their original YAML and graph by a pinned content digest. No Python kernel, Python subprocess, pytest or code-generation copy of the source conventions is required.

Implementation task: [PLT-64](https://linear.app/forge100/issue/PLT-64). Architecture/migration program: [PLT-63](https://linear.app/forge100/issue/PLT-63).

## What the first PR implements

- Native Pi package discovery via `pi.extensions` and a real Pi RPC smoke test that verifies the `/atdd` command.
- TypeScript resolver for ATDD-Bun convention files, planner nodes and `relationships.yaml`, plus ATDD Flow convention files.
- Immutable source SHA-256 locks, duplicate-key/ID detection and recorded unresolved external graph references.
- Task/operation/path-based selectors; required `requires` traversal (other edge types never silently imply mandatory prerequisites).
- Pi lifecycle hooks to supply context at task start and the first newly relevant edit, with original rule text, rationale, exceptions, and disposition.
- A standalone TypeScript CLI for graph queries and explicit TypeScript test targets. Tests are never automatically run on every commit.
- Template-aligned Given/When/Then acceptance YAML validated against ATDD-Bun's unchanged V2 acceptance schema.

**Not yet implemented:** complete full-corpus selector coverage, semantic alternative verification, traceability parity, Jujutsu integration workspaces, Linear adapter, durable multi-agent messaging or consumer cutover. These are tracked separately; the old toolkits must not be uninstalled yet.

## Pi installation

A trusted user can install a published Git package with:

```sh
pi install --local git:github.com/afokapu/pi-atdd@<reviewed-tag>
```

For development in this repository:

```sh
npm install
npm run check
npm run smoke:pi
```

The smoke test actually starts the Pi RPC runtime, loads the TypeScript extension, queries `get_commands`, and requires the `atdd` command to be present.

## A consumer configuration

Keep checked-out, reviewed versions of ATDD-Bun and ATDD Flow available locally. Obtain each content digest with the standalone TypeScript CLI:

```sh
npm run atdd -- --repo . digest --source ../atdd-bun --kind bun
npm run atdd -- --repo . digest --source ../atdd-flow --kind flow
```

Create `atdd-pi.yaml` under the consumer repository:

```yaml
schema: pi-atdd/config/v2
sources:
  - id: atdd-bun
    kind: bun
    path: ../atdd-bun
    revision: <reviewed-git-commit>
    sha256: <exact-computed-digest>
  - id: atdd-flow
    kind: flow
    path: ../atdd-flow
    revision: <reviewed-git-commit>
    sha256: <exact-computed-digest>
selectors: atdd-selectors.yaml
```

Create a selector registry mapping task and file signals to the original rule IDs (the sample in `tests/fixtures/selectors.yaml` illustrates the schema). The existing convention YAML remains unchanged.

```sh
npm run atdd -- --repo . context --task "Review the integration branch" --path src/workspace/driver.ts --operation edit
npm run atdd -- --repo . verify --target tests/payment.test.ts
```

`context` returns 0 on a match, 3 for an applicability coverage gap and 2 on invalid policy. `verify` executes explicitly selected Node test targets, with a nonzero exit on failure. For Bun consumers, pass `--runner bun`. A source revision or digest change requires revalidation and review; a success response is never an independent compliance certificate.

## Migration and review

- [Source-level migration ledger](docs/MIGRATION-LEDGER.md)
- [Code-embedded convention proposals](docs/CONVENTION-CANDIDATES.md)
- [Adversarial test plan](docs/ADVERSARIAL-TEST-PLAN.md)
- [Adapter interface contracts](docs/ADAPTER-CONTRACTS.md)
- [Acceptance-by-acceptance self-review](docs/ACCEPTANCE-AUDIT.md)

PR #1 is intentionally a draft. A green test run is not permission to merge or remove ATDD Flow/Bun. The source review and real Pi runtime proof must be completed before independent review.
