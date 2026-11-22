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
    const disposition=reason?"SCOPED_CHECK_REQUIRED":notTriggered?"NOT_TRIGGERED_IN_CODE_DELTA":"APPLICABILITY_REVIEW_REQUIRED";
    out.push({ruleId,source,path,sha256:createHash("sha256").update(raw).digest("hex"),
      disposition,reason:reason||notTriggered||"Need a rule-specific applicability and source-evidence decision",
      humanReviewed:false});
  }
}
if(out.length!==376||ids.size!==376)throw Error("canonical source inventory is incomplete");
const statuses=out.reduce((s,x)=>(s[x.disposition]=(s[x.disposition]||0)+1,s),{});
for(const x of out)process.stdout.write("ATD41_CONVENTION_SCOPE "+JSON.stringify(x)+"\n");
const result={total:out.length,uniqueIds:ids.size,sourceCounts:Object.fromEntries(sources.map(x=>[x[0],x[2]])),
  statuses,certification:"NOT_CERTIFIED",next:"Run relevant detectors and obtain independent reviewer/owner gate"};
process.stdout.write("ATD41_CONVENTION_SCOPE_SUMMARY "+JSON.stringify(result)+"\n");
const file=process.argv.find(x=>x.startsWith("--output="))?.slice("--output=".length);
if(file)writeFileSync(file,out.map(x=>JSON.stringify(x)).join("\n")+"\n");
