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
import { renderReasonedPage, type RenderedPage } from "./render-reasoning.ts";
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
      if(delivered.get(k)!==signature)updated.push(activation.id);
    }
    return updated;
  }
  function recordActualDelivery(result:ReturnType<typeof observe>,page:RenderedPage):void{
    for(const id of page.emittedIds){
      const activation=result.activations.find(item=>item.id===id);
      if(activation)delivered.set(key(result.scope,id),digest(activation.proof));
    }
  }
  function restoreFromBranch(ctx:{cwd:string;sessionManager:{getBranch:()=>unknown[]}}):void{
    serial++;reset();
    const entries=ctx.sessionManager.getBranch();
    const last=[...entries].reverse().find(value=>{
      const entry=value as {type?:string;message?:{role?:string}};
      return entry.type==="message"&&entry.message?.role==="user";
    }) as {message?:{content?:unknown}}|undefined;
    const content=last?.message?.content;
    const text=typeof content==="string"?content:Array.isArray(content)?
      content.filter(x=>x?.type==="text"&&typeof x.text==="string").map(x=>x.text).join("\n"):"";
    task=text||"unknown task (session resume requires authoritative task lookup)";
    observedRepo=observeRepository(ctx.cwd).snapshot;
  }
  // Branch changes and session replacements invalidate a predecessor's
  // ephemeral inference state. Reconstruct the last user task if available,
  // but never infer an authenticated role or revision from chat text.
  pi.on("session_start",(_event,ctx)=>{
    if(ctx.isProjectTrusted())restoreFromBranch(ctx);
  });
  pi.on("session_tree",(_event,ctx)=>{
    if(ctx.isProjectTrusted())restoreFromBranch(ctx);
  });
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
    const newTask=event.messageType==="user";
    if(newTask){
      serial++;task=event.prompt||"unknown task";reset();
      observedRepo=observeRepository(ctx.cwd).snapshot;
    }
    try{
      const result=observe(ctx.cwd,"task","pi-event","Pi before_agent_start");
      const newRules=newlyRelevant(result);
      if(!newTask&&!newRules.length)return;
      const page=renderReasonedPage(result,newRules,12_000);
      recordActualDelivery(result,page);
      return {message:{customType:"pi-atdd-inference",
        content:page.text,display:false}};
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
      if(result.status==="incomplete"){
        const page=renderReasonedPage(result,fresh,12_000);
        recordActualDelivery(result,page);
        return {block:true,reason:page.text+
          "\nMandatory graph dependencies unresolved. Do not proceed until authoritative sources are available."};
      }
      if(fresh.length){
        const page=renderReasonedPage(result,fresh,12_000);
        recordActualDelivery(result,page);
        return {block:true,reason:"ATDD contextual preflight; read reasoning before retrying:\n\n"+
          page.text};
      }
      if(result.status==="unknown"&&!unresolvedPaths.has(result.scope)){
        unresolvedPaths.add(result.scope);
        return {block:true,reason:renderReasonedPage(result,undefined,4_000).text+
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
    for(const path of report.changedPaths.slice(0,8)){
      try{
        const result=observe(ctx.cwd,"edit","repository-observation",
          "Git/JJ post-tool observed "+event.toolName,path);
        const fresh=newlyRelevant(result);
        if(fresh.length||result.status!=="matched"){
          const page=renderReasonedPage(result,fresh,4_500);
          pi.sendMessage({customType:"pi-atdd-post-tool-reconciliation",
            content:("Changed file "+path+":\n"+page.text).slice(0,5_000),
            display:false},{deliverAs:"steer"});
          recordActualDelivery(result,page); // Only after a message was sent
        }
      }catch(e){
        reset();
        pi.sendMessage({customType:"pi-atdd-post-tool-reconciliation",display:false,
          content:"ATDD post-tool observation failed for "+path+": "+String(e)+
            ". Independent verification remains mandatory."},{deliverAs:"steer"});
      }
    }
    if(report.changedPaths.length>8)pi.sendMessage({
      customType:"pi-atdd-post-tool-reconciliation",display:false,
      content:"ATDD observed "+(report.changedPaths.length-8)+
        " additional changed files. Broader independent impact review is required.",
    },{deliverAs:"steer"});
  });
}
