# Project conventions

The following conventions apply to this codebase.

## coder.bun.boundaries-http-client — Route outbound HTTP through the centralized client

GIVEN A source file in the domain, application or presentation layer performs, or needs to perform, outbound HTTP
WHEN the agent writes, edits or is responsible for that file
THEN Make outbound HTTP through the project's centralized, contract-driven client (integration-layer client/adapter), never via platform `fetch()` or bare `axios`.

PREFER
- Use the existing integration-layer HTTP client or adapter.
- Let that boundary own transport concerns: headers, retries, decoding, error translation.
- During GREEN: make only the outbound call and mapping the current acceptance requires.
- During GREEN: reuse an existing client or port before a new abstraction; if no compliant boundary exists, add the smallest integration adapter the behavior requires.
AVOID
- Calling `fetch()`/`axios` directly just to make the test pass.
- A generalized HTTP framework for hypothetical endpoints.
- Migrating unrelated HTTP callers beyond the one the current acceptance touches.
UNLESS
- Test files and vendored/build directories (never scanned).
- Files with no layer segment (outside the rule).
WHY The centralized client holds retries, timeouts, auth headers, tracing and error translation; a bare fetch has none and never acquires them because nobody remembers it exists. In htmx apps a bare server-side fetch behind a rendered fragment fails as a blank swap the user sees.

EVIDENCE
- bun_clean_architecture_detector reports no bare `fetch(`/`axios(` in domain/, application/ or presentation/ files of the affected source (the affected source satisfies this boundary rule).
- The outbound call in the change is made via the integration-layer client/adapter (or a port implemented there).
- The current behavioral acceptance passes.

## coder.bun.commons-domain-no-framework-import — Domain modules import no runtime machinery

GIVEN A non-test, non-vendored/build module in the `domain/` layer
WHEN it imports a specifier or references a global (new or existing)
THEN It MUST NOT import runtime machinery (`bun:*`, `node:*`, `htmx`, `express`, `fastify`, `koa`) nor reach the `Bun.` global.

PREFER
- Keep domain code as data-in / data-out logic.
- Move Bun, Node, htmx, server, or framework machinery to an outer layer and pass the needed value inward.
- During GREEN: adapt at the nearest existing integration or presentation boundary, passing the smallest value or domain-facing collaborator the behavior needs; add a new boundary only when no existing one can express the current behavior correctly.
AVOID
- Wrapping a framework API in a domain-named helper and keeping the coupling.
- Redesigning adjacent layers.
- Importing runtime machinery just to satisfy the acceptance quickly.
UNLESS
- Test files and vendored/build directories are never scanned.
- A file carrying no layer segment is outside these rules, not in violation.
WHY The domain expresses rules, not machinery; for a full-stack Bun app the machinery is the server and transport primitives. The domain must be runnable with no server started — `Bun.` in a domain module means it is not.

EVIDENCE
- bun_clean_architecture_detector reports no framework/runtime import specifier and no `Bun.` global use in any domain module.
- The current behavioral acceptance passes.
- The domain remains executable without runtime machinery (runnable with no server started).

## coder.bun.complexity-cyclomatic — Keep each TypeScript function's cyclomatic complexity at or below 10

GIVEN Any TypeScript/TSX source function (3+ code lines, outside test, vendored and build dirs), whether changed or not
WHEN its cyclomatic complexity (1 + each if/else if/for/while/do/catch/case, each &&/||/??, each ternary) exceeds 10
THEN Restructure it to score at or below 10 by separating decisions into coherent, nameable responsibilities without changing behaviour.

