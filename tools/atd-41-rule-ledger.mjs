/**
 * ATD-41 rule-by-rule applicability inventory; never mark a rule compliant
 * from a missing trigger, a lexical selector or an unrelated passing test.
 * Evidence reflects this branch's code delta, not a Bun consumer repository.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

const sources=[
  ["ATDD-Bun","vendor/atdd-bun/conventions",356],
  ["ATDD-Flow","vendor/atdd-flow/conventions",2],
  ["pi-atdd","catalog/pi-atdd/conventions",18],
];
const scoped=new Map(Object.entries({
  "coder.complexity.cyclomatic":"pinned TypeScript metric and method audit",
  "coder.complexity.length":"pinned TypeScript metric and method audit",
  "coder.complexity.nesting":"pinned TypeScript metric and method audit",
  "coder.quality.comments":"pinned TypeScript metric and substantive comment review",
  "coder.quality.mi":"pinned TypeScript metric",
  "coder.logging.console":"TypeScript console call scan",
  "coder.logging.structured":"inspect any logger calls in changed modules",
  "coder.security.hardcoded-secret":"inspect changed source for literal credentials",
  "coder.security.sql-injection":"inspect changed source for query sinks",
  "coder.dead-code.reachability":"review package reachability for new modules",
  "coder.duplication.intra-layer":"review same-layer duplicate fragments",
  "coder.phase.discipline":"original behavioral acceptance and construction constraints",
  "tester.test.isolation-no-live-state":"test source / temporary state audit",
  "tester.test.no-self-skip":"test harness skip audit",
  "tester.red.behavioral-assertion":"behavioral assertions, phase origin review",
  "tester.red.fails-first":"counterfactual RED proof / reviewer",
  "tester.smoke.no-collaborator-substitution":"real Pi RPC smoke rather than a mock-only claim",
  "tester.smoke.observable-assertion":"runtime observation through assembled Pi boundary",
  "reviewer.reconciliation.behavioral":"independent final behavioral review after strict gates",
  "reviewer.inspectability.owner":"owner inspectability and source/proof links",
  "shared.tracker.issue-mandatory":"ATD-41 issue / branch / PR reference",
  "coder.tracker.issue-in-branch-and-pr":"ATD-41 issue, draft PR and ongoing status",
  "shared.convention.propose":"no active convention YAML/selectors edited",
  "shared.handoff.record-contents":"affected Pi handoff path regression",
  "shared.handoff.bounded-chain":"affected Pi handoff path regression",
}));
const knownNonTargets=new Map(Object.entries({
  planner:"No plan/acceptance schema artifacts are changed by Stream B; ATD-22 remains the specification",
  "coder.hypermedia":"No Bun/htmx markup or endpoint is modified in this Node/Pi observer slice",
  "coder.ui":"No product UI implementation is modified",
  "coder.responsive":"No layout or viewport implementation is modified",
  "coder.journey":"No user journey/runtime runner implementation is modified",
  "coder.journey-router":"No journey-router implementation is modified",
  "coder.flow-router":"No Bun flow-router implementation is modified",
  "coder.dto":"No DTO or mapper implementation is modified",
  "coder.green-header":"No Bun GREEN feature source header is authored",
  "coder.green-urn":"No Bun feature-layer URN artifact is authored",
  "tester.hypermedia":"No htmx test is authored",
  "tester.e2e":"No e2e user journey is authored",
  "tester.journey":"No journey test artifact is authored",
  "tester.flow-router":"No Bun flow-router test is authored",
  "tester.visual":"No visual test is authored",
  "tester.responsive":"No responsive test is authored",
  "tester.a11y":"No accessibility UI test is authored",
  "tester.telemetry":"No Bun TelemetryPort contract test is authored",
  "tester.security":"No live HTTP request/authorization test is authored",
  "tester.routing":"No Bun routing-stack test is authored",
}));

// This is an authored scope decision, NOT a semantic compliance result.
// Each rule below has been compared to the actual ATD-41 Node/Pi delivery
// artifacts, the source rule's Given/exception, and the source issue scope.
// Any remaining unclassified rule MUST stay unresolved rather than default-pass.
const explicitScope=new Map();
function scope(ids, disposition, explanation){
  for(const id of ids.split(" ").filter(Boolean)){
    if(explicitScope.has(id)||scoped.has(id))throw Error("duplicate or conflicting scope decision "+id);
    explicitScope.set(id,{disposition,explanation});
  }
}
scope(
  "coder.architecture.capabilities-import coder.architecture.connected coder.architecture.dependency-flow coder.architecture.orphan-export",
  "SOURCE_EXCEPTION_NOT_APPLICABLE",
  "Changed Node/Pi TypeScript modules contain no design-system root, design-layer UI or JSX product components; rule Given requires those artifacts"
);
scope(
  "coder.architecture.hierarchy-import coder.boundaries.http-client coder.commons.application-no-integration coder.commons.cross-feature-imports-in coder.commons.domain-no-framework-import coder.commons.domain-no-outbound coder.composition.consumer coder.composition.root coder.layer.naming",
  "SOURCE_EXCEPTION_NOT_APPLICABLE",
  "Changed runtime modules are package-root src files, not application/domain/integration/presentation/commons feature-layer modules; source rule explicitly skips absent layer roles; code strings inside tests are fixtures"
);
scope(
  "coder.capability.honours-its-contract coder.runtime.executes-the-declaration",
  "PRODUCT_CONTRACT_NOT_DECLARED",
  "ATD-41 changes Pi observation machinery, not a declared Bun product capability flow-data contract or FlowRouterRunner declaration"
);
scope(
  "coder.error-response.bare-string coder.error-response.code-format coder.security.missing-auth",
  "HTTP_RUNTIME_NOT_IN_DELTA",
  "Changed production code does not implement mutating Bun HTTP routes or 4xx/5xx Response payloads; matching Bun.serve and DELETE text exists only as test fixture strings"
);
scope(
  "coder.runtime.server-is-bun-serve coder.runtime.single-lockfile",
  "NODE_PACKAGE_NOT_BUN_APPLICATION",
  "pi-atdd is an npm/Node Pi-extension package with a Node test runner, not a full-stack Bun.serve application or Bun-package-manager repository"
);
scope(
  "coder.runtime.typecheck-enforced",
  "STACK_EQUIVALENT_EVIDENCE",
  "Bun-only input is not met; the cross-stack purpose is independently covered by npm run check invoking tsc --noEmit under strict TypeScript, verified at exact CI SHA"
);
scope(
  "coder.telemetry.forbidden-properties coder.telemetry.implementation-binding coder.telemetry.raw-string-emit coder.telemetry.source-binding coder.telemetry.vendor-sdk",
  "TRACKING_PLAN_NOT_ADOPTED",
  "Local sanitized Pi activation JSONL is not the Bun tracking-plan TelemetryPort; no telemetry/ tracking-plan root or declared telemetry-item contract was introduced"
);
scope(
  "shared.profiles.presets",
  "BUN_ADOPTION_NOT_REQUESTED",
  "This task develops the Pi extension, not an ATDD-Bun consumer's activated profile preset; no atdd-bun.yaml was changed"
);
scope(
  "shared.topology.feature-source-coverage shared.topology.plan-location shared.topology.source-location shared.traceability.source-tested-by-present shared.traceability.source-tested-by-resolves",
  "PRODUCT_PLAN_TOPOLOGY_NOT_MODELED",
  "No product capability/feature/DESIRED OUTCOME tree or component URN source is introduced; plan/acceptances contains package test acceptances, not a modeled Bun product flow"
);
scope(
  "tester.acceptance.binding-declared tester.acceptance.covers-tag-well-formed tester.acceptance.resolves-to-declared tester.test.carries-urn-identity tester.test.imports-bun-test tester.test.phase-declared",
  "BUN_TEST_HARNESS_NOT_APPLICABLE",
  "Changed tests use the declared node:test harness; Bun test URN header, bun:test and phase-file conventions are for adopted Bun test topology; original ATD-22 evidence is separately verified and remains partial"
);
scope(
  "tester.smoke.presentation-smoke-coverage tester.topology.e2e-location tester.topology.feature-test-coverage tester.topology.test-location tester.traceability.plan-executable-acceptance-has-test tester.traceability.test-binding-resolves",
  "PRODUCT_FLOW_TEST_TOPOLOGY_NOT_MODELED",
  "No presentation/ TSX, Bun flow router, product capability test URN or DESIRED OUTCOME acceptance is introduced; real Pi RPC smoke is checked separately"
);
scope(
  "coach.collaboration.accountable-delegation coach.naming.instance-label coach.policy.action-tiers coach.policy.decision-log coach.policy.trivial-request coach.policy.unclear-risk-higher-tier coach.role.orchestrate-not-build",
  "COACH_ROLE_NOT_ASSUMED",
  "ATD-41 is an owner-assigned worker implementation branch, not a Coach window, Coach decision/delegation, or Coach-authored code PR; no independent Coach authority is claimed"
);
scope(
  "coach.workflow.lifecycle",
  "EXTERNAL_COORDINATION_GATE_OPEN",
  "ATD-39/ATD-22 govern intake; no authenticated local atdd-flow Desk/seat evidence is supplied by this isolated GitHub work session; do not infer that a Flow seat was validated"
);
scope(
  "shared.model.escalate-after-two-failures shared.model.names-only-tiers shared.model.subscription-providers shared.model.tier-by-role",
  "MODEL_DELEGATION_NOT_TRIGGERED",
  "No child agent, model tier, provider-family switch or escalation was launched in this feature change"
);
scope(
  "shared.tracker.unconfigured-notice",
  "TRACKER_IS_CONFIGURED",
  "atdd-pi.yaml names the Linear tracker; branch and PR carry ATD-41 and the tracker job passed"
);
scope(
  "shared.vocabulary.legacy-terms",
  "VOCABULARY_MIGRATION_NOT_REQUESTED",
  "No authoritative convention IDs, legacy term-mapping table or identifier/URN migration is part of this branch; frozen source records stay unchanged"
);

function filesUnder(dir){
  const all=[];
  for(const d of readdirSync(dir,{withFileTypes:true})){
    const path=join(dir,d.name);
    if(d.isDirectory())all.push(...filesUnder(path));
    else if(d.isFile() && path.endsWith(".convention.yaml"))all.push(path);
  }
  return all.sort();
}
const out=[],ids=new Set();
for(const [source,root,count] of sources){
  const paths=filesUnder(root);
  if(paths.length!==count)throw Error(source+" source count drift: "+paths.length+" vs "+count);
  for(const path of paths){
    const raw=readFileSync(path,"utf8");
    const doc=YAML.parse(raw);
    const ruleId=doc?.rule_id;
    if(!ruleId || ids.has(ruleId))throw Error("duplicate or missing convention rule id "+String(ruleId));
    ids.add(ruleId);
    const prefix=ruleId.split(".").slice(0,2).join(".");
    const area=ruleId.split(".")[0];
    const reason=scoped.get(ruleId);
    const notTriggered=knownNonTargets.get(prefix) || knownNonTargets.get(area);
    const explicit=explicitScope.get(ruleId);
    const disposition=reason?"SCOPED_CHECK_REQUIRED":explicit?.disposition ??
      (notTriggered?"NOT_TRIGGERED_IN_CODE_DELTA":"APPLICABILITY_REVIEW_REQUIRED");
    out.push({ruleId,source,path,sha256:createHash("sha256").update(raw).digest("hex"),
      disposition,reason:reason||explicit?.explanation||notTriggered||
        "Need a rule-specific applicability and source-evidence decision",
      humanReviewed:false});
  }
}
if(out.length!==376||ids.size!==376)throw Error("canonical source inventory is incomplete");
for(const id of explicitScope.keys())if(!ids.has(id))throw Error("scope decision references unknown rule "+id);
const stillUnresolved=out.filter(x=>x.disposition==="APPLICABILITY_REVIEW_REQUIRED");
if(stillUnresolved.length)
  throw Error("unresolved scope decisions must stay explicit: "+stillUnresolved.map(x=>x.ruleId).join(", "));
const statuses=out.reduce((s,x)=>(s[x.disposition]=(s[x.disposition]||0)+1,s),{});
for(const x of out)process.stdout.write("ATD41_CONVENTION_SCOPE "+JSON.stringify(x)+"\n");
const result={total:out.length,uniqueIds:ids.size,sourceCounts:Object.fromEntries(sources.map(x=>[x[0],x[2]])),
  statuses,certification:"NOT_CERTIFIED",next:"Run relevant detectors and obtain independent reviewer/owner gate"};
process.stdout.write("ATD41_CONVENTION_SCOPE_SUMMARY "+JSON.stringify(result)+"\n");
const file=process.argv.find(x=>x.startsWith("--output="))?.slice("--output=".length);
if(file)writeFileSync(file,out.map(x=>JSON.stringify(x)).join("\n")+"\n");
