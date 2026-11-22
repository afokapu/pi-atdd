// URN: test:pi-atdd:incremental-inference:E002-INTEGRATION-006-hook
// Acceptance: acc:pi-atdd:E003-UNIT-201
// Acceptance: acc:pi-atdd:E003-UNIT-204
// Acceptance: acc:pi-atdd:E002-INTEGRATION-006
// Acceptance: acc:pi-atdd:E002-UNIT-001
// Phase: UNIT
// Layer: application
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import atdd from "../extensions/atdd.ts";
import { digestSource } from "../src/catalog.ts";
import { activationLogPath } from "../src/activation-telemetry.ts";
import { stringify } from "yaml";

function sandbox(env:NodeJS.ProcessEnv=process.env) {
  const cwd=mkdtempSync(join(tmpdir(),"pi-atdd-pi-live-"));
  const telemetryRoot=mkdtempSync(join(tmpdir(),"pi-atdd-telemetry-isolated-"));
  const git=(...args:string[])=>execFileSync("git",args,{cwd,encoding:"utf8"});
  git("init","-q");git("config","user.name","Pi tester");git("config","user.email","test@example.invalid");
  mkdirSync(join(cwd,"src/orders/routes"),{recursive:true});
  writeFileSync(join(cwd,"src/orders/routes/create.ts"),"export const created = false;\n");
  git("add",".");git("commit","-qm","base");
  const handlers=new Map<string,Function>();
  const messages:Array<{message:{customType:string;content:string};options:unknown}>=[];
  const p={
    on:(name:string,fn:Function)=>{handlers.set(name,fn);},
    registerCommand:()=>{},
    registerTool:()=>{},
    sendMessage:(message:{customType:string;content:string},options:unknown)=>messages.push({message,options}),
  };
  atdd(p as any,{telemetryRoot,env});
  const ctx={cwd,isProjectTrusted:()=>true,ui:{notify:()=>{}}};
  return {cwd,handlers,messages,ctx,git,
    logPath:()=>activationLogPath(cwd,{root:telemetryRoot}),
    cleanup:()=>{
      rmSync(cwd,{recursive:true,force:true});
      rmSync(telemetryRoot,{recursive:true,force:true});
    }};
}

test("Pi delivers typed graph reasoning automatically at task start and first edit",()=>{
  const x=sandbox();
  try {
    const initial=x.handlers.get("before_agent_start")!({messageType:"user",prompt:"Implement authorization"},x.ctx);
    assert.match(initial.message.content,/coder\.security\.missing-auth/);
    assert.match(initial.message.content,/Canonical source:/);
    assert.match(initial.message.content,/Original guidance:/);
    assert.equal(x.handlers.get("before_agent_start")!({messageType:"extension",prompt:""},x.ctx),undefined,
      "same task facts should not inject redundant reasoning every run");
    const event={toolName:"edit",input:{path:"src/orders/routes/create.ts"}};
    const pre=x.handlers.get("tool_call")!(event,x.ctx);
    assert.equal(pre.block,true);
    assert.match(pre.reason,/ATDD contextual preflight/);
    assert.match(pre.reason,/Trigger proof/);
    // A retry after seeing guidance must not produce an infinite preflight loop.
    assert.equal(x.handlers.get("tool_call")!(event,x.ctx),undefined);
    assert.equal(x.messages.length,0);
  } finally {x.cleanup();}
});

test("Pi observes a bash bypass and sends the applicable rule evidence after the change",()=>{
  const x=sandbox();
  try{
    x.handlers.get("before_agent_start")!({messageType:"user",prompt:"Update order"},x.ctx);
    // No 'edit' or 'write' call is made. The shell/custom tool modified a file.
    writeFileSync(join(x.cwd,"src/orders/routes/create.ts"),"export const created = true;\n");
    x.handlers.get("tool_execution_end")!({toolName:"bash",isError:false},x.ctx);
    assert.ok(x.messages.some(m=>m.message.customType==="pi-atdd-post-tool-reconciliation"));
    const notice=x.messages.find(m=>m.message.customType==="pi-atdd-post-tool-reconciliation")!;
    assert.match(notice.message.content,/src\/orders\/routes\/create\.ts/);
    assert.match(notice.message.content,/coder\.security\.missing-auth/);
    assert.match(notice.message.content,/not a merge verdict/);
    const count=x.messages.length;
    x.handlers.get("tool_execution_end")!({toolName:"bash",isError:false},x.ctx);
    assert.equal(x.messages.length,count,"unchanged snapshot should not repeatedly prompt");
  } finally {x.cleanup();}
});

