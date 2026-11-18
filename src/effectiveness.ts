/**
 * D008: an independently runnable acceptance witness, NOT a fake model benchmark.
 *
 * Never trust an agent's "tests passed" message. Re-run executable targets in
 * the produced workspace; keep review authenticity outside this local helper.
 */
import { execFileSync } from "node:child_process";
import { verifyTargets } from "./verify.ts";

export type Trial = {
  taskId:string; modelId:string; tier:"weak"|"strong";
  condition:"baseline"|"graph"; runClass:"fixture"|"model-run";
  baseRevision:string; resultRevision:string; workspace:string;
  testTargets:string[]; claimedPassed:boolean;
  injectedTokens:number; wallMs:number;
  transcriptDigest?:string; reviewerEvidence?:{source:string;locator:string;digest:string};
};
export type TrialResult = {
  trial:Trial; passed:boolean; falseClaim:boolean; durationMs:number;
  actualExitCode:number|null; diagnostic:string;
};
export type Comparison = {
  taskId:string; modelId:string; tier:Trial["tier"];
  status:"NOT_RUN"|"FIXTURE_ONLY"|"MEASURED_NOT_EXTERNALLY_REVIEWED"|"READY_FOR_INDEPENDENT_JUDGMENT";
  baseline?:TrialResult; graph?:TrialResult;
  passDelta?:number; latencyDeltaMs?:number; tokenDelta?:number;
};
const nonEmpty=(x:string)=>typeof x==="string"&&x.length>0;
function git(cwd:string,args:string[]):string {
  return execFileSync("git",args,{cwd,encoding:"utf8",timeout:4000,maxBuffer:500_000,
    windowsHide:true}).trim();
}
function head(cwd:string):string { return git(cwd,["rev-parse","HEAD"]); }
function trustedTestsUnmodified(trial:Trial):void {
  if(git(trial.workspace,["status","--porcelain","--untracked-files=all"]))
    throw new Error("trial worktree is dirty; claimed revision does not identify the tested code");
  try {git(trial.workspace,["merge-base","--is-ancestor",trial.baseRevision,trial.resultRevision]);}
  catch {throw new Error("trial base revision is not an ancestor of the result");}
  for(const target of trial.testTargets){
    if(target.startsWith("-")||target.startsWith("/")||target.includes(".."))
      throw new Error("invalid trusted acceptance target");
    const original=git(trial.workspace,["ls-tree","-r","--name-only",trial.baseRevision,"--",target]);
    if(!original.split("\n").includes(target))
      throw new Error("trusted acceptance target absent from immutable base: "+target);
    const changed=git(trial.workspace,["diff","--no-ext-diff","--name-only",
      trial.baseRevision,trial.resultRevision,"--",target]);
    if(changed)throw new Error("trial mutated independently owned acceptance target: "+target);
  }
}
export function verifyTrial(trial:Trial):TrialResult {
  if(!nonEmpty(trial.taskId)||!nonEmpty(trial.modelId)||!nonEmpty(trial.baseRevision)
      ||!nonEmpty(trial.resultRevision)||!nonEmpty(trial.workspace)
      ||!Array.isArray(trial.testTargets)||!trial.testTargets.length
      ||!Number.isInteger(trial.injectedTokens)||trial.injectedTokens<0
      ||!Number.isFinite(trial.wallMs)||trial.wallMs<0)
    throw new Error("trial is incomplete; do not score a claimed outcome");
  const actualRevision=head(trial.workspace);
  if(actualRevision!==trial.resultRevision)throw new Error("trial workspace revision does not match claimed result");
  trustedTestsUnmodified(trial);
  const evidence=verifyTargets(trial.workspace,trial.testTargets);
  const passed=evidence.status==="passed";
  return {trial,passed,falseClaim:trial.claimedPassed&&!passed,
    durationMs:evidence.durationMs,actualExitCode:evidence.exitCode,
    diagnostic:evidence.status+"; tests independently re-run against "+actualRevision};
}
export function compareTrials(records:TrialResult[]):Comparison[] {
  const groups=new Map<string,TrialResult[]>();
  for(const result of records){
    const t=result.trial, id=JSON.stringify([t.taskId,t.modelId,t.tier,t.baseRevision]);
    groups.set(id,[...(groups.get(id)??[]),result]);
  }
  return [...groups.values()].map(group=>{
    const first=group[0]!.trial;
    const entries=group.filter(t=>t.trial.condition==="baseline");
    const guided=group.filter(t=>t.trial.condition==="graph");
    const base={taskId:first.taskId,modelId:first.modelId,tier:first.tier};
    if(entries.length!==1||guided.length!==1)return {...base,status:"NOT_RUN" as const};
    const baseline=entries[0]!,graph=guided[0]!;
    const status:Comparison["status"]=
      baseline.trial.runClass==="fixture"||graph.trial.runClass==="fixture"
        ? "FIXTURE_ONLY"
        : !baseline.trial.transcriptDigest||!graph.trial.transcriptDigest
          ? "MEASURED_NOT_EXTERNALLY_REVIEWED"
          : !baseline.trial.reviewerEvidence||!graph.trial.reviewerEvidence
            ? "MEASURED_NOT_EXTERNALLY_REVIEWED"
            : "READY_FOR_INDEPENDENT_JUDGMENT";
    return {...base,status,baseline,graph,
      passDelta:Number(graph.passed)-Number(baseline.passed),
      latencyDeltaMs:graph.trial.wallMs-baseline.trial.wallMs,
      tokenDelta:graph.trial.injectedTokens-baseline.trial.injectedTokens};
  });
}
export function decisionEffectivenessStatus(comparisons:Comparison[]):{
  status:"NOT_RUN"|"INCOMPLETE"|"READY_FOR_EXTERNAL_REVIEW";
  missing:string[];
} {
  if(!comparisons.length)return {status:"NOT_RUN",missing:["No measured weak/strong model pairs"]};
  const weak=comparisons.filter(c=>c.tier==="weak");
  const strong=comparisons.filter(c=>c.tier==="strong");
  const missing=[
    ...(!weak.length?["No weak-model pair"]:[]),
    ...(!strong.length?["No strong-model pair"]:[]),
    ...comparisons.filter(c=>c.status!=="READY_FOR_INDEPENDENT_JUDGMENT")
      .map(c=>"Not independently attestable: "+c.taskId+" / "+c.modelId+" ("+c.status+")"),
  ];
  return {status:missing.length?"INCOMPLETE":"READY_FOR_EXTERNAL_REVIEW",missing};
}
