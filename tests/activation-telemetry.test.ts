// URN: test:pi-atdd:resolve-activation:plt-105-a01
// Acceptance: acc:pi-atdd:plt-105-a01
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  activationLogPath, activationSummary, appendActivation, formatActivationSummary, activationPathCategory,
} from "../src/activation-telemetry.ts";

function withState(fn: (cwd:string, root:string) => void):void {
  const root=mkdtempSync(join(tmpdir(),"pi-atdd-telemetry-"));
  const cwd=join(root,"repo");
  const prior=process.env.PI_ATDD_TELEMETRY_DIR;
  const disabled=process.env.PI_ATDD_TELEMETRY;
  process.env.PI_ATDD_TELEMETRY_DIR=join(root,"state");
  delete process.env.PI_ATDD_TELEMETRY;
  try { fn(cwd,root); }
  finally {
    if(prior === undefined)delete process.env.PI_ATDD_TELEMETRY_DIR;
    else process.env.PI_ATDD_TELEMETRY_DIR=prior;
    if(disabled === undefined)delete process.env.PI_ATDD_TELEMETRY;
    else process.env.PI_ATDD_TELEMETRY=disabled;
    rmSync(root,{recursive:true,force:true});
  }
}

test("local log stores safe IDs/counts and never stores source, task or file path",()=>{
  withState((cwd)=>{
    const r=appendActivation(cwd,{
      point:"pre_edit", outcome:"matched", operation:"edit", pathCategory:"source",
      reasonCode:"graph_activation", ruleIds:["coder.security.missing-auth","src/private/server.ts","bad secret"],
      evidenceIds:["ast:bun_mutating_route","private/user text"], delivered:1,deduplicated:0,
      durationMs:2.345,sessionId:"test-session-1",
    });
    assert.equal(r.ok,true);
    const line=readFileSync(activationLogPath(cwd),"utf8");
    assert.ok(!line.includes("src/private/server.ts"));
    assert.ok(!line.includes("bad secret"));
    assert.ok(!line.includes("private/user text"));
    assert.ok(!line.includes(cwd));
    const data=JSON.parse(line);
    assert.equal(data.schema,"pi-atdd/activation/v1");
    assert.deepEqual(data.evidenceIds,["ast:bun_mutating_route"]);
    assert.deepEqual(data.ruleIds,["coder.security.missing-auth"]);
    assert.equal(data.delivered,1);
    assert.equal(data.durationMs,2.3);
  });
});

test("summary separates matched, unknown, incomplete, error, excluded, noop by point",()=>{
  withState((cwd)=>{
    for(const [point,outcome] of [
      ["task_start","matched"],["task_start","unknown"],["task_start","incomplete"],
      ["task_start","error"],["task_start","excluded"],["post_tool","noop"],
    ] as const){
      assert.equal(appendActivation(cwd,{point,outcome}).ok,true);
    }
    const s=activationSummary(cwd);
    assert.equal(s.groups.task_start.matched,1);
    assert.equal(s.groups.task_start.unknown,1);
    assert.equal(s.groups.task_start.incomplete,1);
    assert.equal(s.groups.task_start.error,1);
    assert.equal(s.groups.task_start.excluded,1);
    assert.equal(s.groups.post_tool.noop,1);
    assert.match(formatActivationSummary(cwd),/task_start: 1\/4 eligible \(25%\)/);
    assert.match(formatActivationSummary(cwd),/post_tool: 0\/0 eligible \(n\/a\)/);
  });
});

test("rotation is bounded and malformed historical events remain visible",()=>{
  withState((cwd)=>{
    for(let i=0;i<20;i++)
      assert.equal(appendActivation(cwd,{point:"pre_edit",outcome:"unknown",reasonCode:"no_facts"},
        {maxBytes:700}).ok,true);
    const path=activationLogPath(cwd);
    assert.equal(existsSync(path+".1"),true);
    const latest=activationSummary(cwd);
    assert.ok(latest.total>0);
    assert.ok(latest.total<20,"rotated logs must not grow indefinitely");
    appendFileSync(path,"{broken\n");
    assert.equal(activationSummary(cwd).malformed,1);
  });
});

test("telemetry disabled and failed writes do not throw or block work",()=>{
  withState((cwd)=>{
    process.env.PI_ATDD_TELEMETRY="off";
    assert.equal(appendActivation(cwd,{point:"task_start",outcome:"matched"}).ok,true);
    assert.equal(existsSync(activationLogPath(cwd)),false);
    delete process.env.PI_ATDD_TELEMETRY;
    const log=activationLogPath(cwd);
    mkdirSync(process.env.PI_ATDD_TELEMETRY_DIR!,{recursive:true});
    writeFileSync(join(process.env.PI_ATDD_TELEMETRY_DIR!,"cannot-exist"),"x");
    process.env.PI_ATDD_TELEMETRY_DIR=join(process.env.PI_ATDD_TELEMETRY_DIR!,"cannot-exist");
    const out=appendActivation(cwd,{point:"task_start",outcome:"unknown"});
    assert.equal(out.ok,false);
    assert.ok(log);
  });
});

test("path classes use categories without exposing the file path",()=>{
  assert.equal(activationPathCategory("src/orders/server.ts"),"source");
  assert.equal(activationPathCategory("src/orders.test.ts"),"test");
  assert.equal(activationPathCategory("vendor/x/server.ts"),"vendor");
  assert.equal(activationPathCategory("README.md"),"other");
  assert.equal(activationPathCategory(),"none");
});