test("a new Pi user task resets task-scoped supports rather than inheriting stale activations",()=>{
  const x=sandbox();
  try{
    const start=x.handlers.get("before_agent_start")!;
    const first=start({messageType:"user",prompt:"Perform behavioral review"},x.ctx);
    assert.match(first.message.content,/reviewer\.reconciliation\.behavioral/);
    const second=start({messageType:"user",prompt:"Update an opaque note"},x.ctx);
    assert.match(second.message.content,/UNKNOWN|unresolved/);
    assert.ok(!second.message.content.includes("reviewer.reconciliation.behavioral"));
    const untrusted={...x.ctx,isProjectTrusted:()=>false};
    assert.equal(start({messageType:"user",prompt:"Perform review"},untrusted),undefined);
  } finally{x.cleanup();}
});

test("Pi session-tree restoration invalidates old supports and reconstructs a verified task prompt",()=>{
  const x=sandbox();
  try{
    const start=x.handlers.get("before_agent_start")!;
    start({messageType:"user",prompt:"Implement authorization"},x.ctx);
    const resumed={...x.ctx,sessionManager:{getBranch:()=>[
      {type:"message",message:{role:"user",content:[{type:"text",text:"Perform final behavioral review"}]}},
    ]}};
    x.handlers.get("session_tree")!({},resumed);
    const result=start({messageType:"extension",prompt:""},resumed);
    assert.match(result.message.content,/reviewer\.reconciliation\.behavioral/);
    assert.ok(!result.message.content.includes("coder.security.missing-auth"));
    assert.equal(start({messageType:"extension",prompt:""},resumed),undefined);
  }finally{x.cleanup();}
});


test("pre-edit path guard rejects symlinked parent directories escaping the project",()=>{
  const x=sandbox();
  const external=mkdtempSync(join(tmpdir(),"pi-atdd-physical-outside-"));
  try{
    x.handlers.get("before_agent_start")!({messageType:"user",prompt:"Update secrets"},x.ctx);
    symlinkSync(external,join(x.cwd,"src","outside-link"),"dir");
    const blocked=x.handlers.get("tool_call")!({
      toolName:"write",input:{path:"src/outside-link/secrets.ts"},
    },x.ctx);
    assert.equal(blocked.block,true);
    assert.match(blocked.reason,/outside the repository|cannot govern/);
    assert.equal(x.handlers.get("tool_call")!({
      toolName:"edit",input:{path:"src/outside-link/secrets.ts"},
    },x.ctx).block,true,"retry may not authorize the symlink escape");
    const outsideFile=join(external,"sensitive.ts");
    writeFileSync(outsideFile,"export const privateValue = 1;\n");
    symlinkSync(outsideFile,join(x.cwd,"src/orders/routes/alias.ts"),"file");
    const file=x.handlers.get("tool_call")!({
      toolName:"edit",input:{path:"src/orders/routes/alias.ts"},
    },x.ctx);
    assert.equal(file.block,true);
    assert.match(file.reason,/outside the repository|cannot govern/);
    assert.equal(readFileSync(outsideFile,"utf8"),"export const privateValue = 1;\n");
  }finally{x.cleanup();rmSync(external,{recursive:true,force:true});}
});