PREFER
- Diagnose first: group branches by policy/responsibility, separate validation and guards from the core operation, spot repeated compound conditions that are a domain predicate.
- Extract a coherent decision or policy into an intention-revealing function.
- Replace repeated compound conditions with well-named predicates.
- Dispatch table/strategy only for a genuinely stable key-to-behaviour mapping.
- Keep the caller's control flow showing the important choices.
AVOID
- Moving the same branch tree unchanged into a generically named helper.
- Indirect data structures or opaque encodings used solely to lower the score.
- Scattering one policy across tiny functions whose interaction is harder to follow.
- Changing boolean semantics, branch order or fallback behaviour.
UNLESS
- Function under 3 code lines (not scored: a two-line arrow is not a complexity problem).
- Test file or vendored/build directory (outside the scan).
WHY Complexity approximates the test cases needed to pin behaviour; above ~10 paths full coverage stops being written and defects settle in untested paths. The score senses too many decisions in one responsibility; hiding branching only hides the signal.

EVIDENCE
- bun_ts_metrics_detector reports no COMPLEXITY-CYCLOMATIC-TS-001 finding for the triggering function (the triggering violation is gone).
- Existing behaviour and path-focused tests remain green.
- Extracted code introduces no new nesting, duplication or length violation, and the refactor introduces no new ATDD Bun violations.
- Reviewer confirms the resulting decision boundaries correspond to meaningful responsibilities that are easier to name, test and reason about, rather than a relocated or opaquely encoded branch tree.

## coder.bun.complexity-length — Keep each TypeScript function at or below 50 code lines

GIVEN A non-test TypeScript/TSX function in the scanned source tree
WHEN its body is written, changed, or scanned
THEN The function has at most 50 code lines (blank and comment lines excluded).

PREFER
- Diagnose first: the distinct responsibilities, stages, or invariants the function manages.
- Find semantic seams (internal_seam): blocks nameable by one intention-revealing name, often introduced by a comment that becomes the helper's name.
- Identify the data each candidate responsibility needs.
- Extract one cohesive responsibility at a time.
- Name helpers after their purpose, not their mechanics.
- Keep related state and decisions together.
- Leave the original as a readable top-level flow.
AVOID
- Splitting at an arbitrary line boundary, or moving contiguous lines elsewhere, just to get under 50.
- Mechanical helper names like `part1`, `processRest`, `buildLinesAndTotal`.
- Moving a long or complex block unchanged into another function.
- A generalized abstraction unrelated to the extracted responsibility.
WHY A function longer than a screen cannot be read as one unit, so its invariants are reconstructed from memory each time; length catches linear functions doing several unnamed things that complexity misses. The threshold is a sensor for weak cohesion or multiple responsibilities, not the objective — moving lines only removes the signal.

EVIDENCE
- bun_ts_metrics_detector no longer reports COMPLEXITY-LENGTH-TS-001 for the triggering function.
- Extracted functions satisfy the applicable complexity and nesting conventions.
- Reviewer judges that resulting names and boundaries make the responsibilities easier to understand (a successful refactor identifies a responsibility or cohesive operation that deserves its own name and boundary).
- The refactor introduces no new ATDD Bun violations.

## coder.bun.complexity-nesting — Keep TypeScript function nesting depth at or below 4

GIVEN Any TypeScript/TSX function of 3+ code lines outside test files and vendored/build directories
WHEN it is present in scanned source
THEN Keep its maximum control-flow nesting depth (control_depth) at or below 4.

PREFER
- Invert conditions into early-return guard clauses when that preserves cleanup, error, and ordering semantics.
- Extract a cohesive inner operation into a named function with a small, meaningful input.
- Prepare or filter a collection before iterating when that makes the algorithm clearer.
- Flatten control flow by removing unnecessary conditional context: first find early-reject conditions (guards), a cohesive inner block, nested iteration expressible as preparation plus one clear pass.
AVOID
- Clever boolean/ternary rewrites, brace removal, or re-encoding the same nesting solely to evade the depth count.
- Extracting a block that needs a long parameter list or still depends on the caller's hidden conditional context.
- Duplicating cleanup, logging, or error handling across new guard clauses.
- Changing evaluation order or exception behavior while flattening.
WHY At depth five a reader must hold five simultaneous conditions to know whether a line runs, beyond reliable working memory; depth is a sensor for too much conditional context. A guard or extracted helper usually removes a level without changing behaviour, so the threshold is enforced, not advised.

