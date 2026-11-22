/**
 * Pi-native adapter over the fact-driven ATDD reasoner.
 * Tool interception provides guidance. Post-tool repository inspection observes
 * bypasses. Neither constitutes independent proof of compliance.
 */
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadCatalog, loadConfig, type Catalog, type Selector } from "./catalog.ts";
import type { StructureProfile } from "./profile.ts";
import { ReasoningSession, type ContextObservation } from "./reasoning-context.ts";
import { renderReasonedPage, type RenderedPage } from "./render-reasoning.ts";
import { observeRepository, type RepositorySnapshot } from "./repository-observer.ts";
import { shellWriteTargetModes } from "./shell-targets.ts";
import { registerAttentionStrip } from "./attention-strip.ts";
import { attentionSeatOptions } from "./attention-seat.ts";
import { registerSeatExecution } from "./execution-pi.ts";
import type { ExecutionCheckpoint } from "./execution-lifecycle.ts";
import { registerBusyState } from "./busy-state.ts";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { MODE_FILE, guardsAtdd, modeFromText, recordMode, repositoryRoot, resolveMode, type Mode, type Resolution } from "./mode.ts";
import {
  buildHandoff, clampToCompaction, decideContextAction, decideSettle, extractIssueId, INITIAL_HANDOFF_STATE, kickoffText,
  parseHop, resolveCompactionReserve, DEFAULT_COMPACTION_RESERVE, resolveMaxHops, resolveThresholds,
  RECORD_HEADER, type HandoffInput, type HandoffState, type CoachState, resolveTask, extractIssueIds, extractPullRequests,
} from "./context-handoff.ts";