test("budget-clipped pre-edit rules are paged and cannot be silently skipped on retry",()=>{
  const x=sandbox();
  try{
    mkdirSync(join(x.cwd,"extra/conventions"),{recursive:true});
    const ids=Array.from({length:18},(_,i)=>"extra.context."+String(i).padStart(2,"0"));
    for(const id of ids){
      writeFileSync(join(x.cwd,"extra/conventions",id+".convention.yaml"),[
        "rule_id: "+id,
        "kind: rule",
        "status: active",
        "statement: The agent must examine evidence and affected behavior before implementation for "+id+".",
        "content:",
        "  summary: Preserve the obligation expressed in "+id+".",
        "  fix_hint: |",
        ...Array(17).fill("    Inspect the actual boundary, tests, and observed changes before approving this work."),
        "",
      ].join("\n"));
    }
    const checksum=digestSource(join(x.cwd,"extra"),"extension");
    writeFileSync(join(x.cwd,"atdd-pi.yaml"),[
      "schema: pi-atdd/config/v2","sources:","  - id: Extra","    kind: extension",
      "    path: extra","    sha256: "+checksum,"selectors: extra-selectors.yaml","",
    ].join("\n"));
    writeFileSync(join(x.cwd,"extra-selectors.yaml"),[
      "schema: pi-atdd/selectors/v1","selectors:","  - id: every-rule",
      "    always: true","    rules:",...ids.map(id=>"      - "+id),"",
    ].join("\n"));
    const initial=x.handlers.get("before_agent_start")!({
      messageType:"user",prompt:"Implement a task with many applicable conventions",
    },x.ctx);
    assert.match(initial.message.content,/omitted by budget/);
    const displayed=new Set<string>();
    const event={toolName:"edit",input:{path:"src/orders/routes/create.ts"}};
    let pages=0,allowed=false;
    for(let attempt=0;attempt<20;attempt++){
      const response=x.handlers.get("tool_call")!(event,x.ctx);
      if(response===undefined){allowed=true;break;}
      pages++;
      assert.equal(response.block,true);
      for(const match of response.reason.matchAll(/Convention (extra\.context\.\d+)/g)){
        displayed.add(match[1]!);
      }
      if(displayed.size<ids.length)
        assert.match(response.reason,/preflight|omitted by budget/);
    }
    assert.equal(allowed,true,"must eventually allow after all complete convention pages are delivered");
    assert.ok(pages>=2,"a single context page must not claim to contain all 18 rules");
    assert.deepEqual([...displayed].sort(),ids);
    assert.equal(x.handlers.get("tool_call")!(event,x.ctx),undefined);
  }finally{x.cleanup();}
});


test("Pi pre-edit structural evidence and local telemetry work without task keywords",()=>{
  const x=sandbox();
  try{
    const start=x.handlers.get("before_agent_start")!;
    start({messageType:"user",prompt:"Make orders cancellable"},x.ctx);
    const event={toolName:"write",input:{
      path:"src/server.ts",content:'Bun.serve({routes:{"/orders":{DELETE:()=>new Response("ok")}}});',
    }};
    const first=x.handlers.get("tool_call")!(event,x.ctx);
    assert.equal(first.block,true);
    assert.match(first.reason,/coder\.security\.missing-auth/);
    assert.equal(x.handlers.get("tool_call")!(event,x.ctx),undefined,
      "unchanged evidence should not repeatedly block on identical guidance");
    const log=readFileSync(x.logPath(),"utf8");
    assert.ok(!log.includes("Make orders cancellable"),"task prompt must not enter telemetry");
    assert.ok(!log.includes("src/server.ts"),"raw path must not enter telemetry");
    assert.ok(!log.includes("DELETE:()=>"),"code must not enter telemetry");
    const entries=log.trim().split("\n").map(line=>JSON.parse(line));
    // Main's PLT-96 tracker rules match broad task wording, so the task start may be "matched" by generic
    // shared.* rules; what must hold is that the task text gives no domain evidence (the route evidence comes from the edit).
    assert.ok(entries.some(item=>item.point==="task_start" &&
      (item.ruleIds??[]).every((id:string)=>id.startsWith("shared."))));
    assert.ok(entries.some(item=>item.point==="pre_edit" && item.outcome==="matched" &&
      item.evidenceIds.includes("ast:bun_mutating_route")));
    assert.ok(entries.some(item=>item.point==="pre_edit" && item.deduplicated>=1));
  }finally{x.cleanup();}
});


