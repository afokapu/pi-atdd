/**
 * ATD-41 / OBS-002 complete PLT-81 sidecar case inventory + reproducible
 * text-only reasoner replay. This is a DIAGNOSTIC and cannot qualify an
 * example as a true structural fires/doesNotFire verification: natural-language
 * examples have no inspected file, diff, detector run, phase or provider.
 *
 * Usage:
 *   node --experimental-strip-types tools/sidecar-activation-matrix.ts \
 *     --output=/tmp/atd-41-sidecar-matrix.jsonl
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalRuleId, loadCatalog, loadConfig } from "../src/catalog.ts";
import { ReasoningSession } from "../src/reasoning-context.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SIDECAR = join(ROOT, "conventions-sidecar");
const sha = (path:string)=>createHash("sha256").update(readFileSync(path)).digest("hex");
export type SidecarExample = {
  sourceId:string; effectiveRuleId:string; sourcePath:string;
  sourceSha256:string; sidecarPath:string; sidecarSha256:string;
  kind:"fires"|"doesNotFire"; index:number; text:string;
};
export type SidecarOutcome = SidecarExample & {
  mappedRule:string|null;
  taskTextActivated:boolean;
  qualification:"UNQUALIFIED_TASK_TEXT_ONLY";
  missingEvidence:readonly string[];
};
export type SidecarReplay = {
  totalSources:number; totalRuleVariants:number; totalCases:number;
  fireCases:number; doesNotFireCases:number;
  taskOnlyFireMatches:number; taskOnlyFireMisses:number;
  taskOnlyNegativeMatches:number; taskOnlyNegativeNonMatches:number;
  unmappedCases:number; unqualifiedCases:number;
  sourceLockChecks:number; sourceLockFailures:string[];
  outcomes:SidecarOutcome[];
};

type Entry = {file:string;sourcePath:string;sourceSha256:string;sidecarSha256:string};
type Manifest = {entries:Record<string,Entry>;splits:Record<string,Entry>};

export function enumerateSidecarExamples():{
  sources:number;variants:number;examples:SidecarExample[];lockChecks:number;lockFailures:string[];
}{
  const manifest=JSON.parse(readFileSync(join(SIDECAR,"manifest.json"),"utf8")) as Manifest;
  const examples:SidecarExample[]=[];
  const lockFailures:string[]=[];
  let lockChecks=0,variants=0;
  const append=(sourceId:string,ruleId:string,entry:Entry,part:{
    activation?:{fires?:unknown;doesNotFire?:unknown}
  })=>{
    variants++;
    for(const kind of ["fires","doesNotFire"] as const){
      const list=part.activation?.[kind];
      if(!Array.isArray(list)||!list.length)throw new Error("missing activation examples for "+ruleId+" "+kind);
      list.forEach((value,index)=>{
        if(typeof value!=="string"||!value.trim())throw new Error("invalid example "+ruleId+" "+kind+" "+index);
        examples.push({sourceId,effectiveRuleId:ruleId,sourcePath:entry.sourcePath,
          sourceSha256:entry.sourceSha256,sidecarPath:entry.file,
          sidecarSha256:entry.sidecarSha256,kind,index,text:value});
      });
    }
  };
  for(const [id,entry] of Object.entries(manifest.entries)){
    const file=join(SIDECAR,entry.file);
    lockChecks+=2;
    if(sha(file)!==entry.sidecarSha256)lockFailures.push("sidecar:"+id);
    if(sha(join(ROOT,entry.sourcePath))!==entry.sourceSha256)lockFailures.push("source:"+id);
    const data=JSON.parse(readFileSync(file,"utf8")) as {activation?:{fires?:unknown;doesNotFire?:unknown}};
    append(id,id,entry,data);
  }
  for(const [id,entry] of Object.entries(manifest.splits??{})){
    const file=join(SIDECAR,entry.file);
    lockChecks+=2;
    if(sha(file)!==entry.sidecarSha256)lockFailures.push("split:"+id);
    if(sha(join(ROOT,entry.sourcePath))!==entry.sourceSha256)lockFailures.push("split-source:"+id);
    const data=JSON.parse(readFileSync(file,"utf8")) as {
      parts?:Array<{rule_id:string;activation?:{fires?:unknown;doesNotFire?:unknown}}>;
    };
    if(!data.parts?.length)throw new Error("missing split parts: "+id);
    for(const part of data.parts)append(id,part.rule_id,entry,part);
  }
  return {sources:Object.keys(manifest.entries).length+Object.keys(manifest.splits??{}).length,
    variants,examples,lockChecks,lockFailures};
}

/**
 * Every case is actually given to the current reasoner, but only as untrusted
 * task text: this does not create the file/source/phase/finding situation
 * described in prose. Counts are raw lexical diagnostic behavior, NOT
 * evidence-qualified false-positive/false-negative or OBS-002 acceptance.
 */
