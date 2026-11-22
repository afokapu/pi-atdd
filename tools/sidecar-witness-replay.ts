/**
 * ATD-22 OBS-002: bind actual, authored code situations to immutable sidecar
 * case IDs. Never turn the case's natural-language prose into a fake source,
 * detector output, provider phase or success label.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog, loadConfig, canonicalRuleId } from "../src/catalog.ts";
import { ReasoningSession, type ContextObservation } from "../src/reasoning-context.ts";
import { enumerateSidecarExamples, replayAllSidecarExamples } from "./sidecar-activation-matrix.ts";

export type SourceWitness = {
  sourceId:string; kind:"fires"|"doesNotFire"; index:number;
  path:string; proposed:string; prior:string;
  operation:"edit"|"create"; expected:boolean; structuralBasis:string;
};
const OLD="export const value=1;\n";
const outbound=(layer:string)=>'import {Service} from "../'+layer+'/Service";\n'+OLD;
// These are independently written executable programs keyed to exact case
// indices. Descriptive sidecar prose is never interpreted as source syntax.
const WITNESSES: readonly SourceWitness[] = [
  {sourceId:"coder.architecture.hierarchy-import",kind:"fires",index:0,
    path:"src/orders/domain/price.ts",proposed:outbound("integration"),prior:OLD,
    operation:"create",expected:true,structuralBasis:"domain to integration"},
  {sourceId:"coder.architecture.hierarchy-import",kind:"fires",index:1,
    path:"src/orders/application/use.ts",proposed:outbound("presentation"),prior:OLD,
    operation:"create",expected:true,structuralBasis:"application to presentation"},
  {sourceId:"coder.architecture.hierarchy-import",kind:"fires",index:2,
    path:"src/orders/integration/gateway.ts",proposed:outbound("presentation"),prior:OLD,
    operation:"create",expected:true,structuralBasis:"integration to presentation"},
  {sourceId:"coder.architecture.hierarchy-import",kind:"fires",index:3,
    path:"src/orders/features/checkout/domain/price.ts",
    proposed:'import {Service} from "../integration/Service";\n'+OLD,prior:OLD,
    operation:"create",expected:true,structuralBasis:"feature-local outward import"},
  {sourceId:"coder.architecture.hierarchy-import",kind:"fires",index:4,
    path:"src/orders/domain/price.ts",proposed:outbound("integration"),
    prior:outbound("domain"),operation:"edit",expected:true,
    structuralBasis:"existing import target changed to outward"},
  {sourceId:"coder.architecture.hierarchy-import",kind:"doesNotFire",index:0,
    path:"src/orders/assembly/wiring.ts",proposed:outbound("integration"),prior:OLD,
    operation:"create",expected:false,structuralBasis:"composition root exemption"},
  {sourceId:"coder.architecture.hierarchy-import",kind:"doesNotFire",index:1,
    path:"src/orders/domain/price.test.ts",proposed:outbound("integration"),prior:OLD,
    operation:"create",expected:false,structuralBasis:"test file excluded"},
  {sourceId:"coder.architecture.hierarchy-import",kind:"doesNotFire",index:2,
    path:"vendor/src/orders/domain/price.ts",proposed:outbound("integration"),prior:OLD,
    operation:"create",expected:false,structuralBasis:"vendored code excluded"},
  {sourceId:"coder.architecture.hierarchy-import",kind:"doesNotFire",index:3,
    path:"src/orders/domain/price.ts",proposed:'import ts from "typescript";\n'+OLD,
    prior:OLD,operation:"create",expected:false,structuralBasis:"bare external package"},
  {sourceId:"coder.architecture.hierarchy-import",kind:"doesNotFire",index:4,
    path:"src/orders/helpers.ts",proposed:outbound("integration"),prior:OLD,
    operation:"create",expected:false,structuralBasis:"unlayered file excluded"},
];
// Split conventions share a parent source ID. The *effective variant* is the
// unique replay identity; keying by the parent silently drops split examples.
const key=(sourceId:string,kind:string,index:number)=>sourceId+"\0"+kind+"\0"+index;
export type WitnessOutcome = {
  sourceId:string;kind:"fires"|"doesNotFire";index:number;
  expected:boolean;activated:boolean;qualified:boolean;pass:boolean;
  /** Independent code witness, distinct from backward-compatible path guidance. */
  structuralProof:boolean;structuralPass:boolean;legacyOveractivation:boolean;
  sourceLock:string;basis:string;
  unexpectedSupport?:string[];
};
export type WitnessReport = {
  allCases:number;verified:number;passed:number;failed:number;unqualified:number;
  structuralPassed:number;legacyOveractivations:number;
  cases:readonly WitnessOutcome[];
  failures:readonly WitnessOutcome[];
};