test("ATD-41 Pi pre-edit write/edit send source delta proof before mutation",()=>{
  const x=sandbox();
  try{
    mkdirSync(join(x.cwd,"src/orders/domain"),{recursive:true});
    const path="src/orders/domain/price.ts";
    const original="export const price = 4;\n";
    writeFileSync(join(x.cwd,path),original);
    x.git("add",".");x.git("commit","-qm","domain baseline");
    const proposed='import { gateway } from "../integration/network";\n'+original;
    x.handlers.get("before_agent_start")!({messageType:"user",prompt:"Simplify pricing"},x.ctx);
    const write={toolName:"write",input:{path,content:proposed}};
    const first=x.handlers.get("tool_call")!(write,x.ctx);
    assert.equal(first.block,true);
    assert.match(first.reason,/coder\.architecture\.hierarchy-import/);
    assert.equal(readFileSync(join(x.cwd,path),"utf8"),original,"Pi preflight does not mutate");
    const log=readFileSync(x.logPath(),"utf8");
    assert.ok(!log.includes(path));
    assert.ok(!log.includes("gateway"));
    assert.ok(log.includes("change:domain_to_integration_import_added"));
    assert.equal(x.handlers.get("tool_call")!(write,x.ctx),undefined,"same proof is deduplicated");

    // Fresh task and precise edit proposal must derive the same structural change.
    x.handlers.get("before_agent_start")!({messageType:"user",prompt:"Refine price"},x.ctx);
    const edit={toolName:"edit",input:{path,oldText:original,newText:proposed}};
    const second=x.handlers.get("tool_call")!(edit,x.ctx);
    assert.equal(second.block,true);
    assert.ok(readFileSync(x.logPath(),"utf8").includes("change:domain_to_integration_import_added"));
    const malformed={toolName:"edit",input:{path,oldText:"NO SUCH TEXT",newText:proposed}};
    x.handlers.get("before_agent_start")!({messageType:"user",prompt:"Refine something"},x.ctx);
    x.handlers.get("tool_call")!(malformed,x.ctx);
    const latest=readFileSync(x.logPath(),"utf8").trim().split("\n").map((line:string)=>JSON.parse(line))
      .filter((item:any)=>item.point==="pre_edit").at(-1);
    assert.ok(!latest.evidenceIds.includes("change:domain_to_integration_import_added"),
      "an edit that cannot be applied is not a structural delta");
  }finally{x.cleanup();}
});

test("ATD-41 literal shell heredoc preflight and runtime-computed bypass post-observation",()=>{
  const x=sandbox();
  try{
    mkdirSync(join(x.cwd,"src/orders/domain"),{recursive:true});
    const path="src/orders/domain/price.ts";
    const baseline="export const price = 4;\n";
    const changed='import { network } from "../integration/gateway";\n'+baseline;
    writeFileSync(join(x.cwd,path),baseline);
    x.git("add",".");x.git("commit","-qm","base");
    x.handlers.get("before_agent_start")!({messageType:"user",prompt:"Adjust prices"},x.ctx);
    const literal={toolName:"bash",input:{command:"cat > "+path+" <<'EOF'\n"+changed+"EOF"}};
    const before=x.handlers.get("tool_call")!(literal,x.ctx);
    assert.equal(before.block,true);
    assert.match(before.reason,/ATDD shell-write preflight/);
    assert.ok(readFileSync(x.logPath(),"utf8").includes("change:domain_to_integration_import_added"));
    assert.equal(readFileSync(join(x.cwd,path),"utf8"),baseline);
    // Opaque runtime-computed shell write cannot be preflighted for a delta.
    x.handlers.get("before_agent_start")!({messageType:"user",prompt:"Adjust prices again"},x.ctx);
    const dynamic={toolName:"bash",input:{command:'p="src/orders/domain/price.ts"; printf "%s" "$source" > "$p"'}};
    x.handlers.get("tool_call")!(dynamic,x.ctx);
    writeFileSync(join(x.cwd,path),changed);
    x.handlers.get("tool_execution_end")!({toolName:"bash",isError:false},x.ctx);
    const notice=x.messages.find(m=>m.message.customType==="pi-atdd-post-tool-reconciliation");
    assert.ok(notice,"bypass is observed after mutation");
    assert.match(notice.message.content,/coder\.architecture\.hierarchy-import/);
    const entries=readFileSync(x.logPath(),"utf8").trim().split("\n").map((line:string)=>JSON.parse(line));
    assert.ok(entries.some((item:any)=>item.point==="post_tool" &&
      item.evidenceIds.includes("ast:domain_to_integration_import")));
    assert.ok(!entries.some((item:any)=>item.point==="post_tool" &&
      item.evidenceIds.includes("change:domain_to_integration_import_added")),
      "post-tool content without a before/after proposal cannot claim the import was added");
    const count=x.messages.length;
    x.handlers.get("tool_execution_end")!({toolName:"bash",isError:false},x.ctx);
    assert.equal(x.messages.length,count,"unchanged bypass does not redeliver");
  }finally{x.cleanup();}
});