/** Text of a user message entry in the session branch; empty for anything else. */
function userText(value:unknown):string{
  const entry=value as {type?:string;message?:{role?:string;content?:unknown}};
  if(entry.type!=="message"||entry.message?.role!=="user")return "";
  const content=entry.message?.content;
  return typeof content==="string"?content:Array.isArray(content)?
    content.filter(x=>x?.type==="text"&&typeof x.text==="string").map(x=>x.text).join("\n"):"";
}
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
  const executionSeat = registerSeatExecution(pi); // PLT-117: inert unless launch-bound
  // PLT-118: a scoped attention route follows the live seat binding and its writes are fenced against seat transfer.
  const attentionStrip=registerAttentionStrip(pi, attentionSeatOptions(executionSeat)); // PLT-101
  registerBusyState(pi); // PLT-121: busy/idle state file for the relaunch script; inert without an identity
  let cwdKey="", task="", serial=0;
  let catalog:Catalog|undefined,selectors:Selector[]=[],profile:StructureProfile|undefined;
  let reasoning:ReasoningSession|undefined;
  let observedRepo:RepositorySnapshot|undefined;
  let observationWarning=false;
  const delivered=new Map<string,string>();
  const unresolvedPaths=new Set<string>();
  // PLT-102: automatic handoff. Usage is read in turn_end; the session switch runs
  // from a registered command because ctx.newSession is available only to commands.
  let handoffState:HandoffState=INITIAL_HANDOFF_STATE;
  let requestedHandoff:HandoffInput|undefined;
  let readyHandoff:{text:string;path:string;kickoff:string;seatCheckpoint?:ExecutionCheckpoint}|undefined;
  /** Hop index of this session in its chain, read back from the record that seeded it. */
  let handoffHop=0;
  /** Post-tool pages whose budget omitted rules; delivered on the next tool result. */
  type Pending={path:string;operation:"edit"|"create";provenance:string};
  const pendingPostTool=new Map<string,Pending>();
  const key=(scope:string,id:string)=>scope+"\u0000"+id;
  const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
  /** PLT-93 working mode for this session; undefined until resolved. */
  let current:Resolution|undefined;
  const active=(cwd:string)=>current?.mode==="atdd"&&repositoryRoot(cwd)!==null;
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

  /** Pi's own compaction reserve; a handoff must fire before compaction starts. */
  function compactionReserve(model:{provider:string;id:string}|undefined):number{
    try{return resolveCompactionReserve(pi.getSettings(),model);}
    catch{return DEFAULT_COMPACTION_RESERVE;}
  }
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
    handoffState=INITIAL_HANDOFF_STATE;requestedHandoff=undefined;readyHandoff=undefined;
    const entries=ctx.sessionManager.getBranch();
    handoffHop=Math.max(0,...entries.map(value=>parseHop(userText(value))));
    task=resolveTask(entries.map(userText));
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
    description:"ATDD or plain: /atdd on | off | status",
    handler:async(args,ctx)=>{
      const arg=(args??"").trim().toLowerCase();
      if(arg==="on"||arg==="off"){setMode(ctx,arg==="on"?"atdd":"plain","/atdd "+arg);return;}
      if(arg&&arg!=="status"){ctx.ui.notify("Usage: /atdd on | off | status","warning");return;}
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
    if(!ctx.isProjectTrusted())return;
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
    if(!active(ctx.cwd))return;
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
  }
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
  /** PLT-122: a Coach's record carries what only the Coach knows; unknown fields stay UNKNOWN. */
  function coachState(text:string):{coach?:CoachState}{
    if(process.env.PI_ATDD_ATTENTION_ROLE!=="coach")return {};
    return {coach:{role:"coach",identity:process.env.PI_ATDD_ATTENTION_IDENTITY,profile:process.env.PI_ATDD_ATTENTION_PROFILE,
      issues:extractIssueIds(text),prs:extractPullRequests(text),attention:attentionStrip.liveItems()}};
  }
  pi.on("turn_end",(_event,ctx)=>{
    if(!ctx.isProjectTrusted())return;
    let thresholds,maxHops;
    try{thresholds=resolveThresholds(process.env);maxHops=resolveMaxHops(process.env);}
    catch(e){ctx.ui.notify("ATDD context handoff disabled: "+String(e),"error");return;}
    const usage=ctx.getContextUsage();
    const effective=usage?clampToCompaction(thresholds,usage.contextWindow,compactionReserve(ctx.model)):thresholds;
    const decision=decideContextAction(usage?.percent??null,effective,handoffState,handoffHop>=maxHops);
    handoffState=decision.state;
    if(decision.action==="notify")
      ctx.ui.notify("Context at "+usage!.percent!.toFixed(0)+"%; automatic ATDD handoff at "+effective.handoffAt.toFixed(0)+"%","warning");
    if(decision.action==="limit")
      ctx.ui.notify("ATDD handoff chain limit ("+maxHops+" hops) reached; continue manually or raise PI_ATDD_HANDOFF_MAX_HOPS","warning");
    if(decision.action==="handoff")
      requestedHandoff={task,cwd:ctx.cwd,percent:usage!.percent!,contextWindow:usage!.contextWindow,
        revision:currentRevision(),hop:handoffHop+1,...coachState(task)};
  });
  // agent_settled is the idle boundary. The request was latched at turn_end with the
  // usage that crossed the threshold; Pi may compact before the run settles and must not
  // cancel it. Only an aborted run drops the request (and a dropped request may re-arm).
  pi.on("agent_settled",(event,ctx)=>{
    if(!requestedHandoff||!ctx.isProjectTrusted())return;
    const request=requestedHandoff;requestedHandoff=undefined;
    try{
      if(decideSettle(event.aborted)==="drop"){
        handoffState={...handoffState,handoffRequested:false};
        ctx.ui.notify("ATDD context handoff not started: the run was aborted","info");
        return;
      }
      const path=join(ctx.cwd,".atdd-pi","handoffs",new Date().toISOString().replace(/[:.]/g,"-")+".md");
      // If a task seat is launch-bound, checkpoint its authoritative revision and
      // task-scoped attention before starting a successor. Unknown items fail closed.
      const seatCheckpoint=executionSeat?.checkpoint(ctx,executionSeat.snapshotAttention());
      const record=buildHandoff({...request,handoffPath:path});
      const text=seatCheckpoint ? record+"\n\nVerified seat checkpoint: task "+
        seatCheckpoint.taskId+"; source session "+seatCheckpoint.sourceSessionId+
        "; exact "+seatCheckpoint.revision.vcs+" revision "+seatCheckpoint.revision.head+
        "; attention IDs "+seatCheckpoint.attention.pendingIds.join(", ")+
        "; acceptance remains "+seatCheckpoint.acceptance+
        "; grant "+seatCheckpoint.grant.state+
        (seatCheckpoint.grant.reference ? " (reference "+seatCheckpoint.grant.reference+")" : "")+"." : record;
      mkdirSync(dirname(path),{recursive:true});
      writeFileSync(path,text,{flag:"wx"});
      readyHandoff={text,path,kickoff:kickoffText(extractIssueId(request.task)),
        ...(seatCheckpoint?{seatCheckpoint}:{})};
      pi.sendUserMessage("/atdd-handoff",{expandPromptTemplates:true});
    }catch(e){
      ctx.ui.notify("ATDD context handoff failed: "+String(e)+"; no handoff was written.","error");
    }
  });
  pi.registerCommand("atdd-handoff",{
    description:"Start a fresh session seeded with the pending ATDD context handoff, or with a kept record: /atdd-handoff latest or a file name",
    handler:async(args,ctx)=>{
      let ready=readyHandoff;
      const arg=typeof args==="string"?args.trim():"";
      if(arg){
        // Manual relaunch (crashed or closed tab): seed from a record kept on disk. Only a file
        // directly inside this workspace's handoffs directory is accepted.
        const dir=join(ctx.cwd,".atdd-pi","handoffs");
        let name=arg;
        if(arg==="latest"){
          try{name=readdirSync(dir).filter(f=>f.endsWith(".md")).sort().at(-1)??"";}catch{name="";}
          if(!name){ctx.ui.notify("No ATDD context handoff record found in "+dir,"info");return;}
        }
        const file=join(dir,name);
        let text="";
        try{
          if(!/^[\w.-]+\.md$/.test(name))throw new Error("bad name");
          text=readFileSync(file,"utf8");
        }catch{ctx.ui.notify(arg+" is not a handoff record in "+dir,"error");return;}
        if(!text.includes(RECORD_HEADER)){ctx.ui.notify(arg+" is not a handoff record in "+dir,"error");return;}
        ready={text,path:file,kickoff:kickoffText(extractIssueId(resolveTask([text])))};
      }
      if(!ready){ctx.ui.notify("No ATDD context handoff is pending","info");return;}
      // The record stays pending until the switch succeeds, so a cancelled or failed
      // switch can be retried by hand. Nothing retries automatically.
      try{
        const result=await ctx.newSession({
          parentSession:ctx.sessionManager.getSessionFile(),
          setup:async(sm)=>{
            sm.appendMessage({role:"user",content:[{type:"text",text:ready.text}],timestamp:Date.now()});
          },
          withSession:async(next)=>{
            // Ownership is fenced at the exact successor session boundary.
            // Never begin LLM work in a new session with the predecessor's lease.
            if(ready.seatCheckpoint)executionSeat?.activateSuccessor(next,ready.seatCheckpoint);
            await next.sendUserMessage(ready.kickoff);
          },
        });
        if(result.cancelled){
          ctx.ui.notify("ATDD context handoff cancelled; record kept at "+ready.path+". Run /atdd-handoff to retry.","warning");
          return;
        }
        if(ready===readyHandoff)readyHandoff=undefined;
      }catch(e){
        ctx.ui.notify("ATDD context handoff failed: "+String(e)+". Record kept at "+ready.path+".","error");
      }
    },
  });
  pi.on("tool_call",(event,ctx)=>{
    if(!ctx.isProjectTrusted()||!active(ctx.cwd))return;
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
      let remaining=16_000; // PLT-96 budget raise (was 12_000): shell preflight page must hold a write's full rule set
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
    if(path===null){
      if(outsideRepository(ctx.cwd,input.path))return; // PLT-93 AP-006: not refused in either mode
      return {block:true,reason:"ATDD cannot govern edits outside the repository."};
    }
    try{
      return preflightPath(ctx.cwd,path,event.toolName==="write"?"create":"edit",
        "Pi pre-edit tool_call",16_000,true); // PLT-96: same budget as the shell path (parity test)
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
