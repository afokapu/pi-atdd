# ATD-29 Pass A — semantic assessment batch 02: Bun coder conventions

**Standing:** Source-reviewed provisional candidate state lenses, not admitted engineering OoCs or automatically actionable controls. **Scope:** 70 previously UNRESOLVED Bun `coder.*` rules; original source is byte-pinned by the existing TSV's Git blobs and vendor catalog lock. This is extraction under ATD-29; independent O1–O8 review (ATD-28), reconciliation (ATD-27), owner decision and T9 authority are untouched. An authored enforcement rule is evidence for a state lens, not itself an admitted OoC. Each row below is individually grounded in the authored statement, terms, content and exceptions; code/detector references are claims of existing measurement shapes only, not proof that a live consumer satisfied them.

**Assessment discipline:** Direction-neutral state subject and Resource bearer are recorded in column 3; measurement/observable manifestation in column 4; negative/excluded situations in column 5. Candidate labels intentionally group source rules only when they govern the same state; label differences signal potentially independently varying state aspects. No `requires` closure is inferred from discretionary graph edges; consult the exact 522-edge authored witness ledger. The fixed source has 376 non-fixture conventions (356 Bun, 2 Flow, 18 local), whereas the old issue described 375. This batch does not change those sources.

## coder.architecture

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.architecture.capabilities-import`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/architecture/coder.architecture.capabilities-import.convention.yaml#L6) | `PA-B-DES01` | Design-system module outbound-import isolation | Resolve relative/aliased imports from design roots against project capability/app roots | No design root, tests/vendor or bare package imports are not failures |
| [`coder.architecture.connected`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/architecture/coder.architecture.connected.convention.yaml#L6) | `PA-B-DES02` | Rendering app component design-system consumption | Check a rendering JSX component imports and genuinely composes at least one design-system surface | Non-rendering routes, tests and absent design roots are excluded |
| [`coder.architecture.dependency-flow`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/architecture/coder.architecture.dependency-flow.convention.yaml#L6) | `PA-B-DES03` | Design-system internal layer dependency direction | Compare resolved import edges with tokens/foundations–primitives–components–templates hierarchy | Same-layer imports allowed; files without named layer excluded |
| [`coder.architecture.hierarchy-import`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/architecture/coder.architecture.hierarchy-import.convention.yaml#L6) | `PA-B-ARCH01` | Feature code import-direction integrity across architecture layers | Resolve import source/target layers; presentation/application/domain/integration edges must point inward | Assembly may reach any layer; tests and out-of-graph specifiers excluded |
| [`coder.architecture.orphan-export`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/architecture/coder.architecture.orphan-export.convention.yaml#L6) | `PA-B-DES04` | Design-system exported component consumption | For each capitalized component export verify a real non-barrel import consumer | Token/foundation exports, index barrels, tests excluded; dummy imports are not use |

## coder.boundaries

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.boundaries.http-client`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/boundaries/coder.boundaries.http-client.convention.yaml#L6) | `PA-B-HTTP01` | Outbound transport-boundary mediation of consumer code | Scan domain/application/presentation for unmediated fetch or bare axios calls | Integration owns centralized clients; tests/out-of-layer files excluded |