/** Every witness is identified by a frozen case, never free-floating examples. */
type PinnedExample=ReturnType<typeof enumerateSidecarExamples>["examples"][number];
/** Execute one independently authored file/diff witness. The natural-language
 * case text is used only to pin its identity, never as source or trusted phase.
 */
function evaluateWitness(sample:SourceWitness,lookup:ReadonlyMap<string,PinnedExample>,
  catalog:ReturnType<typeof loadCatalog>,reasoner:ReasoningSession):WitnessOutcome {
  const original=lookup.get(key(sample.sourceId,sample.kind,sample.index));
  if(!original)throw Error("missing pinned sidecar case "+JSON.stringify(sample));
  const rule=canonicalRuleId(catalog,original.effectiveRuleId);
  if(!catalog.rules.has(rule))throw Error("unmapped canonical source rule "+rule);
  const input:ContextObservation={
    scope:"witness:"+sample.kind+":"+sample.index,
    task:"Carry out a local source proposal",operation:sample.operation,
    origin:"pi-event",provenance:"independently authored source witness",
    path:sample.path,sourceText:sample.proposed,priorSourceText:sample.prior,
  };
  const result=reasoner.observe(input);
  const target=result.activations.find(x=>x.id===rule);
  const proof=JSON.stringify(target?.proof??null);
  // Guidance may activate for a path without proving a forbidden dependency.
  // Keep the contextual activation and independent structural proof separate.
  const structuralProof=/pi-atdd.typed-(?:domain-integration|outward-layer-import)/.test(proof);
  const activated=!!target;
  const structuralPass=sample.expected?structuralProof:!structuralProof;
  const pass=activated===sample.expected&&structuralPass;
  const legacyOveractivation=!sample.expected&&activated&&!structuralProof;
  return {sourceId:sample.sourceId,kind:sample.kind,index:sample.index,
    expected:sample.expected,activated,qualified:true,pass,structuralProof,
    structuralPass,legacyOveractivation,
    sourceLock:original.sourceSha256,basis:sample.structuralBasis,
    ...(!pass?{unexpectedSupport:target?.reasons??[]}:{}),
  };
}
/** Qualify only evidence with an independently inspectable AST/source change.
 * The 2,579-case source lock remains exhaustive even when most cases have
 * no executable witness and therefore cannot honestly be declared PASS.
 */
export function replayQualifiedSidecarWitnesses():WitnessReport {
  const manifest=enumerateSidecarExamples();
  if(manifest.lockFailures.length)throw Error("sidecar source lock drift");
  // Split part IDs, not their shared parent source ID, identify replay cases.
  const lookup=new Map(manifest.examples.map(x=>[key(x.effectiveRuleId,x.kind,x.index),x]));
  const cwd=mkdtempSync(join(tmpdir(),"pi-atdd-obs002-structural-"));
  const cases:WitnessOutcome[]=[];
  try{
    const config=loadConfig(cwd);
    const catalog=loadCatalog(config.sources,cwd);
    const reasoner=new ReasoningSession(catalog,config.selectors);
    for(const sample of WITNESSES)cases.push(evaluateWitness(sample,lookup,catalog,reasoner));
  }finally{rmSync(cwd,{recursive:true,force:true});}
  const originalCases=new Set(manifest.examples.map(x=>key(x.effectiveRuleId,x.kind,x.index)));
  if(originalCases.size!==manifest.examples.length)throw Error("duplicate source case identity");
  const evaluated=new Set(cases.map(x=>key(x.sourceId,x.kind,x.index)));
  if(evaluated.size!==cases.length)throw Error("duplicate executable witness");
  const failures=cases.filter(x=>!x.pass);
  return {allCases:manifest.examples.length,verified:cases.length,
    passed:cases.length-failures.length,failed:failures.length,
    structuralPassed:cases.filter(x=>x.structuralPass).length,
    legacyOveractivations:cases.filter(x=>x.legacyOveractivation).length,
    unqualified:originalCases.size-evaluated.size,cases,failures};
}

