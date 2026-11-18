# pi-atdd

One Pi extension for **on-demand ATDD convention guidance** and independently callable, Python-first verification. This is an incremental replacement project, not a finished migration of ATDD-Bun or ATDD Flow.

- [Linear project: pi-atdd](https://linear.app/forge100/project/pi-atdd-b912a2a4dcd7)
- [Parent task PLT-63](https://linear.app/forge100/issue/PLT-63/build-pi-atdd-graph-driven-pi-extension-replacing-atdd-bunflow-with)
- [First implementation task PLT-64](https://linear.app/forge100/issue/PLT-64/pr-1-bootstrap-pi-extension-convention-graph-resolver-and-python)
- [Migration ledger](docs/MIGRATION-LEDGER.md) · [Convention candidates](docs/CONVENTION-CANDIDATES.md) · [Adversarial tests](docs/ADVERSARIAL-TEST-PLAN.md)

## Current scope (PR 1)

- Parse existing convention YAML and relationships without rewriting upstream.
- Verify a SHA-256 lock over each local convention source. A source update must be explicit.
- Select rules by task terms/file paths/operation, then follow mandatory **requires** edges only. Other edge verbs remain recorded but are **not** assumed to imply prerequisites or conflicts.
- Preserve each convention's original disposition, including strict/advisory/documentation-only, without changing it.
- Inject applicable rules into Pi on task start; for newly applicable rules found before a write/edit, return a one-time context preflight and allow a retry.
- Return a visible applicability gap if selectors cannot prove relevance; do not report a clean bill of health.
- Run explicitly scoped Python tests using pytest without shell interpolation; emit JSON evidence. Tests and required merge gates must be callable without Pi.

**Not yet implemented:** live Linear integration, JJ workspace creation, cross-agent delivery, full traceability parity, all convention selectors/detectors, automated consumer cutover. The local Pi preflight cannot intercept arbitrary bash scripts that edit files and is NOT a substitute for independently required CI.

## Installation and configuration (experimental)

The extension is a Pi package (entrypoint: extensions/atdd.ts). Install a trusted copy with Pi:

    pi install git:github.com/afokapu/pi-atdd

The extension itself is TypeScript, but it calls a **Python** executable for graph and pytest operations. Use Python 3.11+ and install the kernel into the interpreter used by Pi (defaults to python3, override with ATDD_PYTHON):

    python3 -m pip install -e '.[dev]'

Set up a local, version-pinned checkout of the canonical catalog, for example atdd-extensions checked out at commit 3aa141ecca1bf96d38964c1b8d4cf2e62b8efdfe. Obtain its content hash:

    pi-atdd --repo . digest ../atdd-extensions/official/atdd.extension.coder.base

Create atdd-pi.yaml in the Python consumer repository:

    schema: pi-atdd/config/v1
    sources:
      - path: ../atdd-extensions/official/atdd.extension.coder.base
        origin: atdd-extensions@3aa141e
        sha256: <exact 64-hex digest printed above>
    selectors: atdd-selectors.yaml

Create atdd-selectors.yaml. Selectors are an *adapter* for existing conventions, not a replacement for them. They are needed because most upstream convention YAML files do not declare automatic task/path activation:

    schema: pi-atdd/selectors/v1
    selectors:
      - id: python-api-auth
        operations: [task, create, edit]
        paths: ["src/**/routes/*.py", "src/routes/*.py"]
        terms: [fastapi, authorization]
        rules: [coder.security.missing-auth]
      - id: python-db-loop
        operations: [task, create, edit]
        paths: ["src/**/database/*.py"]
        terms: ["n+1", "database queries"]
        rules: [coder.refactor.nplus1]

For now, selector path and term triggers are **OR** conditions: a match in either activates the mapped rule. That favors recall and may over-select. Do not assume a missing match means the absence of obligations. Rule treatment is never inferred from the selector.

Try the standalone resolver and a targeted acceptance check:

    pi-atdd --repo . context --task "Implement FastAPI authorization"
    pi-atdd --repo . context --task "Add endpoint" --path src/routes/users.py --operation edit
    pi-atdd --repo . verify --target tests/test_api.py::test_requires_auth

The context command exits 3 if applicability is unresolved, 2 on invalid/changed graph, 0 when matched. The verify command exits 1 on test failure/timeout, 2 on invalid targets, and 0 on success. Both produce JSON. Required consumer CI should run configured mandatory verification, not only whatever the agent decided to inspect.

## Development

    python3 -m pip install -e '.[dev]'
    python3 -m pytest -q
    npm run test:extension

Fixture YAMLs are exact upstream convention files from atdd-extensions commit 3aa141e; the small relationship graph is deliberately limited to a genuine upstream dependency and must never be confused with the entire production catalog.

## Migration policy

ATDD-Bun and Flow remain installed in current consumer repositories. Do not uninstall or weaken their merge requirements until behavior, security, plan parsing, JJ exact-head review, reliable messaging, Linear identity and CI parity are independently demonstrated. The migration ledger separates policy that should become a convention from runtime mechanisms that must remain code.
