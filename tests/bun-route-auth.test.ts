// ATD-22: security source witnesses are distinct from lexical task wording.
import test from "node:test";
import assert from "node:assert/strict";
import {inspectBunRouteAuth} from "../src/bun-route-auth.ts";

const route=(method:string,handler:string)=>
  'Bun.serve({routes:{"/orders":{'+method+":"+handler+"}}});";
const handler='()=>new Response("ok")';

test("Bun auth observer reports positive unguarded and a source-backed GET-only negative",()=>{
  assert.equal(inspectBunRouteAuth("src/server.ts",route("DELETE",handler)).status,"unguarded");
  assert.equal(inspectBunRouteAuth("src/server.ts",route("GET",handler)).status,"read-only");
  assert.equal(inspectBunRouteAuth("src/server.ts",'const other={DELETE:()=>1};').status,"unrelated");
});
test("only a guard inside the affected handler exempts that handler",()=>{
  const guarded='()=>{requireAuth();return new Response("ok")}';
  assert.equal(inspectBunRouteAuth("src/server.ts",route("POST",guarded)).status,"guarded");
  const sibling='Bun.serve({routes:{"/x":{GET:()=>{requireAuth();return 1},DELETE:()=>2}}});';
  assert.equal(inspectBunRouteAuth("src/server.ts",sibling).status,"unguarded");
  const mixed='Bun.serve({routes:{"/x":{POST:'+guarded+',DELETE:()=>2}}});';
  assert.equal(inspectBunRouteAuth("src/server.ts",mixed).status,"unguarded");
});
test("a guard after an observable write or inside a nested callback is not a safe negative",()=>{
  const late='Bun.serve({routes:{"/x":{PUT:()=>{persist();requireAuth();return 2}}}});';
  assert.equal(inspectBunRouteAuth("src/server.ts",late).status,"unknown");
  const nested='Bun.serve({routes:{"/x":{PUT:()=>{queue(()=>requireAuth());return 2}}}});';
  assert.equal(inspectBunRouteAuth("src/server.ts",nested).status,"unguarded");
  const branch='Bun.serve({fetch(req){if(req.method==="POST"){persist();requireAuth();return 2}}});';
  assert.equal(inspectBunRouteAuth("src/server.ts",branch).status,"unknown");
});

test("unresolved handler, dynamic config and incomplete syntax are UNKNOWN, not safe",()=>{
  assert.deepEqual(inspectBunRouteAuth("src/server.ts",route("POST","handler")),
    {status:"unknown",reasons:["route_or_handler_unresolved"]});
  assert.equal(inspectBunRouteAuth("src/server.ts",'Bun.serve(buildConfig());').status,"unknown");
  assert.equal(inspectBunRouteAuth("src/server.ts",'Bun.serve({routes:{').status,"unknown");
  assert.equal(inspectBunRouteAuth("src/server.ts",undefined).status,"unknown");
  assert.equal(inspectBunRouteAuth("src/server.test.ts",route("POST",handler)).status,"unrelated");
});
test("nested callbacks cannot masquerade as the Bun fetch request handler",()=>{
  const nested='Bun.serve({fetch(req){const helper=()=>{if(req.method==="PATCH")return 1;};return new Response("ok")}});';
  assert.equal(inspectBunRouteAuth("src/server.ts",nested).status,"unknown");
  const sameName='Bun.serve({fetch(req){const helper=()=>{const method=req.method;if(method==="POST")return 1;};return new Response("ok")}});';
  assert.equal(inspectBunRouteAuth("src/server.ts",sameName).status,"unknown");
});

test("foreign method properties do not fabricate a request mutation",()=>{
  const foreign='Bun.serve({fetch(req){const other={method:"POST"};if(other.method==="POST")return 1;}});';
  assert.equal(inspectBunRouteAuth("src/server.ts",foreign).status,"unknown");
  const alias='Bun.serve({fetch(req){const other={method:"POST"};const method=other.method;if(method==="POST")return 1;}});';
  assert.equal(inspectBunRouteAuth("src/server.ts",alias).status,"unknown");
  const real='Bun.serve({fetch(request){const method=request.method;if(method==="POST")return 1;}});';
  assert.equal(inspectBunRouteAuth("src/server.ts",real).status,"unguarded");
});

test("fetch method checks are branch-sensitive, including a method alias",()=>{
  const plain='Bun.serve({fetch(req){const method=req.method;if(method==="PATCH"){return new Response("ok")}}});';
  assert.equal(inspectBunRouteAuth("src/server.ts",plain).status,"unguarded");
  const guarded='Bun.serve({fetch(req){if(req.method==="PATCH"){requireAuth();return new Response("ok")}}});';
  assert.equal(inspectBunRouteAuth("src/server.ts",guarded).status,"guarded");
  const sibling='Bun.serve({fetch(req){if(req.method==="GET"){requireAuth()} if(req.method==="POST"){return new Response("ok")}}});';
  assert.equal(inspectBunRouteAuth("src/server.ts",sibling).status,"unguarded");
});