EVIDENCE
- Existing behavior and tests remain green, including error and boundary paths.
- The triggering nesting violation (COMPLEXITY-NESTING-TS-001) is gone in a bun_ts_metrics_detector run.
- The flattened flow reads with fewer simultaneous preconditions (reviewer judgement).
- Extracted functions satisfy the applicable length and complexity conventions.
- The refactor introduces no new ATDD Bun violations.

## coder.bun.composition-consumer — Consumer layers receive their collaborators

GIVEN A module in the presentation/ or application/ layer (a consumer layer: it uses collaborators rather than assembling them)
WHEN the module needs a collaborator
THEN Receive the collaborator by injection (as a parameter or pre-wired) rather than constructing it inside the consumer.

PREFER
- Receive collaborators through parameters or already-wired construction.
- Let the composition root decide which concrete collaborator is supplied.
- During GREEN: reuse the consumer's existing injection shape when one exists.
- During GREEN: add only the collaborator required by the current behavior.
- During GREEN: prefer the narrowest existing contract over a new generalized interface.
AVOID
- Instantiating a repository, client, service, adapter, gateway, store, provider, or factory inside the consumer.
- Redesigning unrelated constructor or function signatures.
UNLESS
- Test files and vendored/build directories are never scanned.
- A file carrying no layer segment is outside these rules rather than in violation of them.
WHY A consumer that builds its own collaborators cannot be tested without them — exactly how a unit test acquires a database. Composition-root says where wiring MAY happen; this rule says consumers must accept what they are given.

EVIDENCE
- The current behavioral acceptance passes.
- The consumer can be exercised with its collaborator supplied from outside.
- bun_clean_architecture_detector reports no `new <Collaborator>()` inside a consumer-layer module.

## coder.bun.composition-root — Construct collaborators only in a composition root

GIVEN A Bun source file whose path carries a layer segment (a directory named as a layer in the repository layer map) and that is not a composition root (`composition.ts`, `wagon.ts`, `server.ts`, `index.ts`)
WHEN it contains `new X()` where X is a collaborator (*Repository, *Client, *Service, *Adapter, *Gateway, *Store, *Provider, *Factory)
THEN Construct the collaborator only in a composition root.

PREFER
- Construct in a root; `server.ts` counts because `Bun.serve` is the full-stack app's assembly point, where routes and their dependencies are wired.
- Pass the constructed collaborator from the root to the consumer that needs it.
- During GREEN: add only the wiring the current behavior requires.
- During GREEN: reuse existing factories, instances and composition patterns before creating new ones.
- During GREEN: keep construction separate from application or presentation behavior.
AVOID
- Instantiating the collaborator in the consumer as a shortcut.
- Speculative factories or service locators.
- Centralizing unrelated wiring merely because the root is being edited.
UNLESS
- Test files and vendored/build directories (never scanned).
- Files with no layer segment: outside these rules, not in violation.
WHY Scattered wiring is not a style problem: it is why a test cannot substitute anything, and why a second deployment shape becomes a rewrite.

EVIDENCE
- The current behavioral acceptance passes through the real wiring.
- Collaborator construction remains confined to a composition root: bun_clean_architecture_detector reports no `new <Collaborator>()` outside a root.

## coder.bun.design-hierarchy-import — Imports point inward through the layer hierarchy

GIVEN A non-test Bun source module (commons or feature) whose path has a layer segment
WHEN It imports another project module
THEN The import MUST point inward: presentation -> application -> domain; integration -> application, domain; only assembly (the composition root) may reach any layer.

PREFER
- When an inner layer needs an outer capability, use an existing inward-facing port.
- During GREEN: introduce the smallest missing port only when the current behavior cannot otherwise be implemented correctly, and limit its contract to what the acceptance requires.
AVOID
- Reclassifying or merging layers merely to make one import legal.
- Adding an outward-pointing dependency as a temporary step.
- Spreading 'knows everything' wiring outside the composition root.
UNLESS
- Test files and vendored/build directories are never scanned.
- Bare npm specifiers resolve outside the project graph and are not layer-checked.
- A file with no layer segment is outside these rules, not in violation.
WHY It governs feature code too, where most layering damage happens. The assembly exemption makes it workable: something must know about everything, and confining that to the composition root is the point of having one.

