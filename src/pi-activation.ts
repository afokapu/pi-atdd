/**
 * Pi-native adapter over the fact-driven ATDD reasoner.
 * Tool interception provides guidance. Post-tool repository inspection observes
 * bypasses. Neither constitutes independent proof of compliance.
 */
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { existsSync, lstatSync, realpathSync, readFileSync, statSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadCatalog, loadConfig, type Catalog, type Selector } from "./catalog.ts";
import { ReasoningSession, type ContextObservation } from "./reasoning-context.ts";
import { renderReasonedPage, type RenderedPage } from "./render-reasoning.ts";
import { observeRepository, type RepositorySnapshot } from "./repository-observer.ts";
import { shellWriteTargetModes } from "./shell-targets.ts";
import { registerAttentionStrip } from "./attention-strip.ts";
import { appendActivation, activationPathCategory, formatActivationSummary, type ActivationEvent, type ActivationPoint } from "./activation-telemetry.ts";
import { performance } from "node:perf_hooks";
import type { Proof } from "./inference.ts";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { MODE_FILE, guardsAtdd, modeFromText, recordMode, repositoryRoot, resolveMode, type Mode, type Resolution } from "./mode.ts";

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
/** PLT-93 AP-006: a target outside the repository, lexically and physically, is not ATDD's to govern. */
function outsideRepository(cwd:string,supplied:string):boolean{
  const root=repositoryRoot(cwd);
  if(!root)return true;
  const outside=(base:string,p:string)=>{const r=relative(base,p);return r===".."||r.startsWith(".."+sep)||isAbsolute(r);};
  const abs=resolve(cwd,supplied);
  if(!outside(root,abs))return false;
  // Resolve the deepest existing ancestor so an outside symlink cannot point back into the repository.
  let cursor=abs;const rest:string[]=[];
  for(;;){
    try{lstatSync(cursor);break;}catch{}
    if(dirname(cursor)===cursor)break;
    rest.unshift(basename(cursor));cursor=dirname(cursor);
  }
  try{return outside(realpathSync(root),join(realpathSync(cursor),...rest));}catch{return false;}
}
/** PLT-94: the model reads intent; the extension only exposes the switch, guarded. */
const INTENT_TOOL="set_atdd_mode";
const INTENT_RULE="Use set_atdd_mode when the user signals, in any wording or language, that the work is exploratory, "+
  "throwaway, a scratchpad, a spike or a prototype: propose plain mode (in a repository that declares ATDD, set_atdd_mode "+
  "asks the user to confirm and refuses without a yes); never switch to plain to avoid a convention.";
const oneLine=(s:string)=>s.replace(/\s+/g," ").trim().slice(0,160);
const MODE_CHOICES=["ATDD — remember for this repo","Plain — remember for this repo",
  "ATDD — this session only","Plain — this session only"];