## coder.capability

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.capability.honours-its-contract`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/capability/coder.capability.honours-its-contract.convention.yaml#L6) | `PA-B-CAP01` | Capability declared artifact contract to runtime flow-variable correspondence | Match produce/consume artifact names in plan documents to structurally detected flow-variable-moving code | No declared contract or no implementation is NOT_APPLICABLE here, not compliant implementation |

## coder.commons

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.commons.application-no-integration`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/commons/coder.commons.application-no-integration.convention.yaml#L6) | `PA-B-ARCH01` | Commons application dependency direction | Resolve shared/commons application imports; flag integration-layer targets | Tests, external specifiers and unlayered files excluded |
| [`coder.commons.cross-feature-imports-in`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/commons/coder.commons.cross-feature-imports-in.convention.yaml#L6) | `PA-B-ARCH02` | Commons sibling-feature public boundary integrity | Resolve cross-feature imports against exposed layer root rather than sibling internals | Tests/external packages excluded; another feature's internal paths are not public |
| [`coder.commons.domain-no-framework-import`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/commons/coder.commons.domain-no-framework-import.convention.yaml#L6) | `PA-B-ARCH03` | Domain independence from server/framework machinery | Detect runtime/framework imports and Bun global references in domain modules | Tests/vendor and unlayered source excluded; no server required to exercise pure domain |
| [`coder.commons.domain-no-outbound`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/commons/coder.commons.domain-no-outbound.convention.yaml#L6) | `PA-B-ARCH01` | Commons domain inward-dependency direction | Resolve commons/shared domain imports; exclude application/integration targets | Tests, bare package and unlayered files excluded |

## coder.complexity

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.complexity.cyclomatic`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/complexity/coder.complexity.cyclomatic.convention.yaml#L6) | `PA-B-MET01` | Function path-decision complexity | Score 1 plus branch, boolean/nullish and ternary decisions; threshold at most 10 | Functions shorter than three code lines and test/vendor files excluded |
| [`coder.complexity.length`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/complexity/coder.complexity.length.convention.yaml#L6) | `PA-B-MET02` | Function responsibility/length pressure | Count nonblank noncomment function-body code lines; threshold at most 50 | Comments/blanks excluded; extracted helper must represent cohesive responsibility |
| [`coder.complexity.nesting`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/complexity/coder.complexity.nesting.convention.yaml#L6) | `PA-B-MET03` | Function conditional-context depth | Measure max control-keyword brace nesting relative to function base; threshold at most four | Short functions and comments excluded; boolean trickery is not semantic repair |

## coder.composition

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.composition.consumer`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/composition/coder.composition.consumer.convention.yaml#L6) | `PA-B-WIRE01` | Application/presentation collaborator external injection | Check consumer-layer code for constructing collaborator classes instead of receiving them | Tests, external packages and unlayered files excluded |
| [`coder.composition.root`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/composition/coder.composition.root.convention.yaml#L6) | `PA-B-WIRE02` | Collaborator construction localization | Recognize collaborator construction only in composition.ts, capability.ts, server.ts or index.ts | Tests/vendor exempt; root wiring and consumer injection vary independently |

## coder.dead-code

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.dead-code.reachability`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/dead-code/coder.dead-code.reachability.convention.yaml#L6) | `PA-B-REACH01` | Source runtime import-graph reachability | Walk value import graph forward/backward from structural roots and script entrypoints | Type-only imports cannot sustain runtime reachability; tests/index are excluded |

## coder.dto

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.dto.mapper`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/dto/coder.dto.mapper.convention.yaml#L6) | `PA-B-DTO01` | DTO/entity translation boundary placement | Check DTO mapper functions reside in integration rather than domain/presentation | Tests/unlayered source excluded; correct mapping body still needs behavioral proof |
| [`coder.dto.placement`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/dto/coder.dto.placement.convention.yaml#L6) | `PA-B-DTO02` | DTO contract ownership location | Check DTO declarations are under contracts/ rather than feature internals | Tests/unlayered files excluded; DTO placement varies from field immutability |
| [`coder.dto.purity`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/dto/coder.dto.purity.convention.yaml#L6) | `PA-B-DTO03` | DTO data-only immutability shape | Check DTO declarations have readonly fields and no methods | Tests/unlayered files excluded; immutable data can still be located incorrectly |

## coder.duplication

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.duplication.intra-layer`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/duplication/coder.duplication.intra-layer.convention.yaml#L6) | `PA-B-DUP01` | Duplicate executable responsibility within an architecture layer | Normalize nontrivial source lines and compare 7-line fingerprints within same layer | Test/spec, import/re-export, type fields, barrels and cross-layer similarities excluded |

## coder.error-response

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.error-response.bare-string`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/error-response/coder.error-response.bare-string.convention.yaml#L6) | `PA-B-ERR01` | Structured error-response identity integrity | Inspect 4xx/5xx response literals for coded payload instead of bare strings | 2xx/3xx, rendered fragments, variable bodies and tests excluded |
| [`coder.error-response.code-format`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/error-response/coder.error-response.code-format.convention.yaml#L6) | `PA-B-ERR02` | Machine error-code vocabulary consistency | Validate error_code/errorCode values against UPPER_SNAKE_CASE grammar | Human messages and other strings are outside this rule |

## coder.flow-router

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.flow-router.bilateral-binding`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/flow-router/coder.flow-router.bilateral-binding.convention.yaml#L6) | `PA-B-FLOW01` | Declared guarded-route-to-runtime-to-trace closure | Compare flow-router YAML route space, FlowRouterRunner, JOURNEY_MAP, FlowRunner and trace in five directions | Unexposed routes lack external reachability obligation; undeclared systems are not assessed here |
| [`coder.flow-router.delegates-to-flowrunner`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/flow-router/coder.flow-router.delegates-to-flowrunner.convention.yaml#L6) | `PA-B-FLOW02` | Route-selection versus capability execution separation | Detect FlowRouterRunner imports/loops/calls that execute product capability steps directly | FlowRunner itself legitimately executes steps |
| [`coder.flow-router.does-not-carry-flow-variables`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/flow-router/coder.flow-router.does-not-carry-flow-variables.convention.yaml#L6) | `PA-B-FLOW03` | Route-control versus artifact data-plane separation | Detect FlowRouterRunner references/mutation of FlowVariables/artifact_urn and capability imports of router | FlowRunner legitimately carries artifact variables |
| [`coder.flow-router.resolution-model-exists`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/flow-router/coder.flow-router.resolution-model-exists.convention.yaml#L6) | `PA-B-FLOW04` | Route resolution explanation-model completeness | Verify FlowRouterResolution structure contains eight authored route/context fields | Only applicable with actual FlowRouterRunner resolver; type presence does not typecheck returned values |
| [`coder.flow-router.runner-exists`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/flow-router/coder.flow-router.runner-exists.convention.yaml#L6) | `PA-B-FLOW05` | Guarded-route runtime control presence | When JOURNEY_MAP contains guarded-route object, verify FlowRouterRunner class and resolveUserSystemFlow method | Pure direct-flow consumer has no runner obligation |

## coder.green-header

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.green-header.order`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/green-header/coder.green-header.order.convention.yaml#L6) | `PA-B-TRACE01` | Source traceability header ordering | Check present header fields are URN then Tested-By then Runtime then Purpose | Missing field belongs to separate rule; absent URN yields no order claim |
| [`coder.green-header.purpose`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/green-header/coder.green-header.purpose.convention.yaml#L6) | `PA-B-TRACE02` | Implementation responsibility description presence | Verify Purpose header exists and is at most 80 characters for source file | Tests excluded; concise line alone cannot prove responsibility cohesion |
| [`coder.green-header.runtime`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/green-header/coder.green-header.runtime.convention.yaml#L6) | `PA-B-TRACE03` | Source execution-runtime declaration integrity | Check Runtime header equals bun, browser or isomorphic | Test files excluded; execution placement must be observed not guessed |
| [`coder.green-header.tested-by`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/green-header/coder.green-header.tested-by.convention.yaml#L6) | `PA-B-TRACE04` | Implementation-to-acceptance proof binding presence | Require nonempty Tested-By with at least one test: URN on implementation | Test files excluded; entry existence is not proof of passing acceptance |

## coder.green-urn

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.green-urn.capability-feature`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/green-urn/coder.green-urn.capability-feature.convention.yaml#L6) | `PA-B-TRACE05` | Source URN product capability and feature identity conformity | Validate two source ownership segments against lowercase kebab-case and plan IDs | Malformed URN shape is separate; no plan rename to patch header |
| [`coder.green-urn.layer`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/green-urn/coder.green-urn.layer.convention.yaml#L6) | `PA-B-TRACE06` | Source URN architecture-layer identity | Check URN layer in domain/application/integration/presentation/assembly | Malformed URNs skipped; no fabricated extra layers |
| [`coder.green-urn.marker`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/green-urn/coder.green-urn.marker.convention.yaml#L6) | `PA-B-TRACE07` | Source-to-plan identity marker presence/position | Require first meaningful URN: component marker in source/templates | Tests/vendor/generated excluded; shebang/doctype can precede marker |
| [`coder.green-urn.name-matches`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/green-urn/coder.green-urn.name-matches.convention.yaml#L6) | `PA-B-TRACE08` | Source component filename-to-URN identity agreement | Compare normalized Name segment and basename | Structural filenames and malformed URNs exempt |
| [`coder.green-urn.pattern`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/green-urn/coder.green-urn.pattern.convention.yaml#L6) | `PA-B-TRACE09` | Source component URN grammar integrity | Require literal component plus five nonempty segments | Missing marker reported elsewhere; content validity in companion rules |
| [`coder.green-urn.side`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/green-urn/coder.green-urn.side.convention.yaml#L6) | `PA-B-TRACE10` | Source runtime side declaration | Check URN frontend/backend side against actual ownership | Runtime header is distinct axis; malformed URNs skipped |

## coder.hypermedia

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.hypermedia.fragment-escapes-interpolation`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/hypermedia/coder.hypermedia.fragment-escapes-interpolation.convention.yaml#L6) | `PA-B-HYP01` | Server-rendered fragment data escaping | Identify HTML-bearing template interpolation of bare identifiers/property chains | Calls not judged safe by this detector; their escape behavior needs review |
| [`coder.hypermedia.swap-no-inline-handler`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/hypermedia/coder.hypermedia.swap-no-inline-handler.convention.yaml#L6) | `PA-B-HYP02` | Hypermedia event behavior lifecycle consistency | Detect lowercase HTML inline handlers in files with hx- attributes | Plain non-htmx files and camelCase JSX handlers excluded |
| [`coder.hypermedia.swap-oob-carries-id`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/hypermedia/coder.hypermedia.swap-oob-carries-id.convention.yaml#L6) | `PA-B-HYP03` | Out-of-band swap destination identity presence | Check hx-swap-oob element itself has id binding | Dynamic JSX id counts as present but runtime resolution still unverified |
| [`coder.hypermedia.verb-destructive-confirms`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/hypermedia/coder.hypermedia.verb-destructive-confirms.convention.yaml#L6) | `PA-B-HYP04` | Destructive hypermedia user-intent confirmation | Require hx-confirm or hx-prompt on exact hx-delete element | DELETE disguised as POST falls outside detector |
| [`coder.hypermedia.verb-endpoint-is-routed`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/hypermedia/coder.hypermedia.verb-endpoint-is-routed.convention.yaml#L6) | `PA-B-HYP05` | Mutating hypermedia endpoint to journey router correspondence | Match static hx-post/put/patch/delete endpoints to server JOURNEY_MAP | GET and interpolated endpoints excluded rather than guessed |
| [`coder.hypermedia.verb-endpoint-same-origin`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/hypermedia/coder.hypermedia.verb-endpoint-same-origin.convention.yaml#L6) | `PA-B-HYP06` | Hypermedia endpoint origin trust boundary | Flag absolute/protocol-relative URL in hx-get/post/put/patch/delete attributes | Relative/same-origin URLs and non-verb htmx attrs excluded |
| [`coder.hypermedia.verb-mutation-signals-progress`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/hypermedia/coder.hypermedia.verb-mutation-signals-progress.convention.yaml#L6) | `PA-B-HYP07` | In-flight mutation feedback visibility | Check mutating hx-* element has indicator or disabled-elt state | GET excluded; server idempotency does not replace visual progress |

## coder.journey-router

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.journey-router.flow-router-routing`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/journey-router/coder.journey-router.flow-router-routing.convention.yaml#L6) | `PA-B-JOUR01` | Journey-root guarded flow-router dispatch wiring | Check JOURNEY_MAP guarded routes reference FlowRouterRunner and FlowRunner | Direct-user-system-flow-only router is exempt |
| [`coder.journey-router.journey-routing`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/journey-router/coder.journey-router.journey-routing.convention.yaml#L6) | `PA-B-JOUR02` | Exposed journey entrypoint reachability | Map exposed journey actions to matching journeyId/path and JourneyRunner reference | Unexposed journeys and plan-stage without router exempt |

## coder.journey

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.journey.runner-boundary`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/journey/coder.journey.runner-boundary.convention.yaml#L6) | `PA-B-JOUR03` | Journey continuation-controller isolation | Require declaration-reading JourneyRunner that delegates to FlowRouterRunner but not FlowRunner or capabilities | No journey topology and plan-stage without router not assessed |

## coder.layer

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.layer.naming`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/layer/coder.layer.naming.convention.yaml#L6) | `PA-B-LAYER01` | Feature-module layer discoverability | Check feature/capability path has layer segment or layer filename | Tests and non-layered sources excluded; layer name cannot be chosen solely to hide bad import |

## coder.logging

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.logging.console`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/logging/coder.logging.console.convention.yaml#L6) | `PA-B-LOG01` | Application structured logging-channel use | Detect console.* calls in application code where logger should carry level/correlation | Comments/strings and test files excluded; CLI stdout is distinct interface |
| [`coder.logging.structured`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/logging/coder.logging.structured.convention.yaml#L6) | `PA-B-LOG02` | Log event contextual attribute coverage | Check recognized logger methods have context object beyond bare string | Non-logger receivers, multiargument calls out of detector scope |

## coder.phase

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.phase.discipline`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/phase/coder.phase.discipline.convention.yaml#L6) | `PA-B-PHASE01` | Behavioral phase readiness and quality gate standing | Compare trusted GREEN behavioral proof and REFACTOR/strict review gate evidence | Construction constraints never waived; narrow structural unblock allowed |

## coder.quality

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.quality.comments`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/quality/coder.quality.comments.convention.yaml#L6) | `PA-B-MET04` | Source design-context documentation density | Measure comment lines at least 10 percent of nonblank TS lines | Tests/vendor excluded; filler comments do not establish semantic clarity |
| [`coder.quality.mi`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/quality/coder.quality.mi.convention.yaml#L6) | `PA-B-MET05` | File aggregate maintainability pressure | Compute source MI from volume/decision density/LOC/comments; threshold >=20 | Zero-code files score 100; numeric improvement alone not semantic cohesion |

## coder.responsive

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.responsive.breakpoints-declared`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/responsive/coder.responsive.breakpoints-declared.convention.yaml#L6) | `PA-B-RESP01` | Responsive breakpoint-vocabulary coherence | Resolve media-query widths against declared frontend.breakpoints set and tolerant 1px below max | Generated/vendor excluded; em/rem converted at 16px |
| [`coder.responsive.no-fixed-width`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/responsive/coder.responsive.no-fixed-width.convention.yaml#L6) | `PA-B-RESP02` | Smallest-viewport layout width containment | Check widths/min-widths against smallest declared viewport | max-width and custom property definitions excluded |
| [`coder.responsive.viewport-meta`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/responsive/coder.responsive.viewport-meta.convention.yaml#L6) | `PA-B-RESP03` | Full-document viewport/zoom accessibility | Check full HTML document has width=device-width and allows usable zoom | Fragments excluded; dynamic JSX meta presence measured without evaluating content |

## coder.runtime

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.runtime.executes-the-declaration`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/runtime/coder.runtime.executes-the-declaration.convention.yaml#L6) | `PA-B-RUN01` | Runtime consumption of authoritative routing declarations | Prove FlowRouterRunner reads YAML path and FlowRunner derives capability order from plan | No guarded routes excluded; hardcoded agreement is not runtime source-of-truth |
| [`coder.runtime.server-is-bun-serve`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/runtime/coder.runtime.server-is-bun-serve.convention.yaml#L6) | `PA-B-RUN02` | HTTP runtime stack-native server identity | Detect Bun.serve versus Express/Koa/Fastify/createServer construction | Tests and masked textual references excluded; named createServer false positive known |
| [`coder.runtime.single-lockfile`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/runtime/coder.runtime.single-lockfile.convention.yaml#L6) | `PA-B-RUN03` | Repository dependency-resolution source singularity | Check Bun project has no other package-manager lockfiles in scan | Generated/vendor excluded; unadopted monorepo package remains reported |

## coder.security

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.security.sql-injection`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/security/coder.security.sql-injection.convention.yaml#L6) | `PA-B-SEC01` | SQL sink parameterization safety | Check query sinks for interpolated untagged SQL or concatenated fragments | Bun.sql tagged templates and static SQL excluded |

## coder.telemetry

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.telemetry.forbidden-properties`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/telemetry/coder.telemetry.forbidden-properties.convention.yaml#L6) | `PA-B-TEL01` | Telemetry event payload forbidden-field exclusion | Match emitted object properties to tracking-plan forbidden list | Only registered item names and adopted telemetry corpus assessed |
| [`coder.telemetry.implementation-binding`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/telemetry/coder.telemetry.implementation-binding.convention.yaml#L6) | `PA-B-TEL02` | Required telemetry item implementation source coverage | Check each acceptance-required telemetry item has non-test source Telemetry header | Inactive pre-adoption; unresolved URNs handled by acceptance rule |
| [`coder.telemetry.raw-string-emit`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/telemetry/coder.telemetry.raw-string-emit.convention.yaml#L6) | `PA-B-TEL03` | Emitted telemetry identity registration | Match event-like literal in emit-like call against registered telemetry IDs | Test code, non-event strings and pre-adoption out of scope |
| [`coder.telemetry.source-binding`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/telemetry/coder.telemetry.source-binding.convention.yaml#L6) | `PA-B-TEL04` | Source telemetry header identity resolution | Resolve concrete Telemetry URN in source against tracking plan | Only // source headers; tests and pre-adoption excluded |
| [`coder.telemetry.vendor-sdk`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/telemetry/coder.telemetry.vendor-sdk.convention.yaml#L6) | `PA-B-TEL05` | Core telemetry vendor independence | Detect vendor SDK imports outside integration/infrastructure | Unlayered entrypoints and pre-adoption excluded |

## coder.ui

| Source convention | Provisional state lens | Bearer class / direction-neutral state | Source-backed observable use and measurement | Explicit boundary or negative control |
| --- | --- | --- | --- | --- |
| [`coder.ui.primitives`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/ui/coder.ui.primitives.convention.yaml#L6) | `PA-B-UI01` | Application interactive-control primitive reuse | Check JSX or TS-rendered HTML controls use design-system primitives | Tests, design primitive implementation and plain HTML templates excluded |
| [`coder.ui.token-color`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/ui/coder.ui.token-color.convention.yaml#L6) | `PA-B-UI02` | UI color semantic tokenization | Detect raw color literals in CSS/UI declarations outside tokens/foundations | CSS custom-property definitions and certain named/current colors excluded |
| [`coder.ui.token-hardcoded`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/ui/coder.ui.token-hardcoded.convention.yaml#L6) | `PA-B-UI03` | UI spacing/motion scale-token conformity | Detect raw >1px spacing/radius/inset or nonzero animation/transition duration | 0/1px, custom properties, widths/fonts and tokens-layer excluded |
| [`coder.ui.tokens-pure`](https://github.com/afokapu/pi-atdd/blob/567b2e513782b380c18f320d69edf140d61a36d4/vendor/atdd-bun/conventions/coder/ui/coder.ui.tokens-pure.convention.yaml#L6) | `PA-B-UI04` | Design tokens/foundations data-only purity | Flag renderer imports, markup or control flow inside token/foundation source | CSS token files and tests excluded |

## Cross-source collisions and independent state variations

**Shared authored semantic concerns, not duplicate admitted objects:** `PA-B-ARCH01` consolidates four inward dependency rules across general, commons application and commons domain module views. `PA-B-WIRE01` (consumer injection) and `PA-B-WIRE02` (assembly location) vary independently: one may pass while the other fails. DTO placement/purity/mapping are three independent state aspects. `PA-B-FLOW01` measures multi-surface correspondence; `PA-B-FLOW02/03/04/05` separately measure execution delegation, flow-variable boundary, resolution metadata and runner presence—none can be inferred from a passing graph-edge witness. Green-header/URN rows govern separate traceability dimensions so a well-formed URN alone never counts as a resolved acceptance binding. `PA-B-MET01/02/03/04/05` measure path complexity, function length, nesting, comment context, and whole-file maintainability independently; passing a sensor is not behavioral reconciliation. Hypermedia routing, origin, confirmation and progress are independently controllable safety/UX states. Telemetry item-source coverage, emitted names, forbidden fields and SDK coupling are independent; adoption gates must remain visible.

**Negative-control rule:** An explicit exception or self-scoping clause is a *not-applicable condition* for that detector, not proof that the overall system complies. Every candidate label remains `CANDIDATE / REVIEW_REQUIRED`; the source evidence does not authorize owner admission, direct Action/Driver control, a canonical identity, or API publication. Candidate extraction and independently verified rule satisfaction are separate questions.

**This is a complete read of these 70 coder sources, not a complete Pass A:** Planner/tester/reviewer/shared Bun rules remain to be assessed; the previous 26 candidate-bearing files and single reasoned no-candidate case stay unchanged. No source YAML or source-lock modification is proposed.