EVIDENCE
- Every affected import still points in an allowed direction (no bun_clean_architecture_detector finding).
- The current behavioral acceptance passes.

## coder.bun.dto-mapper — Keep DTO mappers in the integration layer

GIVEN A Bun project file in a layer other than integration contains a function mapping between a DTO and a domain entity (`to*DTO`, `from*DTO`, `map*DTO*`) — whether pre-existing or newly written
WHEN code is written or the project is verified (all in-scope files are scanned, not only changed ones)
THEN Place the DTO mapper in the integration layer, where both the DTO and domain shapes are legitimately visible.

PREFER
- Keep DTO-to-domain and domain-to-DTO translation in integration.
- During GREEN: reuse an existing mapper for the same boundary when one exists.
- During GREEN: add only the field mapping the current acceptance requires.
- During GREEN: create a new mapper only for a genuinely new boundary translation.
AVOID
- Placing translation in presentation or domain as a shortcut.
- Moving domain behavior into the mapper.
- Migrating unrelated mappings while fixing this one.
UNLESS
- Test files and vendored/build directories are never scanned.
- Bare npm specifiers resolve outside the project graph and are not layer-checked.
- A file carrying no layer segment is outside these rules rather than in violation of them.
WHY Mapping is translation across a boundary, which is what integration is for. A mapper in the domain drags the wire format inward; one in presentation duplicates itself once a second caller appears.

EVIDENCE
- The current behavioral acceptance passes.
- The mapper lives in integration and preserves the intended boundary (no to*DTO/from*DTO/map*DTO* declarations outside integration).

## coder.bun.dto-placement — Declare DTOs in contracts/

GIVEN A Bun source file with a layer segment and no `contracts` segment in its path
WHEN a `*DTO` type is declared in or moved into it
THEN Declare the `*DTO` type inside a `contracts/` module, not in a feature's internal layer.

PREFER
- Canonical path: declare the DTO in `contracts/`; import it from both sides of the boundary.
- During GREEN: reuse an existing contract type that already represents the payload.
- During GREEN: add only fields the current acceptance requires.
- During GREEN: create a new DTO only for a genuinely distinct boundary shape.
AVOID
- Declaring the DTO in a feature layer as a temporary shortcut.
- Moving unrelated internal types into contracts.
- Speculative fields for future callers.
- Another feature importing a DTO declared in one feature's layer (private type leak).
UNLESS
- Test files and vendored/build directories are never scanned.
- A file with no layer segment is outside these rules, not in violation.
WHY A DTO belongs to the contract (owned by neither side), not to either side; inside one feature's layer it becomes a private type others import anyway, so the boundary runs through somebody's internals.

EVIDENCE
- Every affected DTO declaration lives under `contracts/`.
- bun_clean_architecture_detector reports no dto-placement finding for any affected `*DTO` declaration.
- The current behavioral acceptance passes.

## coder.bun.dto-purity — Keep DTOs pure immutable data

GIVEN a `*DTO` type or interface — the shape crossing a boundary — in a layered, non-test source file
WHEN that DTO is declared, changed, or present in any scanned file (including pre-existing declarations)
THEN the DTO MUST have no method members and every field MUST be `readonly`.

PREFER
- Keep DTOs as immutable data: readonly fields only, no methods.
- Put behavior in the layer that consumes or produces the DTO.
- During GREEN: add only the readonly data fields the current boundary behavior requires.
- During GREEN: reuse existing functions for transformation or behavior when available; add a small free function only when the current acceptance needs it.
AVOID
- Attaching convenience methods to the DTO.
- Making fields mutable to simplify implementation.
- Introducing unrelated helpers or abstractions.
WHY A method on a DTO means behaviour crossed the boundary too, coupling both sides to an implementation rather than data; a mutable field lets the receiver change what the sender said. Both look harmless in one file and become impossible to unpick once a second consumer exists.

