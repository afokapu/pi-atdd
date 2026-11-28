// URN: test:pi-atdd:deliver-guidance:atd-57-acceptance-01
// Acceptance: acc:pi-atdd:atd-57-acceptance-01
// Acceptance: acc:pi-atdd:atd-57-acceptance-02
// Acceptance: acc:pi-atdd:atd-57-acceptance-03
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import atdd from "../../../../../extensions/atdd.ts";
import { digestSource } from "../../../../../src/catalog.ts";

function sandbox(count=18) {
  const cwd=mkdtempSync(join(tmpdir(),"atd-57-pages-"));
  const git=(...args:string[])=>execFileSync("git",args,{cwd,encoding:"utf8"});
  git("init","-q");git("config","user.name","Pi tester");git("config","user.email","test@example.invalid");
  mkdirSync(join(cwd,"extra/conventions"),{recursive:true});
  const ids=Array.from({length:count},(_,i)=>"extra.context."+String(i).padStart(2,"0"));
  for(const id of ids)writeFileSync(join(cwd,"extra/conventions",id+".convention.yaml"),[
    "rule_id: "+id,"kind: rule","status: active","statement: Preserve "+id+" before the edit.","content:",
    "  summary: Preserve the behavior of "+id+".","  fix_hint: |",
    ...Array(17).fill("    Inspect the actual boundary, tests, and observed changes before approving this work."),"",
  ].join("\n"));
  writeFileSync(join(cwd,"atdd-pi.yaml"),[
    "schema: pi-atdd/config/v2","sources:","  - id: Extra","    kind: extension",
    "    path: extra","    sha256: "+digestSource(join(cwd,"extra"),"extension"),"selectors: extra-selectors.yaml","",
  ].join("\n"));
  writeFileSync(join(cwd,"extra-selectors.yaml"),[
    "schema: pi-atdd/selectors/v1","selectors:","  - id: every-rule","    always: true","    rules:",
    ...ids.map(id=>"      - "+id),"",
  ].join("\n"));
  writeFileSync(join(cwd,"target.ts"),"export const value = 1;\n");
  git("add",".");git("commit","-qm","base");
  const handlers=new Map<string,Function>();
  atdd({on:(name:string,fn:Function)=>handlers.set(name,fn),registerCommand:()=>{},registerTool:()=>{},sendMessage:()=>{}} as any);
  const ctx={cwd,isProjectTrusted:()=>true,ui:{notify:()=>{}}};
  return {cwd,ids,handlers,ctx,cleanup:()=>rmSync(cwd,{recursive:true,force:true})};
}

test("a blocking page provides exact paths for every omitted rule and blocks only once",()=>{
  const x=sandbox();
  try{
    x.handlers.get("before_agent_start")!({messageType:"user",prompt:"Implement a change with many activated rules"},x.ctx);
    const event={toolName:"edit",input:{path:"target.ts",oldText:"1",newText:"2"}};
    const first=x.handlers.get("tool_call")!(event,x.ctx);
    assert.equal(first.block,true);
    for(const id of x.ids)
      assert.ok(first.reason.includes(`${id}.convention.yaml`),
        `first blocking page must give the exact source for ${id}`);
    assert.equal(x.handlers.get("tool_call")!(event,x.ctx),undefined,
      "the first retry must not need another blocking page for unchanged activations");
  }finally{x.cleanup();}
});

test("tracker rules delivered on the task page are not repeated by the later file preflight",()=>{
  const x=sandbox(1);
  try{
    writeFileSync(join(x.cwd,"atdd-pi.yaml"),"schema: pi-atdd/config/v2\n");
    execFileSync("git",["branch","-M","feature/ATD-57-test"],{cwd:x.cwd});
    const initial=x.handlers.get("before_agent_start")!({
      messageType:"user",prompt:"Implement code change for ATD-57",
    },x.ctx).message.content;
    assert.match(initial,/Convention shared\.tracker\.issue-mandatory —/);
    const preflight=x.handlers.get("tool_call")!({toolName:"edit",input:{path:"target.ts",oldText:"1",newText:"2"}},x.ctx);
    assert.ok(!preflight?.reason?.includes("Convention shared.tracker.issue-mandatory —"),
      "already-delivered tracker obligation must not repeat across task and file scopes");
    assert.ok(!preflight?.reason?.includes("Convention shared.tracker.unconfigured-notice —"),
      "already-delivered tracker notice must not repeat across task and file scopes");
    const shell=x.handlers.get("tool_call")!({toolName:"bash",input:{command:"echo changed >> target.ts"}},x.ctx);
    assert.ok(!shell?.reason?.includes("Convention shared.tracker.issue-mandatory —"),
      "already-delivered tracker obligation must not repeat on shell-write preflight");
    assert.ok(!shell?.reason?.includes("Convention shared.tracker.unconfigured-notice —"),
      "already-delivered tracker notice must not repeat on shell-write preflight");
  }finally{x.cleanup();}
});

test("configured tracker guidance does not render the unconfigured notice",()=>{
  const x=sandbox(1);
  try{
    writeFileSync(join(x.cwd,"atdd-pi.yaml"),[
      "schema: pi-atdd/config/v2","tracker:","  kind: linear",
      "  issuePattern: '[A-Z][A-Z0-9]{1,9}-\\d+'","",
    ].join("\n"));
    execFileSync("git",["branch","-M","feature/ATD-57-test"],{cwd:x.cwd});
    const initial=x.handlers.get("before_agent_start")!({
      messageType:"user",prompt:"Implement code change for ATD-57",
    },x.ctx).message.content;
    assert.match(initial,/Convention shared\.tracker\.issue-mandatory —/);
    assert.doesNotMatch(initial,/Convention shared\.tracker\.unconfigured-notice —/);
    assert.doesNotMatch(initial,/No issue tracker is configured/);
  }finally{x.cleanup();}
});
