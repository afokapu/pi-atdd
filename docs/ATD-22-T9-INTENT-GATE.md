# ATD-22 — Pi declaration-first T9 pre-action gate (draft)

**Canonical work issue:** [ATD-22](https://linear.app/af8/issue/ATD-22). **Integration coordinator:** [ATD-39](https://linear.app/af8/issue/ATD-39). **External semantic contract:** [PLT-107](https://linear.app/forge100/issue/PLT-107) and [PLT-110](https://linear.app/forge100/issue/PLT-110).

## What is implemented

The Pi extension depends on the **released** private package `@forgeonehundred/frg-t9-semantic-compiler@0.4.1`. It calls the package's real `createT9({snapshot,perimeter}).compileExpression(...)` API; **no fork or reimplementation of T9 grammar** is introduced.

With operator-owned `PI_ATDD_REQUIRE_T9=1` enabled in a repository, Pi:

1. Allows read-only exploration without a fictitious desired Change Path.
2. Blocks a governed `edit`, `write`, unsafe/opaque `bash` command or other non-read-only tool action until `declare_t9_change` is called.
3. The agent must supply a **desired `t9-expression/2` Change Path** and the exact next tool name and JSON input. The extension sends the expression to T9 v0.4.1, which can return `RESOLVED`, `CANDIDATE` or `REFUSED`. Only `RESOLVED` is even eligible.
4. **Separately** requires an authenticated host to attest the compiled change against that exact tool operation, target Resource/Situation and independently observed repository revision. The compiler's `RESOLVED` result is *not* authority.
5. Binds the attestation to a stable hash of the exact tool input, observed Git/JJ revision **and fingerprint of the dirty working tree**; any mismatch refuses the attempted tool call. The attestation is single-use after execution and disappears at task/session reset. Unobservable/gapped repository state refuses instead of permitting a claim.
6. Retains ordinary ATDD preflight (mandatory convention graph, trusted phase, post-tool observation). Declaring T9 does not bypass or certify those obligations.

**This does not yet activate ATDD conventions via an admitted OoC graph:** the Stream A admitted registry, publisher-signed ATDD snapshot/perimeter, and T9 Change Realization Contract/governance resolver are not approved or present in the released v0.4.1 package. This work adds the mandatory **declaration and compiler verification** seam; not semantic ATDD rule-resolution parity or a production authorization provider. Legacy Pi typed facts and Datalog remain the existing activation engine until separately reviewed integration.

## Installation — private GitHub Packages

`.npmrc` contains *only* the scoped registry mapping:

```ini
@forgeonehundred:registry=https://npm.pkg.github.com
```

`package.json` pins `@forgeonehundred/frg-t9-semantic-compiler` **exactly 0.4.1**. The private package has no public download URL and requires an authorized credential with `read:packages`; **never commit a token**. GitHub Actions installs using `T9_PACKAGES_READ_TOKEN` (or its `GITHUB_TOKEN` if the package owner has explicitly granted cross-repository read access). The consuming repository's secret must be granted separately by the organization/package owner. **Observed GitHub Actions #45109387608 returned E403 Forbidden** when `pi-atdd` attempted to fetch the private package. Until package read access is granted, the package is **not installed in CI**, and actual compiler execution/TypeScript/integration validation is **UNVERIFIED**. A separate dependency-free syntax job can pass, but that is explicitly not proof of compiled semantic behavior.

## Activation and host-provider contract

`PI_ATDD_REQUIRE_T9=1` is a host/deployment switch, **not** a model-supplied declaration. Set it through the operator's trusted environment to enable fail-closed tool interception in repositories, **even when the agent switches to plain mode**; do not set it in a prompt or source file. An untrusted Pi session cannot bypass strict T9 to execute a governed tool. The Pi adapter accepts an *injected host-only* `t9Authority` with:

- `snapshot: OntologySnapshot` — authenticated, source-pinned engineering ontology, **not** a DEMO fixture.
- `perimeter: Perimeter` — the selected, publisher-approved ATDD Focus/Phase/Dimension vocabulary, version and snapshot pin.
- `attest({document,compiledChange,action})` — independently checks authorization, exact Resource/Situation, the action's target/operation and repository revision, returning `AUTHORIZED` with an attestation ID and matching revision or `REFUSED`.

In ordinary Pi sessions **there is not yet a qualified ATDD `t9Authority`**; strict mode therefore refuses guarded mutations rather than fabricating an admitted OoC, work-provider approval or demo vocabulary. The test harness uses clearly synthetic fixtures solely to validate the T9 compiler call and Pi hook behavior; no DEMO manifest is a production default.

## Important limitations and next gate

The host must independently establish actual authority and SourcePin/Resource/Situation bindings; an agent's typed statement is not evidence of changed code, permission or outcome. Pi compares the exact tool action and performs independent post-tool reconciliation, but a tool may have hidden side effects; opaque shell commands are gated rather than presumed safe. Custom Pi tools outside hook coverage are not an OS sandbox or security perimeter.

Before enabling the strict gate in production, [ATD-39](https://linear.app/af8/issue/ATD-39) and the approved T9 owner must supply an independently authenticated ATDD snapshot/perimeter, trusted provider attestor, versioned intent/resource bindings and approved [PLT-107](https://linear.app/forge100/issue/PLT-107)/[PLT-110](https://linear.app/forge100/issue/PLT-110) semantic resolver. Combined integration must preserve ATD-42 PLAN/RED acceptance and ATD-22 OBS-001..004, with independent reviewer approval and green package-install CI.

**No private credentials, canonical OoC registry, ATDD Bun/Flow convention sources or published T9 package source are modified.**