export default function atdd(pi:ExtensionAPI):void {
  registerAttentionStrip(pi); // PLT-101: inert unless PI_ATDD_ATTENTION_ROLE is set
  let cwdKey="", task="", serial=0;
  let catalog:Catalog|undefined,selectors:Selector[]=[];
  let reasoning:ReasoningSession|undefined;
  let observedRepo:RepositorySnapshot|undefined;
  let observationWarning=false;
  let telemetryWarning=false;
  const sessionId=randomUUID();
  const delivered=new Map<string,string>();
  const unresolvedPaths=new Set<string>();
  /** Post-tool pages whose budget omitted rules; delivered on the next tool result. */
  type Pending={path:string;operation:"edit"|"create";provenance:string};
  const pendingPostTool=new Map<string,Pending>();
  const key=(scope:string,id:string)=>scope+"\u0000"+id;
  const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
  /** PLT-93 working mode for this session; undefined until resolved. */
  let current:Resolution|undefined;
  const active=(cwd:string)=>current?.mode==="atdd"&&repositoryRoot(cwd)!==null;
  /** Only closed, stable identifiers from proof nodes are logged: never prose, code, or paths. */
  function evidenceIds(result: ReturnType<ReasoningSession["observe"]>):string[]{
    const found = new Set<string>();
    const visit = (proof: Proof):void => {
      const name=proof.fact.predicate, args=proof.fact.args;
      if(name==="selector_hit" && args[1])found.add("selector:"+args[1]);
      if(name==="code_construct" && args[1])found.add("ast:"+args[1]);
      if(name==="file_layer" && args[1])found.add("layer:"+args[1]);
      if(name==="phase" && args[1])found.add("phase:"+args[1]);
      for(const d of proof.derivations) for(const p of d.premises)visit(p);
    };
    for(const activation of result.activations) visit(activation.proof);
    return [...found].sort();
  }
  function record(cwd:string, event:ActivationEvent):void{
    const outcome=appendActivation(cwd,{...event,sessionId,catalogDigest:catalog?.provenance[0]?.digest});
    if(!outcome.ok&&!telemetryWarning){
      telemetryWarning=true;
      try{pi.sendMessage({customType:"pi-atdd-telemetry-gap",
        content:"ATDD local telemetry unavailable ("+outcome.reason+"); discovery guidance is unaffected.",
        display:false},{deliverAs:"steer"});}catch{/* Observability must never block work. */}
    }
  }
  function recordReasoned(cwd:string,point:ActivationPoint,operation:"task"|"edit"|"create",
    path:string|undefined,result:ReturnType<ReasoningSession["observe"]>,
    fresh:readonly string[],page:RenderedPage|undefined,started:number):void{
    record(cwd,{point,operation,pathCategory:activationPathCategory(path),outcome:result.status,
      reasonCode:result.status==="incomplete"?"mandatory_dependency_missing":
        result.status==="unknown"?"no_applicability_evidence":"graph_activation",
      ruleIds:result.activations.map(a=>a.id),evidenceIds:evidenceIds(result),
      delivered:page?.emittedIds.length??0,deduplicated:Math.max(0,result.activations.length-fresh.length),
      omitted:page?.omittedIds.length??0,durationMs:performance.now()-started});
  }
  /** Pi tool proposals are observed before execution; changed file content is observed afterward. */
  function sourceFor(cwd:string,path:string,input?:{content?:unknown;oldText?:unknown;newText?:unknown}):string|undefined{
    if(scopedPath(cwd,path)===null)return undefined; // avoid reading an untrusted symlink during post-tool inspection
    if(typeof input?.content==="string")return input.content.length<=1_000_000?input.content:undefined;
    let current:string|undefined;
    try{
      const abs=resolve(cwd,path);
      if(!existsSync(abs)||statSync(abs).size>1_000_000)return undefined;
      current=readFileSync(abs,"utf8");
    }catch{return undefined;}
    if(typeof input?.oldText==="string"&&typeof input.newText==="string"){
      const parts=current.split(input.oldText);
      if(parts.length===2)return parts[0]+input.newText+parts[1];
    }
    return current;
  }
  type Notify={cwd:string;ui:{notify:(message:string,type?:"info"|"warning"|"error")=>void}};
  function setMode(ctx:Notify,mode:Mode,source:string,announce=true):boolean{
    const changed=current?.mode!==mode;
    current={mode,source};
    if(!changed)return false;
    reset(); // a mode switch starts from a fresh repository baseline
    if(active(ctx.cwd))observedRepo=observeRepository(ctx.cwd).snapshot;
    if(announce)ctx.ui.notify("ATDD mode: "+mode+" ("+source+")","info");
    return true;
  }
  type IntentCtx=Notify&{mode:string;hasUI:boolean;isProjectTrusted:()=>boolean;
    ui:{confirm:(title:string,message:string)=>Promise<boolean>}};
  /** set_atdd_mode: every call is announced in one line and logged; plain in an ATDD repo needs the user's yes. */
  async function switchByIntent(ctx:IntentCtx,mode:Mode,rawReason:string){
    const reason=oneLine(rawReason||"no reason given");
    const finish=(outcome:"switched"|"unchanged"|"refused",text:string)=>{
      ctx.ui.notify(text,outcome==="refused"?"warning":"info");
      pi.appendEntry("pi-atdd-mode",{mode,reason,outcome,cwd:ctx.cwd});
      return {content:[{type:"text" as const,text}],details:{mode,reason,outcome},
        ...(outcome==="refused"?{isError:true}:{})};
    };
    if(ctx.mode!=="tui"||!ctx.hasUI||!ctx.isProjectTrusted())
      return finish("refused","ATDD mode: "+INTENT_TOOL+" refused (non-interactive or untrusted run; "+
        "mode comes from PI_ATDD_MODE or "+MODE_FILE+")");
    const root=repositoryRoot(ctx.cwd);
    if(mode==="plain"&&current?.mode!=="plain"&&root&&guardsAtdd(root)){
      const yes=await ctx.ui.confirm("Switch this session to plain mode?",
        "This repository declares ATDD. Plain mode applies no conventions or edit guards. Reason: "+reason);
      if(!yes)return finish("refused","ATDD mode: plain refused (repository declares ATDD and the user did not confirm; "+
        "ask the user in the conversation before trying again)");
    }
    const changed=setMode(ctx,mode,INTENT_TOOL+": "+reason,false);
    return finish(changed?"switched":"unchanged","ATDD mode: "+mode+(changed?"":", unchanged")+" ("+INTENT_TOOL+": "+reason+")");
  }
  pi.registerTool({
    name:INTENT_TOOL,label:"ATDD mode",
    description:"Switch this session between ATDD mode (conventions and edit guards) and plain mode (none). "+
      "Interactive sessions only. In a repository that declares ATDD (atdd-pi.yaml, a plan/ directory or a recorded atdd "+
      "mode) it asks the user to confirm plain and refuses without a yes.",
    promptSnippet:"Switch this session between ATDD and plain mode",
    promptGuidelines:[INTENT_RULE],
    parameters:Type.Object({
      mode:StringEnum(["atdd","plain"] as const),
      reason:Type.String({description:"The user's signal, in one short line"}),
    }),
    defaultActive:false,
    executionMode:"sequential",
    execute:async(_id,params,_signal,_onUpdate,ctx)=>switchByIntent(ctx as unknown as IntentCtx,params.mode as Mode,params.reason),
  });
  async function ask(ctx:Notify&{ui:{select:(title:string,options:string[])=>Promise<string|undefined>}}):Promise<void>{
    const choice=await ctx.ui.select("ATDD or plain for this repository?",MODE_CHOICES);
    const mode:Mode=choice?.startsWith("Plain")?"plain":"atdd";
    const remember=choice?.includes("remember")??false;
    const root=repositoryRoot(ctx.cwd);
    if(remember&&root){
      try{recordMode(root,mode);}catch(e){ctx.ui.notify("ATDD mode not recorded: "+String(e),"warning");}
    }
    setMode(ctx,mode,!choice?"default, question dismissed":remember?MODE_FILE:"your answer");
  }

  function reset():void{
    reasoning=undefined;delivered.clear();unresolvedPaths.clear();observationWarning=false;
    pendingPostTool.clear();
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
    origin:ContextObservation["origin"],provenance:string,path?:string,sourceText?:string){
    return ensure(cwd).observe({
      scope:scopeFor(path),task:task||"unknown task",path,sourceText,operation,origin,provenance,
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
    current=undefined;
    // PLT-94 MI-005: the tool and its instruction exist only in interactive, trusted sessions.
    const others=pi.getActiveTools().filter(name=>name!==INTENT_TOOL);
    pi.setActiveTools(ctx.mode==="tui"&&ctx.hasUI&&ctx.isProjectTrusted()?[...others,INTENT_TOOL]:others);
    if(ctx.isProjectTrusted())restoreFromBranch(ctx);
  });
  pi.on("session_tree",(_event,ctx)=>{
    if(ctx.isProjectTrusted())restoreFromBranch(ctx);
  });
  pi.registerCommand("atdd",{
    description:"ATDD or plain: /atdd on | off | status | telemetry",
    handler:async(args,ctx)=>{
      const arg=(args??"").trim().toLowerCase();
      if(arg==="on"||arg==="off"){setMode(ctx,arg==="on"?"atdd":"plain","/atdd "+arg);return;}
      if(arg==="telemetry"){ctx.ui.notify(formatActivationSummary(ctx.cwd),"info");return;}
      if(arg&&arg!=="status"){ctx.ui.notify("Usage: /atdd on | off | status | telemetry","warning");return;}
      const mode=current??resolveMode({cwd:ctx.cwd,env:process.env});
      let line=mode.mode?"ATDD mode: "+mode.mode+" ("+mode.source+")":
        "ATDD mode: undecided (an interactive session asks at the first task; other runs use atdd)";
      if(!repositoryRoot(ctx.cwd))line+="; not in a repository, nothing is governed";
      else if(mode.mode==="atdd"){
        if(!ctx.isProjectTrusted())line+="; project not trusted, inactive";
        else try{
          ensure(ctx.cwd);
          line+="; "+catalog!.rules.size+" pinned rules, "+catalog!.unresolvedEdges.length+
            " external graph edges; inference is advisory";
        }catch(e){ctx.ui.notify("ATDD graph invalid: "+String(e).split("\n")[0],"error");return;}
      }
      ctx.ui.notify(line,"info");
    },
  });
  // Mode first (PLT-93): the user's words, then env/record/markers; only a TUI session asks.
  pi.on("before_agent_start",(event,ctx)=>{
    if(!ctx.isProjectTrusted()){
      if(event.messageType==="user")record(ctx.cwd,{point:"task_start",outcome:"excluded",reasonCode:"untrusted_project"});
      return;
    }
    const said=event.messageType==="user"?modeFromText(event.prompt??""):undefined;
    if(said)setMode(ctx,said,"your message");
    if(!current){
      const resolved=resolveMode({cwd:ctx.cwd,env:process.env});
      if(resolved.mode)current=resolved;
      else if(ctx.mode==="tui"&&ctx.hasUI)return ask(ctx).then(()=>startRun(event,ctx));
      else current={mode:"atdd",source:"default, non-interactive"};
    }
    return startRun(event,ctx);
  });
  function startRun(event:{messageType:string;prompt?:string},ctx:{cwd:string}){
    const newTask=event.messageType==="user";
    if(newTask){
      serial++;task=event.prompt||"unknown task";reset();
      if(active(ctx.cwd))observedRepo=observeRepository(ctx.cwd).snapshot;
    }
    if(!active(ctx.cwd)){
      if(newTask)record(ctx.cwd,{point:"task_start",outcome:"excluded",reasonCode:"plain_or_outside_repo"});
      return;
    }
    const started=performance.now();
    try{
      const result=observe(ctx.cwd,"task","pi-event","Pi before_agent_start");
      const newRules=newlyRelevant(result);
      if(!newTask&&!newRules.length)return;
      const page=renderReasonedPage(result,newRules,12_000);
      recordActualDelivery(result,page);
      if(newTask)recordReasoned(ctx.cwd,"task_start","task",undefined,result,newRules,page,started);
      return {message:{customType:"pi-atdd-inference",
        content:page.text,display:false}};
    }catch(e){
      if(newTask)record(ctx.cwd,{point:"task_start",outcome:"error",reasonCode:"reasoner_error",durationMs:performance.now()-started});
      reset(); // no partially materialized conclusions survive a failed inference
      return {message:{customType:"pi-atdd-error",
        content:"ATDD reasoning failed: "+String(e)+
          ". Unknown obligations are not waivers; repair graph before governed completion.",display:true}};
    }
  }
  /** Same preflight for a governed path whether it is edited via edit/write or the shell. */
  function preflightPath(cwd:string,path:string,operation:"edit"|"create",provenance:string,
    budget:number,blockUnknown:boolean,sourceText?:string):{block:true;reason:string}|undefined{
    const started=performance.now();
    try{
      const result=observe(cwd,operation,"pi-event",provenance,path,sourceText);
      const fresh=newlyRelevant(result);
      if(result.status==="incomplete"){
        const page=renderReasonedPage(result,fresh,budget);
        recordActualDelivery(result,page);
        recordReasoned(cwd,"pre_edit",operation,path,result,fresh,page,started);
        return {block:true,reason:page.text+
          "\nMandatory graph dependencies unresolved. Do not proceed until authoritative sources are available."};
      }
      if(fresh.length){
        const page=renderReasonedPage(result,fresh,budget);
        recordActualDelivery(result,page);
        recordReasoned(cwd,"pre_edit",operation,path,result,fresh,page,started);
        return {block:true,reason:"ATDD contextual preflight for "+path+"; read reasoning before retrying:\n\n"+
          page.text};
      }
      recordReasoned(cwd,"pre_edit",operation,path,result,fresh,undefined,started);
      if(blockUnknown&&result.status==="unknown"&&!unresolvedPaths.has(result.scope)){
        unresolvedPaths.add(result.scope);
        return {block:true,reason:renderReasonedPage(result,undefined,4_000).text+
          "\nInspect canonical rules before retrying; this gap does not certify compliance."};
      }
      return undefined;
    }catch(error){
      record(cwd,{point:"pre_edit",operation,pathCategory:activationPathCategory(path),
        outcome:"error",reasonCode:"reasoner_error",durationMs:performance.now()-started});
      throw error;
    }
  }
  pi.on("tool_call",(event,ctx)=>{
    if(!ctx.isProjectTrusted()||!active(ctx.cwd)){
      if(["bash","edit","write"].includes(event.toolName))
        record(ctx.cwd,{point:"pre_edit",outcome:"excluded",reasonCode:"plain_or_untrusted"});
      return;
    }
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
            remaining,false,sourceFor(ctx.cwd,path));
          if(r){reasons.push(r.reason);remaining-=r.reason.length;}
        }
      }catch(e){reset();return {block:true,reason:"ATDD rule activation failed: "+String(e)};}
      if(reasons.length)return {block:true,reason:"ATDD shell-write preflight: this command writes "+
        targets.join(", ")+". Read the reasoning, then retry the command.\n\n"+reasons.join("\n\n")};
      return;
    }
    if(event.toolName!=="edit"&&event.toolName!=="write")return;
    const input=event.input as {path?:unknown;content?:unknown;oldText?:unknown;newText?:unknown};
    if(typeof input.path!=="string")return {block:true,reason:"ATDD requires a file path for edits."};
    const path=scopedPath(ctx.cwd,input.path);
    if(path===null){
      if(outsideRepository(ctx.cwd,input.path)){
        record(ctx.cwd,{point:"pre_edit",outcome:"excluded",reasonCode:"outside_repository"});
        return; // PLT-93 AP-006
      }
      record(ctx.cwd,{point:"pre_edit",outcome:"error",reasonCode:"unsafe_path"});
      return {block:true,reason:"ATDD cannot govern edits outside the repository."};
    }
    try{
      return preflightPath(ctx.cwd,path,event.toolName==="write"?"create":"edit",
        "Pi pre-edit tool_call",12_000,true,sourceFor(ctx.cwd,path,input));
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
    const started=performance.now();
    const result=observe(cwd,item.operation,"repository-observation",item.provenance,item.path,sourceFor(cwd,item.path));
    const fresh=newlyRelevant(result);
    if(!fresh.length&&result.status==="matched"){
      recordReasoned(cwd,"post_tool",item.operation,item.path,result,fresh,undefined,started);
      pendingPostTool.delete(item.path);return undefined;
    }
    const page=renderReasonedPage(result,fresh,budget);
    recordActualDelivery(result,page);
    recordReasoned(cwd,"post_tool",item.operation,item.path,result,fresh,page,started);
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
      record(cwd,{point:"post_tool",outcome:"unknown",reasonCode:"repository_unobservable"});
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
    if(!report.changedPaths.length)
      record(cwd,{point:"post_tool",outcome:"noop",reasonCode:"no_observed_change"});
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
        record(cwd,{point:"post_tool",outcome:"error",pathCategory:activationPathCategory(path),reasonCode:"reasoner_error"});
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
    if(!ctx.isProjectTrusted()||!active(ctx.cwd))return;
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
    if(!ctx.isProjectTrusted()||!active(ctx.cwd))return;
    if(READ_ONLY_TOOLS.has(event.toolName))return;
    if(event.toolCallId&&reconciledCalls.delete(event.toolCallId))return;
    for(const text of reconcile(ctx.cwd,event.toolName)){
      const custom=text.startsWith("ATDD POST-TOOL OBSERVATION UNKNOWN")?"pi-atdd-observation-gap":"pi-atdd-post-tool-reconciliation";
      pi.sendMessage({customType:custom,content:text,display:false},{deliverAs:"steer"});
    }
  });
}