export function replayAllSidecarExamples():SidecarReplay {
  const input=enumerateSidecarExamples();
  const cwd=mkdtempSync(join(tmpdir(),"pi-atdd-obs002-"));
  const outcomes:SidecarOutcome[]=[];
  try {
    const config=loadConfig(cwd);
    const catalog=loadCatalog(config.sources,cwd);
    const session=new ReasoningSession(catalog,config.selectors);
    for(const c of input.examples){
      const id=canonicalRuleId(catalog,c.effectiveRuleId);
      const mappedRule=catalog.rules.has(id)?id:null;
      const result=session.observe({
        scope:"sidecar-diagnostic",task:c.text,operation:"task",
        origin:"pi-event",provenance:"sidecar prose only; no observed code/provider",
      });
      const active=!!mappedRule&&result.activations.some(a=>a.id===mappedRule);
      outcomes.push({...c,mappedRule,taskTextActivated:active,
        qualification:"UNQUALIFIED_TASK_TEXT_ONLY",
        missingEvidence:[
          "source_or_diff_not_observed",
          "operation_only_task",
          "trusted_phase_or_detector_not_observed",
          ...(mappedRule?[]:["rule_not_loaded_or_split_part_unresolved"]),
        ],
      });
    }
  }finally{rmSync(cwd,{recursive:true,force:true});}
  const fires=outcomes.filter(x=>x.kind==="fires");
  const negs=outcomes.filter(x=>x.kind==="doesNotFire");
  return {
    totalSources:input.sources,totalRuleVariants:input.variants,totalCases:outcomes.length,
    fireCases:fires.length,doesNotFireCases:negs.length,
    taskOnlyFireMatches:fires.filter(x=>x.taskTextActivated).length,
    taskOnlyFireMisses:fires.filter(x=>!x.taskTextActivated).length,
    taskOnlyNegativeMatches:negs.filter(x=>x.taskTextActivated).length,
    taskOnlyNegativeNonMatches:negs.filter(x=>!x.taskTextActivated).length,
    unmappedCases:outcomes.filter(x=>!x.mappedRule).length,
    unqualifiedCases:outcomes.length,
    sourceLockChecks:input.lockChecks,sourceLockFailures:input.lockFailures,
    outcomes,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url)===fileURLToPath(new URL("file://"+process.argv[1]))) {
  const report=replayAllSidecarExamples();
  const output=process.argv.find(arg=>arg.startsWith("--output="))?.slice("--output=".length);
  if(output)writeFileSync(output,report.outcomes.map(x=>JSON.stringify(x)).join("\n")+"\n");
  const {outcomes,...summary}=report;
  console.log("ATD41_OBS002_TASK_ONLY_FULL_MATRIX "+JSON.stringify(summary));
  console.log("ATD41_OBS002_VERDICT PARTIAL: every example replayed as text but ALL lack independently observed structural situations; read per-case JSONL for complete gap inventory.");
}