/** Keeps every unfurnished example visible with a named reason, never PASS.
 * The source-text diagnostic is still separate from executable observations.
 */
export function fullWitnessGapSummary() {
  const full=replayAllSidecarExamples();
  const qualified=replayQualifiedSidecarWitnesses();
  const seen=new Set(qualified.cases.map(x=>key(x.sourceId,x.kind,x.index)));
  // Full-corpus text replay is still diagnostic-only: every other case lacks
  // an independently witnessed file, delta, phase or detector situation.
  const unqualified=full.outcomes.filter(x=>!seen.has(key(x.effectiveRuleId,x.kind,x.index)));
  return {total:full.totalCases,qualified:qualified.verified,
    pass:qualified.passed,fail:qualified.failed,
    structuralPassed:qualified.structuralPassed,
    legacyOveractivations:qualified.legacyOveractivations,
    unqualified:unqualified.length,
    gaps:unqualified.map(x=>({rule:x.effectiveRuleId,kind:x.kind,index:x.index,
      sourceSha256:x.sourceSha256,reason:"no independent executable source/provider/detector witness"})),
  };
}

/** Reviewer-facing complete JSONL report. A source-locked case may have both a
 * text-only diagnostic and a qualified executable result; the latter is only
 * present when a real independent source witness exists for this exact case.
 */
export function qualifiedCaseRows() {
  const full=replayAllSidecarExamples();
  const witnessed=replayQualifiedSidecarWitnesses();
  const lookup=new Map(witnessed.cases.map(x=>[key(x.sourceId,x.kind,x.index),x]));
  return full.outcomes.map(item=>{
    const witness=lookup.get(key(item.effectiveRuleId,item.kind,item.index));
    return {
      ruleId:item.effectiveRuleId,kind:item.kind,index:item.index,
      sourceSha256:item.sourceSha256,sidecarSha256:item.sidecarSha256,
      qualification:witness?(witness.pass?"EXECUTABLE_PASS":"EXECUTABLE_FAIL"):
        "UNQUALIFIED_NO_INDEPENDENT_OBSERVATION",
      expected:item.kind==="fires",
      ...(witness?{activated:witness.activated,structuralProof:witness.structuralProof,
        structuralPass:witness.structuralPass,legacyOveractivation:witness.legacyOveractivation,
        basis:witness.basis,unexpectedSupport:witness.unexpectedSupport??[]}:
        {missingEvidence:item.missingEvidence,taskOnlyActivated:item.taskTextActivated}),
    };
  });
}
if(process.argv[1] && fileURLToPath(import.meta.url)===fileURLToPath(new URL("file://"+process.argv[1]))) {
  const rows=qualifiedCaseRows();
  const path=process.argv.find(x=>x.startsWith("--output="))?.slice("--output=".length);
  if(path)writeFileSync(path,rows.map(x=>JSON.stringify(x)).join("\n")+"\n");
  const qualified=rows.filter(x=>x.qualification!=="UNQUALIFIED_NO_INDEPENDENT_OBSERVATION");
  const status={
    total:rows.length,qualified:qualified.length,
    passed:qualified.filter(x=>x.qualification==="EXECUTABLE_PASS").length,
    failed:qualified.filter(x=>x.qualification==="EXECUTABLE_FAIL").length,
    unqualified:rows.length-qualified.length,
    acceptance:"PARTIAL_NOT_FULL_CORPUS",
  };
  process.stdout.write("ATD22_OBS002_SOURCE_REPLAY_SUMMARY "+JSON.stringify(status)+"\n");
}
