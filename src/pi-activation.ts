/**
 * Pi-native adapter over the fact-driven ATDD reasoner.
 * Tool interception provides guidance. Post-tool repository inspection observes
 * bypasses. Neither constitutes independent proof of compliance.
 */
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadCatalog, loadConfig, type Catalog, type Selector } from "./catalog.ts";
import { ReasoningSession, type ContextObservation } from "./reasoning-context.ts";
import { renderReasoned } from "./render-reasoning.ts";
import { observeRepository, type RepositorySnapshot } from "./repository-observer.ts";

function scopedPath(cwd:string,supplied:string):string|null {
  const abs=resolve(cwd,supplied), p=relative(cwd,abs);
  if(!p||p===".."||p.startsWith(".."+sep)||isAbsolute(p))return null;
  return p.replaceAll("\\","/");
}
export default function atdd(pi:ExtensionAPI):void {
  let cwdKey="", task="", serial=0;
  let catalog:Catalog|undefined,selectors:Selector[]=[];
  let reasoning:ReasoningSession|undefined;
  let observedRepo:RepositorySnapshot|undefined;
  let observationWarning=false;
  const delivered=new Map<string,string>();
  const unresolvedPaths=new Set<string>();
  const key=(scope:string,id:string)=>scope+"\u0000"+id;
  const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");

  function reset():void{
    reasoning=undefined;delivered.clear();unresolvedPaths.clear();observationWarning=false;
  }
  function ensure(cwd:string):ReasoningSession{
    if(!catalog||cwdKey!==cwd){
      const config=loadConfig(cwd);
      catalog=loadCatalog(config.sources,cwd);
      selectors=config.selectors;
      cwdKey=cwd;reset();
    }
    if(!reasoning)reasoning=new ReasoningSession(catalog,selectors);
    return reasoning;
  }
  const scopeFor=(path?:string)=>"pi-run:"+serial+":"+(path?"file:"+path:"task");
  const currentRevision=()=>observedRepo?.revision??undefined;
  function observe(cwd:string,operation:"task"|"edit"|"create"|"review",
    origin:ContextObservation["origin"],provenance:string,path?:string){
    return ensure(cwd).observe({
      scope:scopeFor(path),task:task||"unknown task",path,operation,origin,provenance,
      ...(currentRevision()?{revision:currentRevision()}:{}),
    });
  }
  function newlyRelevant(result:ReturnType<typeof observe>):string[]{
    for(const id of result.removed)delivered.delete(key(result.scope,id));
    const updated:string[]=[];
    for(const activation of result.activations){
      const signature=digest(activation.proof), k=key(result.scope,activation.id);
      if(delivered.get(k)!==signature){
        updated.push(activation.id);delivered.set(k,signature);
      }
    }
    return updated;
  }
  pi.registerCommand("atdd",{
    description:"Inspect ATDD reasoning activation and remaining graph gaps",
    handler:async(_args,ctx)=>{
      if(!ctx.isProjectTrusted()){ctx.ui.notify("ATDD requires a trusted project","warning");return;}
      try{
        ensure(ctx.cwd);
        ctx.ui.notify("ATDD: "+catalog!.rules.size+" pinned rules, "+
          catalog!.unresolvedEdges.length+" external graph edges; inference is advisory","info");
      }catch(e){ctx.ui.notify("ATDD graph invalid: "+String(e),"error");}
    },
  });
  pi.on("before_agent_start",(event,ctx)=>{
    if(!ctx.isProjectTrusted())return;
    if(event.messageType==="user"){
      serial++;task=event.prompt||"unknown task";reset();
      observedRepo=observeRepository(ctx.cwd).snapshot;
    }
    try{
      const result=observe(ctx.cwd,"task","pi-event","Pi before_agent_start");
      newlyRelevant(result);
      return {message:{customType:"pi-atdd-inference",
        content:renderReasoned(result,undefined,12_000),display:false}};
    }catch(e){
      reset(); // no partially materialized conclusions survive a failed inference
      return {message:{customType:"pi-atdd-error",
        content:"ATDD reasoning failed: "+String(e)+
          ". Unknown obligations are not waivers; repair graph before governed completion.",display:true}};
    }
  });
  pi.on("tool_call",(event,ctx)=>{
    if(!ctx.isProjectTrusted())return;
    if(event.toolName!=="edit"&&event.toolName!=="write")return;
    const input=event.input as {path?:unknown};
    if(typeof input.path!=="string")return {block:true,reason:"ATDD requires a file path for edits."};
    const path=scopedPath(ctx.cwd,input.path);
    if(path===null)return {block:true,reason:"ATDD cannot govern edits outside the repository."};
    try{
      const result=observe(ctx.cwd,event.toolName==="write"?"create":"edit","pi-event",
        "Pi pre-edit tool_call",path);
      const fresh=newlyRelevant(result);
      if(result.status==="incomplete")
        return {block:true,reason:renderReasoned(result,fresh,12_000)+
          "\nMandatory graph dependencies unresolved. Do not proceed until authoritative sources are available."};
      if(fresh.length)
        return {block:true,reason:"ATDD contextual preflight; read reasoning before retrying:\n\n"+
          renderReasoned(result,fresh,12_000)};
      if(result.status==="unknown"&&!unresolvedPaths.has(result.scope)){
        unresolvedPaths.add(result.scope);
        return {block:true,reason:renderReasoned(result,undefined,4_000)+
          "\nInspect canonical rules before retrying; this gap does not certify compliance."};
      }
    }catch(e){reset();return {block:true,reason:"ATDD rule activation failed: "+String(e)};}
  });
  pi.on("tool_execution_end",(event,ctx)=>{
    if(!ctx.isProjectTrusted())return;
    // Custom and shell tools may write without using Pi's edit/write API.
    if(["read","ls","find","grep"].includes(event.toolName))return;
    const report=observeRepository(ctx.cwd,observedRepo);
    if(report.status==="unknown"){
      if(!observationWarning){
        observationWarning=true;
        pi.sendMessage({
          customType:"pi-atdd-observation-gap",display:false,
          content:"ATDD POST-TOOL OBSERVATION UNKNOWN: "+report.reason+
            ". No changed files observed is NOT proof of no changes. Mandatory CI still applies.",
        },{deliverAs:"steer"});
      }
      observedRepo=report.snapshot;return;
    }
    observedRepo=report.snapshot;
    if(!report.changedPaths.length)return;
    const results:string[]=[];
    for(const path of report.changedPaths.slice(0,8)){
      try{
        const result=observe(ctx.cwd,"edit","repository-observation",
          "Git/JJ post-tool observed "+event.toolName,path);
        const fresh=newlyRelevant(result);
        if(fresh.length||result.status!=="matched"){
          results.push("Changed file "+path+":\n"+
            renderReasoned(result,fresh.length?fresh:undefined,5_500));
        }
      }catch(e){
        reset();
        results.push("ATDD post-tool observation failed for "+path+": "+String(e)+
          ". Independent verification remains mandatory.");
      }
    }
    if(report.changedPaths.length>8)results.push("ATDD observed "+
      (report.changedPaths.length-8)+" other changed files; broader impact check required.");
    if(results.length)pi.sendMessage({customType:"pi-atdd-post-tool-reconciliation",
      content:results.join("\n\n").slice(0,18_000),display:false},{deliverAs:"steer"});
  });
}
