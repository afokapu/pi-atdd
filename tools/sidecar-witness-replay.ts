/**
 * ATD-22 OBS-002: bind actual, authored code situations to immutable sidecar
 * case IDs. Never turn the case's natural-language prose into a fake source,
 * detector output, provider phase or success label.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
export function replayQualifiedSidecarWitnesses():WitnessReport {
  const manifest=enumerateSidecarExamples();
  if(manifest.lockFailures.length)throw Error("sidecar source lock drift");
  const lookup=new Map(manifest.examples.map(x=>[key(x.effectiveRuleId,x.kind,x.index),x]));
  const cwd=mkdtempSync(join(tmpdir(),"pi-atdd-obs002-structural-"));
  const cases:WitnessOutcome[]=[];
  try{
    const config=loadConfig(cwd);
    const catalog=loadCatalog(config.sources,cwd);
    const reasoner=new ReasoningSession(catalog,config.selectors);
    for(const sample of WITNESSES){
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
      const structuralProof=/pi-atdd.typed-(?:domain-integration|outward-layer-import)/.test(proof);
      const activated=!!target;
      const structuralPass=sample.expected?structuralProof:!structuralProof;
      const pass=activated===sample.expected&&structuralPass;
      const legacyOveractivation=!sample.expected&&activated&&!structuralProof;
      cases.push({sourceId:sample.sourceId,kind:sample.kind,index:sample.index,
        expected:sample.expected,activated,qualified:true,pass,structuralProof,
        structuralPass,legacyOveractivation,
        sourceLock:original.sourceSha256,basis:sample.structuralBasis,
        ...(!pass ? {unexpectedSupport:target?.reasons ?? []}:{}),
      });
    }
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
