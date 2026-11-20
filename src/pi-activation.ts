/**
 * Pi-native adapter over the fact-driven ATDD reasoner.
 * Tool interception provides guidance. Post-tool repository inspection observes
 * bypasses. Neither constitutes independent proof of compliance.
 */
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadCatalog, loadConfig, type Catalog, type Selector } from "./catalog.ts";
import type { StructureProfile } from "./profile.ts";
import { ReasoningSession, type ContextObservation } from "./reasoning-context.ts";
import { renderReasonedPage, type RenderedPage } from "./render-reasoning.ts";
import { observeRepository, type RepositorySnapshot } from "./repository-observer.ts";
import { shellWriteTargetModes } from "./shell-targets.ts";

function scopedPath(cwd:string,supplied:string):string|null {
  const abs=resolve(cwd,supplied), p=relative(cwd,abs);
  if(!p||p===".."||p.startsWith(".."+sep)||isAbsolute(p))return null;
  // Lexical containment alone is insufficient: an existing in-tree symlink
  // can make the target physically outside the governed checkout.
  try{
    let cursor=realpathSync(cwd);
    const parts=p.split(sep);
    for(const [i,component] of parts.entries()){
      cursor=join(cursor,component);
      try {
        const stat=lstatSync(cursor);
        if(stat.isSymbolicLink())return null; // even in-tree symlinks can be swapped after preflight
        if(i<parts.length-1&&!stat.isDirectory())return null;
      } catch(e){
        if((e as NodeJS.ErrnoException).code==="ENOENT")break;
        return null;
      }
    }
  }catch{return null;}
  return p.replaceAll("\\","/");
}
export default function atdd(pi:ExtensionAPI):void {
  let cwdKey="", task="", serial=0;
  let catalog:Catalog|undefined,selectors:Selector[]=[],profile:StructureProfile|undefined;
  let reasoning:ReasoningSession|undefined;
  let observedRepo:RepositorySnapshot|undefined;
  let observationWarning=false;
  const delivered=new Map<string,string>();
  const unresolvedPaths=new Set<string>();
  /** Post-tool pages whose budget omitted rules; delivered on the next tool result. */
  type Pending={path:string;operation:"edit"|"create";provenance:string};
  const pendingPostTool=new Map<string,Pending>();
  const key=(scope:string,id:string)=>scope+"\u0000"+id;
  const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");

  function reset():void{
    reasoning=undefined;delivered.clear();unresolvedPaths.clear();observationWarning=false;
    pendingPostTool.clear();
  }
  function ensure(cwd:string):ReasoningSession{
    if(!catalog||cwdKey!==cwd){
      const config=loadConfig(cwd);
      catalog=loadCatalog(config.sources,cwd);
      selectors=config.selectors;profile=config.profile;
      cwdKey=cwd;reset();
    }
    if(!reasoning)reasoning=new ReasoningSession(catalog,selectors,profile);
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
  /** Same preflight for a governed path whether it is edited via edit/write or the shell. */
  function preflightPath(cwd:string,path:string,operation:"edit"|"create",provenance:string,
    budget:number,blockUnknown:boolean):{block:true;reason:string}|undefined{
    const result=observe(cwd,operation,"pi-event",provenance,path);
    const fresh=newlyRelevant(result);
    if(result.status==="incomplete"){
      const page=renderReasonedPage(result,fresh,budget);
      recordActualDelivery(result,page);
      return {block:true,reason:page.text+
        "\nMandatory graph dependencies unresolved. Do not proceed until authoritative sources are available."};
    }
    if(fresh.length){
      const page=renderReasonedPage(result,fresh,budget);
      recordActualDelivery(result,page);
      return {block:true,reason:"ATDD contextual preflight for "+path+"; read reasoning before retrying:\n\n"+
        page.text};
    }
    if(blockUnknown&&result.status==="unknown"&&!unresolvedPaths.has(result.scope)){
      unresolvedPaths.add(result.scope);
      return {block:true,reason:renderReasonedPage(result,undefined,4_000).text+
        "\nInspect canonical rules before retrying; this gap does not certify compliance."};
    }
    return undefined;
  }
  pi.on("tool_call",(event,ctx)=>{
    if(!ctx.isProjectTrusted())return;
    if(event.toolName==="bash"){
      // Shell writes get the same rule set as edit/write for every statically
      // visible in-repository target, before the command runs. Targets computed
      // at runtime are caught by post-tool observation below.
      const command=(event.input as {command?:unknown}).command;
      if(typeof command!=="string")return;
      // "write" (whole-file replacement) maps to the write tool's "create"
      // operation, in-place modification to "edit" — the same rule sets.
      const byPath=new Map<string,"edit"|"create">();
      for(const t of shellWriteTargetModes(command)){
        const p=scopedPath(ctx.cwd,t.path);
        if(p===null)continue;
        const op=t.mode==="write"||!existsSync(resolve(ctx.cwd,p))?"create":"edit";
        if(byPath.get(p)!=="create")byPath.set(p,op);
      }
      const targets=[...byPath.keys()];
      const reasons:string[]=[];
      let remaining=12_000;
      try{
        for(const path of targets){
          if(remaining<2_500)break; // targets not yet delivered are preflighted on retry
          const r=preflightPath(ctx.cwd,path,byPath.get(path)!,"Pi pre-shell tool_call (static write target)",
            remaining,false);
          if(r){reasons.push(r.reason);remaining-=r.reason.length;}
        }
      }catch(e){reset();return {block:true,reason:"ATDD rule activation failed: "+String(e)};}
      if(reasons.length)return {block:true,reason:"ATDD shell-write preflight: this command writes "+
        targets.join(", ")+". Read the reasoning, then retry the command.\n\n"+reasons.join("\n\n")};
      return;
    }
    if(event.toolName!=="edit"&&event.toolName!=="write")return;
    const input=event.input as {path?:unknown};
    if(typeof input.path!=="string")return {block:true,reason:"ATDD requires a file path for edits."};
    const path=scopedPath(ctx.cwd,input.path);
    if(path===null)return {block:true,reason:"ATDD cannot govern edits outside the repository."};
    try{
      return preflightPath(ctx.cwd,path,event.toolName==="write"?"create":"edit",
        "Pi pre-edit tool_call",12_000,true);
    }catch(e){reset();return {block:true,reason:"ATDD rule activation failed: "+String(e)};}
  });
  const READ_ONLY_TOOLS=new Set(["read","ls","find","grep"]);
  const reconciledCalls=new Set<string>();
  const reportedGaps=new Set<string>();
  /**
   * Observe the repository after a tool that may write without Pi's edit/write
   * API and return reconciliation texts for changed files. Each page ranks
   * file-specific rules first, so the target rule is never the one dropped.
   */
  /** Render one post-tool page; rules omitted by the budget stay queued. */
  function postToolPage(cwd:string,item:Pending,budget:number):string|undefined{
    const result=observe(cwd,item.operation,"repository-observation",item.provenance,item.path);
    const fresh=newlyRelevant(result);
    if(!fresh.length&&result.status==="matched"){pendingPostTool.delete(item.path);return undefined;}
    const page=renderReasonedPage(result,fresh,budget);
    recordActualDelivery(result,page);
    if(page.omittedIds.length)pendingPostTool.set(item.path,item);else pendingPostTool.delete(item.path);
    return "ATDD post-tool reconciliation. Changed file "+item.path+":\n"+page.text;
  }
  /** Deliver rules a previous post-tool page omitted by budget (next tool result, any tool). */
  function drainPending(cwd:string):string[]{
    const texts:string[]=[];
    for(const item of [...pendingPostTool.values()]){
      try{const t=postToolPage(cwd,item,4_500);if(t)texts.push(t.replace("ATDD post-tool reconciliation.","ATDD post-tool reconciliation (continued)."));}
      catch(e){pendingPostTool.delete(item.path);texts.push("ATDD post-tool continuation failed for "+item.path+": "+String(e));}
    }
    return texts;
  }
  function reconcile(cwd:string,toolName:string):string[]{
    const texts:string[]=[];
    const report=observeRepository(cwd,observedRepo);
    if(report.status==="unknown"){
      if(!observationWarning){
        observationWarning=true;
        texts.push("ATDD POST-TOOL OBSERVATION UNKNOWN: "+report.reason+
          ". No changed files observed is NOT proof of no changes. Mandatory CI still applies.");
      }
      observedRepo=report.snapshot;return texts;
    }
    for(const gap of report.snapshot?.gaps??[])if(!reportedGaps.has(gap)){
      reportedGaps.add(gap);
      texts.push("ATDD POST-TOOL OBSERVATION GAP: "+gap+
        ". Changes there are NOT observed and receive no guidance; mandatory CI and review still apply.");
    }
    observedRepo=report.snapshot;
    // Every changed path is reconciled (none is skipped by a count cap); with
    // many changed files each page is smaller, but still keeps its top rule.
    const perPath=report.changedPaths.length>8?2_000:4_500;
    for(const path of report.changedPaths){
      try{
        const created=report.createdPaths?.includes(path)??false;
        const text=postToolPage(cwd,{path,operation:created?"create":"edit",
          provenance:"Git/JJ post-tool observed "+toolName+(created?" (created)":"")},perPath);
        if(text)texts.push(text);
      }catch(e){
        reset();
        texts.push("ATDD post-tool observation failed for "+path+": "+String(e)+
          ". Independent verification remains mandatory.");
      }
    }
    if(report.changedPaths.length>8)texts.push("ATDD observed "+report.changedPaths.length+
      " changed files in one tool call. Broader independent impact review is required.");
    return texts;
  }
  // Primary channel: attach reconciliation to the tool result itself, so the
  // model reads it before it continues (Pi: tool_result can modify the result).
  pi.on("tool_result",(event,ctx)=>{
    if(!ctx.isProjectTrusted())return;
    let texts:string[];
    try{texts=drainPending(ctx.cwd);}catch{texts=[];}
    if(!READ_ONLY_TOOLS.has(event.toolName)){
      if(event.toolCallId)reconciledCalls.add(event.toolCallId);
      texts.push(...reconcile(ctx.cwd,event.toolName));
    }
    if(!texts.length)return;
    return {content:[...(event.content??[]),{type:"text" as const,text:texts.join("\n\n")}]};
  });
  // Fallback: tools whose result was not reconciled above (e.g. ended without a
  // tool_result) are still observed and steered before the next model call.
  pi.on("tool_execution_end",(event,ctx)=>{
    if(!ctx.isProjectTrusted())return;
    if(READ_ONLY_TOOLS.has(event.toolName))return;
    if(event.toolCallId&&reconciledCalls.delete(event.toolCallId))return;
    for(const text of reconcile(ctx.cwd,event.toolName)){
      const custom=text.startsWith("ATDD POST-TOOL OBSERVATION UNKNOWN")?"pi-atdd-observation-gap":"pi-atdd-post-tool-reconciliation";
      pi.sendMessage({customType:custom,content:text,display:false},{deliverAs:"steer"});
    }
  });
}