/** A real Flow launcher writes this Desk tuple and the runtime receipt before Pi starts.
 * The environment is local to one extension instance, not shared process state. */
function flowHookFixture(cwd:string,env:NodeJS.ProcessEnv) {
  const root=mkdtempSync(join(tmpdir(),"pi-atdd-flow-hook-"));
  const seat="driver.delivery@demo", session="atd-42-pi-session";
  const taskFile=join(root,"work","demo","tasks","delivery.yaml");
  const receiptFile=join(root,".atdd-flow","runtime-launch","launch-receipt.yaml");
  const piSessionPath=join(root,"pi-session.jsonl");
  mkdirSync(join(root,"work","demo","tasks"),{recursive:true});
  mkdirSync(join(root,"work","demo","seats","driver.delivery"),{recursive:true});
  mkdirSync(join(root,".atdd-flow","runtime-launch"),{recursive:true});
  const writeTask=(phase:string)=>writeFileSync(taskFile,stringify({
    schema:"atdd-workflow/task/v1",title:"Deliver a bounded task",status:"in_progress",
    coordinator:"coordinator@demo",assignee:seat,phase,
    done_when:[{text:"Demonstrate the intended behavior"}],
  }));
  writeTask("plan");
  writeFileSync(receiptFile,stringify({
    schema:"atdd-flow/pi-runtime-launch-receipt/v1",seat,tasks:["delivery"],
    pi_session:session,pi_session_path:piSessionPath,herdr_session:"forge",pane:"w1:p2",
  }));
  writeFileSync(join(root,"work","demo","seats","driver.delivery","seat.yaml"),stringify({
    schema:"atdd-workflow/seat/v2",address:seat,role:"driver",
    project:"demo",worktree:cwd,branch:"delivery/demo",
    runtime:{
      application:"herdr",wake:"native",addresses:{herdr:{session:"forge",pane:"w1:p2"}},
      pi_session:session,pi_session_path:piSessionPath,launch_receipt:receiptFile,
    },
  }));
  Object.assign(env,{
    ATDD_WORKFLOW_ROOT:root,ATDD_WORKFLOW_SEAT:seat,
    ATDD_FLOW_PI_SESSION:session,ATDD_FLOW_HERDR_SESSION:"forge",
    ATDD_FLOW_HERDR_PANE:"w1:p2",
  });
  return {root,session,seat,taskFile,receiptFile,piSessionPath,writeTask,
    cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

/** Pages are receipts, not implied model knowledge. Drain the existing Pi
 * before_agent_start pages and assert that they terminate without duplication. */
function drainHookPages(start:Function,ctx:unknown):string {
  const pages:string[]=[];
  for(let i=0;i<30;i++){
    const next=start({messageType:"extension",prompt:""},ctx);
    if(next===undefined)return pages.join("\n");
    assert.equal(next?.message?.customType,"pi-atdd-inference");
    pages.push(next.message.content);
  }
  assert.fail("trusted phase guidance must be delivered in bounded pages");
}

test("ATD-42: the Pi hook delivers phases from the verified Flow task without false green", () => {
  const env:NodeJS.ProcessEnv={};
  const x=sandbox(env), flow=flowHookFixture(x.cwd,env);
  const ctx={...x.ctx,sessionManager:{getSessionId:()=>flow.session}};
  const onStart=x.handlers.get("before_agent_start")!;
  try {
    const plan=onStart({messageType:"user",prompt:"Implement the assigned work"},ctx);
    assert.equal(plan?.message?.customType,"pi-atdd-inference");
    const planned=plan.message.content+"\n"+drainHookPages(onStart,ctx);
    for(const id of ["planner.steps.jtbd-taxonomy", "planner.plan.session-lifecycle",
      "planner.acceptance.well-formed"])
      assert.ok(planned.includes(id), "PLAN guidance omitted "+id);
    assert.match(planned,/Canonical source:/);
    assert.match(planned,/Flow-owned task demo\/delivery/);
    assert.equal(onStart({messageType:"extension",prompt:""},ctx),undefined,
      "completed guidance must not be re-injected");
    assert.match(readFileSync(flow.taskFile,"utf8"),/phase: plan/,"the hook must be read-only");

    flow.writeTask("red");
    const red=onStart({messageType:"extension",prompt:""},ctx);
    assert.equal(red?.message?.customType,"pi-atdd-inference");
    const redGuidance=red.message.content+"\n"+drainHookPages(onStart,ctx);
    assert.match(redGuidance,/tester\.red\.behavioral-assertion/);
    assert.match(redGuidance,/tester\.red\.fails-first/);
    flow.writeTask("green");
    const green=onStart({messageType:"extension",prompt:""},ctx);
    assert.equal(green?.message?.customType,"pi-atdd-inference");
    assert.match(green.message.content,/coder\.phase\.discipline/);
    drainHookPages(onStart,ctx);
    flow.writeTask("refactor");
    const refactor=onStart({messageType:"extension",prompt:""},ctx);
    assert.equal(refactor?.message?.customType,"pi-atdd-inference");
    const refactorGuidance=refactor.message.content+"\n"+drainHookPages(onStart,ctx);
    for(const id of ["coder.phase.discipline"])
      assert.ok(refactorGuidance.includes(id), "REFACTOR guidance omitted "+id);
    assert.ok(!refactorGuidance.includes("coder.dead-code.reachability"),
      "a bare REFACTOR phase must not claim applicability of unobserved dead-code findings");

    // A session swap invalidates the receipt; old phase guidance is withdrawn.
    writeFileSync(flow.receiptFile,stringify({
      schema:"atdd-flow/pi-runtime-launch-receipt/v1",
      seat:flow.seat,tasks:["delivery"],pi_session:"a-superseded-session",
      pi_session_path:flow.piSessionPath,herdr_session:"forge",pane:"w1:p2",
    }));
    const refused=onStart({messageType:"extension",prompt:""},ctx);
    assert.equal(refused?.message?.customType,"pi-atdd-error");
    assert.match(refused.message.content,/launch receipt does not match/);
    assert.ok(!refused.message.content.includes("coder.phase.discipline"));
  }finally{x.cleanup();flow.cleanup();}
});


test("ATD-42: edits cannot bypass phase conventions omitted from the first page", () => {
  const env:NodeJS.ProcessEnv={}, x=sandbox(env), flow=flowHookFixture(x.cwd,env);
  const ctx={...x.ctx,sessionManager:{getSessionId:()=>flow.session}};
  const start=x.handlers.get("before_agent_start")!, edit=x.handlers.get("tool_call")!;
  try {
    const initial=start({messageType:"user",prompt:"Implement this delivery"},ctx);
    assert.equal(initial?.message?.customType,"pi-atdd-inference");
    const event={toolName:"edit",input:{path:"src/orders/routes/create.ts"}};
    let sawStageGuard=false, sawFileGuard=false;
    for(let i=0;i<35;i++){
      const response=edit(event,ctx);
      if(response?.reason?.includes("ATDD phase PLAN guidance")) {
        sawStageGuard=true;
        assert.equal(response.block,true);
        continue;
      }
      // Once phase guidance is delivered, the normal file-specific preflight
      // still applies rather than being bypassed by stage pagination.
      assert.equal(response?.block,true);
      assert.match(response.reason,/ATDD contextual preflight/);
      sawFileGuard=true;
      break;
    }
    assert.equal(sawStageGuard,initial.message.content.includes("omitted by budget"),
      "stage preflight must exactly account for undelivered phase rules");
    assert.equal(sawFileGuard,true,"the bounded stage pages must eventually drain");
    // A phase transition during the same Pi turn still activates RED before
    // the next edit; the model does not need to recognize the transition.
    flow.writeTask("red");
    const transitioned=edit(event,ctx);
    assert.equal(transitioned?.block,true);
    assert.match(transitioned.reason,/ATDD phase RED guidance/);
  }finally{x.cleanup();flow.cleanup();}
});