EVIDENCE
- bun_clean_architecture_detector reports no method member or non-readonly field on any `*DTO` declaration in scanned files.
- The current behavioral acceptance passes.
- The affected DTO remains pure immutable data (all fields readonly, no methods).

## coder.bun.duplication-intra-layer — Own each duplicated fragment once within its layer

GIVEN two non-test TypeScript files in the same layer share a run of 7+ non-trivial lines that match after normalization (comments stripped; identifiers, strings and numbers folded, so renames don't hide it)
WHEN the whole-tree duplication scan reports the pair (DUPLICATION-TS-001), new or pre-existing
THEN Resolve it semantically: own one shared concept once within that layer, or make the real differences of two distinct responsibilities explicit.

PREFER
- Before extracting, check both share a responsibility and change reason, find the smallest stable shared behavior, and confirm it belongs in that layer.
- For one concept, extract a focused function/module within the layer.
- Name shared behavior by its domain or responsibility.
- For different responsibilities, keep them independent and express real differences directly.
AVOID
- Renaming identifiers, changing literals, reordering harmless statements or other cosmetic edits to defeat normalization.
- Cross-layer abstractions made just because layers hold similar-shaped code.
- Highly parameterized generic helpers that obscure callers' intent.
- Forcing distinct responsibilities into one abstraction to remove the finding.
- A refactor that removes this finding but introduces new ATDD Bun violations.
UNLESS
- Tests, specs, .d.ts, index.ts barrels and __tests__ dirs are excluded.
- Files with no determinable layer are not judged.
WHY A duplicate fingerprint is only a sensor that two sites MAY share one responsibility or change reason, so diagnose before extracting. The intra-layer limit is deliberate: twice in one layer is the shape that genuinely wants extracting; across layers it is usually two obligations, and merging couples layers that should move independently.

EVIDENCE
- The DUPLICATION-TS-001 finding for the pair is gone after the change.
- The duplicate was removed because ownership became clearer or because genuine semantic differences are now explicit — not via renames, literal changes or reordering.
- Dependency direction and layer boundaries remain valid (no cross-layer abstraction introduced).
- Any extracted abstraction has one coherent reason to change.
- Existing behavior and tests remain green.
- The refactor introduces no new ATDD Bun violations (the atdd-bun run after the change reports no new findings).

## coder.bun.error-response-bare-string — Return a structured, coded payload from 4xx/5xx Responses, never a bare string literal

GIVEN Non-test Bun source contains a `Response` with a 4xx or 5xx status (an error_response)
WHEN that error Response's body is a bare string literal, whether the body or the status was the part written or changed
THEN The error Response MUST carry a structured payload with an error code, not a bare string literal body.

PREFER
- Return a coded payload and render a user-facing fragment separately, e.g. `return Response.json({ error_code: "ORDER_NOT_FOUND" }, { status: 404 });`.
AVOID
- A bare string literal body on an error status, e.g. `return new Response("order not found", { status: 404 });`.
UNLESS
- The status is 2xx or 3xx (out of scope).
- The body is a variable or a rendered fragment, which is not a bare literal.
- The code is in a test file.
WHY htmx swaps the response body into the live DOM, so a bare error string is not merely unstructured data a client must parse but markup rendered to the user verbatim, including whatever internal detail it carries (a stack frame, a table name, an upstream message); the structured payload is both the machine-readable contract and the boundary that stops internals leaking into the page. This is sharper in an htmx app than in a JSON API, which is why it is enforced rather than advised.

EVIDENCE
- bun_security_hygiene_detector reports no ERROR-BARE-STRING-001 finding on changed non-test files.
- Reviewer sees no changed non-test 4xx/5xx Response with a bare string literal body; where a literal body was replaced, it is a structured payload with an error code (e.g. `Response.json({ error_code: ... }, { status })`). Bodies that are variables or rendered fragments are not in scope.

## coder.bun.error-response-code-format — Write error_code values in UPPER_SNAKE_CASE

GIVEN A non-test file contains an `error_code` (or `errorCode`) key with a string value
WHEN that file is written, changed, or checked
THEN The `error_code` / `errorCode` value MUST be UPPER_SNAKE_CASE, matching `^[A-Z][A-Z0-9_]+$`.

PREFER
- Use UPPER_SNAKE_CASE consistently: `{ error_code: "ORDER_NOT_FOUND" }`.
- Put human-readable messages in a separate field, which is not constrained.
AVOID
- Writing `{ error_code: "orderNotFound" }` or any non-UPPER_SNAKE_CASE code.
- Mixing spellings for one condition (`notFound` beside `NOT_FOUND`), which yields two codes for one condition.
UNLESS
- Test files are excluded.
- Only the `error_code` / `errorCode` key is checked; other string values, including human-readable messages in a separate field, are out of scope.
WHY An error code is the machine key a client branches on, so once a client does, its spelling is API surface; an inconsistent set (`notFound` beside `NOT_FOUND`) produces two codes for one condition that no testing reconciles because both are 'working'. The case convention itself is arbitrary; that it is uniform is not.

EVIDENCE
- bun_security_hygiene_detector reports no ERROR-CODE-FORMAT-001 finding on non-test files.
- Every `error_code` / `errorCode` value in non-test files matches `^[A-Z][A-Z0-9_]+$`.

## coder.bun.logging-console — No console logging in application source

GIVEN A Bun application source file (not a test, vendored or build file).
WHEN Code calls console.log/info/warn/error/debug/trace/dir, for any purpose (log, diagnostic or CLI interface output).
THEN Do not call `console.log`/`info`/`warn`/`error`/`debug`/`trace`/`dir` in application source; log via the structured logger.

PREFER
- `logger.info("processing order", { orderId: order.id });` (the logger owns level, timestamp, correlation).
- CLI whose stdout IS its UI: `process.stdout.write` (errors: `process.stderr.write`); it says it is the interface, not a log.
AVOID
- `console.log("processing", order.id);`; `console.error` too: stderr is still unlevelled, uncorrelated, not queryable.
- Per-file exemptions (none exist); process.stdout.write for output that is really a log.
UNLESS
- Inside a comment or string literal (masked, never flagged).
- Test file or vendored/build directory.
WHY console.* lacks level, timestamp and request correlation, so production logs become one unfilterable stream; a full-stack module may run in the browser, sending output to the user's devtools, not the operator.

EVIDENCE
- bun_security_hygiene_detector reports no LOGGING-PRINT-001 finding across in-scope application source (not only changed files).
- Review: log output goes through the structured logger (levels, timestamps, correlation); CLI interface output uses process.stdout.write / process.stderr.write.

## coder.bun.logging-structured — Pass a structured context object with every logger call

GIVEN Bun code containing a call on a logger receiver (`logger`, `log`, `_logger`, `_log`, `LOG`)
WHEN the call's sole argument is a string literal
THEN Pass a context object as the second argument carrying the fields the line would be searched by; never pass only a bare string literal.

PREFER
- Ask what you would filter by at 3am during an incident and put those fields in the object, e.g. `logger.info("order processed", { orderId, userId, ms });      // right`.
AVOID
- Bare-string calls such as `logger.info("order processed");                              // wrong` — greppable and nothing more, at the one moment it matters.
- Attaching a token or empty object just to satisfy the detector; the rule asks only that SOME context is attached and cannot judge whether the right fields were chosen.
UNLESS
- The call already passes a second argument (not flagged).
- The receiver is not a logger (out of scope).
WHY A log line's value is realised at exactly one moment: when someone is searching for it during an incident; a bare string can only be grepped, while a line carrying `{ orderId, userId }` can be filtered, grouped and joined to a trace.

EVIDENCE
- bun_security_hygiene_detector reports no LOGGING-STRUCTURED-001 finding.

## coder.bun.quality-comments — Keep every TypeScript file at a 10% or higher comment ratio

GIVEN An in-scope .ts/.tsx file (not a test, not vendored/build), changed or not
WHEN its comment lines (line, block, `*` continuations) fall below 10% of non-blank lines
THEN Raise the comment ratio to >=10% by writing down the decisions and constraints invisible to a reader.

PREFER
- Diagnose: module purpose and owned responsibility; non-obvious invariants, upstream/compatibility constraints, failure semantics; obvious implementations intentionally not chosen.
- Document why a choice exists, which invariant a block keeps, or which external constraint forces the shape.
- Use a concise module/GREEN header giving real purpose and runtime context; with a few explanatory lines it clears the floor.
- Place the explanation next to the decision it clarifies.
AVOID
- Comments restating the next line of code.
- Filler, generated prose, repeated headings, or artificially split comment lines to raise the ratio.
- Commenting out dead code instead of deleting it.
- Changing cohesive code solely to manipulate the denominator.
- Stale or misleading comments; any behavior change (tests stay green).
UNLESS
- Test files; vendored/build directories (outside the scan).
WHY Comment-free files almost always hide unwritten non-obvious decisions. 10% is a floor against absence, not a quality measure or prose quota; numerator-padding filler makes the source worse.

EVIDENCE
- The comment-ratio finding (REFACTOR-QUALITY-COMMENTS-TS-001) is gone for the file.
- Every added comment conveys information not already obvious from the code.
- No stale or misleading comments were introduced.
- Behavior remains unchanged and tests stay green.
- The refactor introduces no new ATDD Bun violations.

## coder.bun.quality-mi — Keep every TypeScript file's maintainability index at or above 20

GIVEN Any scanned (non-test, non-vendored, non-build) TypeScript/TSX file
WHEN its approximate SEI maintainability index is evaluated
THEN The file MUST score at least 20 on the approximate SEI maintainability index.

PREFER
- Treat a low score as a sensor for accumulated responsibility; repair cohesion and ownership first. Before optimizing the score, diagnose: responsibilities changing for different reasons, decision-heavy regions and repeated logic dominating the file, missing design context.
- Extract a cohesive responsibility into its own module with a clear ownership boundary.
- Simplify genuinely complex or duplicated logic as part of that extraction.
- Comment only real decisions or invariants.
AVOID
- Filler comments to improve the formula's comment term.
- Splitting at an arbitrary line boundary or into tiny fragments solely to reduce LOC.
- Moving complexity unchanged into a sibling module.
- A generalized abstraction unrelated to the responsibilities already present.
UNLESS
- The file produces zero code lines after comment stripping (scores 100, never fails).
- The file is a test file or in a vendored/build directory (outside the scan).
WHY MI alone judges the whole FILE: a file can pass every per-function threshold yet be unmaintainable through accumulated size and operator density. 20 is deliberately low—below it nobody should be asked to modify the file—and since MI mixes size, branching, density and comments, gaming one term moves the number without making the module easier to change.

EVIDENCE
- bun_ts_metrics_detector no longer reports the triggering MI finding (score >= 20) for the file.
- Fixing the MI finding creates no new length, complexity, duplication or dependency-flow violations.
- Existing behavior and tests remain green after the refactor.
- Each resulting module has a coherent reason to change.
- Dependency direction remains consistent with the existing architecture.
- The refactor introduces no new ATDD Bun violations.
- Diff review shows no filler comments, arbitrary line-boundary splits, or complexity moved unchanged into a sibling module.

## coder.bun.security-hardcoded-secret — Keep secret literals out of source

GIVEN A source or template file that the secret scan covers
WHEN The file contains an AWS access key id, a PEM private-key header, or a password/api-key/token assigned a literal string, whether the literal is new or was already there
THEN Source MUST NOT contain a secret literal.

PREFER
- Move the value to the environment and read it at the edge, e.g. `const apiKey = process.env.API_KEY;`
- If the literal was ever committed, rotate the credential. Removing the line is not enough.
AVOID
- Writing a working credential inline, e.g. `const apiKey = "sk_live_0123456789abcdef";`, even temporarily to get unblocked
- Treating deletion of a committed secret as the fix, because git keeps it
UNLESS
- The file is a `.example`, `.sample` or `.template` placeholder file. These are documentation, not secrets.
- The file is in a vendored or build directory. These are never scanned.
- The value is read from `process.env`. This is never a literal and is not matched.
WHY Git keeps a committed secret, so deleting it does not fix it. Only rotating it does, which is why detection has to happen before the commit rather than in review.

EVIDENCE
- bun_security_hygiene_detector reports no SECURITY-HARDCODED-SECRET-001 finding on any covered source or template file
- Credentials in covered files are read from process.env
- For any secret that was previously committed, the credential has been rotated (not just deleted)

## coder.bun.security-missing-auth — Authorise inside every state-changing route handler

GIVEN A Bun route handler for POST, PUT, PATCH or DELETE (a `routes` entry of `Bun.serve` or a method branch of a `fetch` handler) in non-test source.
WHEN The handler exists in the inspected source (any in-scope mutating handler, changed or not).
THEN The handler body MUST itself call a recognisable authorisation guard before any write.

PREFER
- Call the guard first and let it throw or return early, e.g.
  POST: async (req) => {
    const user = await requireUser(req);   // authorise before any write
    ...
  }
- If the handler delegates to a wrapper that authorises internally, call it by a recognised guard name, or add the wrapper/project guard name to the rule's recognised set.
AVOID
- Relying on auth performed in a sibling route or another handler — it protects nothing for this handler.
- Suppressing the rule because the project uses its own guard helper instead of adding that helper's name to the recognised set.
- Adding auth requirements to GET/HEAD reads to satisfy the rule (out of scope; creates noise on the most common route in the codebase).
UNLESS
- GET and HEAD handlers are out of scope (reads).
- Test files are excluded.
WHY A mutating handler with no auth call is the shape that leaks writes; public GETs are normal in a hypermedia/htmx app (how fragments load), so requiring auth on reads would be noise on the most common route — only mutating methods are checked, deliberately.

EVIDENCE
- bun_security_hygiene_detector reports no SECURITY-MISSING-AUTH-001 finding for any mutating handler in the inspected non-test source.
- Reviewer sees the guard call inside each mutating handler's own body, before any write.

## coder.bun.security-sql-injection — Parameterise SQL; never interpolate or concatenate it

GIVEN Bun-project code calls a query sink (bun:sqlite query/run/exec/prepare, Bun.sql, or a postgres/mysql client method)
WHEN SQL text is passed to that sink
THEN Do not build that SQL by interpolating an untagged template literal or concatenating strings; use a tagged sql`` template or placeholders with bound parameters.

PREFER
- db.query("SELECT * FROM orders WHERE id = ?").get(id)  // bound parameter
- await sql`SELECT * FROM orders WHERE id = ${id}`  // Bun.sql binds
AVOID
- db.query(`SELECT * FROM orders WHERE id = ${id}`)  // untagged: value spliced
- A quoted SQL string followed by + and a value.
- Mistaking an untagged template for a tagged one; they look almost identical.
UNLESS
- Tagged templates (sql`...`) are parameterised by construction and never flagged.
- Template literals with no SQL keyword are not SQL and are skipped.
- Static SQL with no interpolation is not injectable.
WHY A tagged template parameterises each substitution; an untagged template or concatenation yields a finished string before the sink sees it, so values become SQL.

EVIDENCE
- bun_security_hygiene_detector reports no SECURITY-SQL-INJECTION-001 finding on the touched files (a finding is verification evidence, not a precondition for applying the rule).
- Reviewer confirms every query-sink call touched passes either static SQL with no interpolation or concatenation, placeholders with bound parameters, or a tagged sql`` template.
