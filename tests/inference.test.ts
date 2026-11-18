// Acceptance: acc:pi-atdd:E002-UNIT-002
// Acceptance: acc:pi-atdd:E002-UNIT-003
import assert from "node:assert/strict";
import { test } from "node:test";
import { PositiveReasoner, groundKey, type Rule, type Fact } from "../src/inference.ts";

const atom = (predicate: string, ...terms: string[]) => ({ predicate, terms });
const fact = (id: string, predicate: string, ...args: string[]): Fact =>
  ({ id, predicate, args, source: "test/trusted", provenance: "fixture:" + id });

test("positive recursive inference reaches the least fixed point without duplicate materializations", () => {
  const rules: Rule[] = [
    { id: "direct", source: "fixture/direct", head: atom("reach","?x","?y"),
      body: [atom("edge","?x","?y")] },
    { id: "transitive", source: "fixture/transitive", head: atom("reach","?x","?z"),
      body: [atom("reach","?x","?y"), atom("edge","?y","?z")] },
  ];
  const reasoner = new PositiveReasoner(rules);
  reasoner.assert(fact("a-b","edge","a","b"));
  reasoner.assert(fact("b-c","edge","b","c"));
  reasoner.assert(fact("c-a","edge","c","a"));
  assert.equal(reasoner.facts("reach").length, 9); // 3-cycle has 9 reachable pairs
  assert.equal(reasoner.query("reach", ["a","c"]).status, "true");
  const witness = reasoner.query("reach", ["a","c"]).proof!;
  assert.ok(witness.derivations.length > 0);
  assert.ok(witness.derivations.some(d => d.rule === "transitive"));
  const dup = reasoner.assert(fact("a-b","edge","a","b"));
  assert.equal(dup.added.length, 0);
  assert.equal(reasoner.facts("reach").length, 9);
});

test("retracting the only root of a cycle removes self-supported recursive conclusions", () => {
  const rules: Rule[] = [
    { id: "seed", source: "fixture", head: atom("active","?a"),
      body: [atom("seed","?a")] },
    { id: "follow", source: "fixture", head: atom("active","?b"),
      body: [atom("active","?a"), atom("edge","?a","?b")] },
  ];
  const engine = new PositiveReasoner(rules);
  engine.assert(fact("edge-ab", "edge","a","b"));
  engine.assert(fact("edge-ba", "edge","b","a"));
  engine.assert(fact("seed-a", "seed","a"));
  assert.equal(engine.has("active",["a"]),true);
  assert.equal(engine.has("active",["b"]),true);
  const update = engine.retract("seed-a");
  assert.equal(engine.has("active",["a"]),false);
  assert.equal(engine.has("active",["b"]),false);
  assert.ok(update.affected >= 3);
  assert.equal(engine.query("active",["a"]).status,"unknown");
});

test("a positive cycle remains supported by a different extensional root after retraction",()=>{
  const rules:Rule[]=[
    {id:"base",source:"fixture",head:atom("active","?x"),body:[atom("seed","?x")]},
    {id:"next",source:"fixture",head:atom("active","?y"),
      body:[atom("active","?x"),atom("edge","?x","?y")]},
  ];
  const e=new PositiveReasoner(rules);
  e.assert(fact("ab","edge","a","b"));
  e.assert(fact("ba","edge","b","a"));
  e.assert(fact("seed-a","seed","a"));
  e.assert(fact("seed-b","seed","b"));
  assert.equal(e.has("active",["a"]),true);
  assert.equal(e.has("active",["b"]),true);
  e.retract("seed-a");
  assert.equal(e.has("active",["a"]),true,"surviving b seed can still support a");
  assert.equal(e.has("active",["b"]),true);
  const proof=JSON.stringify(e.query("active",["a"]).proof);
  assert.ok(proof.includes("seed-b"), proof);
  assert.ok(!proof.includes("seed-a"));
  e.retract("seed-b");
  assert.equal(e.has("active",["a"]),false);
  assert.equal(e.has("active",["b"]),false);
});

test("stored derivation premises are immutable across later join matches",()=>{
  const rules:Rule[]=[
    {id:"seed",source:"test",head:atom("active","?x"),body:[atom("seed","?x")]},
    {id:"edge",source:"test",head:atom("active","?y"),body:[atom("active","?x"),atom("edge","?x","?y")]},
  ];
  const e=new PositiveReasoner(rules);
  for(const [id,pred,a,b] of [
    ["ab","edge","a","b"],["cd","edge","c","d"],["be","edge","b","e"],["ac","edge","a","c"],
  ])e.assert(fact(id,pred,a,b));
  e.assert(fact("root-a","seed","a"));
  e.assert(fact("root-c","seed","c"));
  const first=JSON.stringify(e.query("active",["b"]).proof);
  assert.ok(first.includes('"a"'));
  assert.ok(first.includes("root-a"));
  assert.ok(!first.includes("root-c"));
  e.retract("root-c");
  assert.equal(e.has("active",["b"]),true);
  const next=JSON.stringify(e.query("active",["b"]).proof);
  assert.ok(next.includes("root-a"));
  assert.ok(!next.includes("root-c"));
});

test("independent supports survive retraction, but obsolete explanations disappear", () => {
  const rules: Rule[] = [
    { id: "selector", source: "fixture", head: atom("active","?scope","?rule"),
      body: [atom("match","?scope","?selector"),atom("maps","?selector","?rule")] },
  ];
  const engine = new PositiveReasoner(rules);
  engine.assert(fact("maps-a","maps","task","coder.bun.phase-discipline"));
  engine.assert(fact("maps-b","maps","file","coder.bun.phase-discipline"));
  engine.assert(fact("hit-task","match","s","task"));
  engine.assert(fact("hit-file","match","s","file"));
  const both = engine.query("active",["s","coder.bun.phase-discipline"]).proof!;
  assert.equal(both.derivations.length,2);
  assert.equal(both.derivations[0]?.premises.length,2);
  engine.retract("hit-task");
  const one = engine.query("active",["s","coder.bun.phase-discipline"]).proof!;
  assert.equal(one.derivations.length,1);
  assert.ok(JSON.stringify(one).includes("hit-file"));
  assert.ok(!JSON.stringify(one).includes("hit-task"));
  engine.retract("hit-file");
  assert.equal(engine.query("active",["s","coder.bun.phase-discipline"]).status,"unknown");
});

test("same ground fact asserted by two sources retains an explanation after one is removed", () => {
  const e = new PositiveReasoner([{ id:"one", source:"fixture", head: atom("active","?x"),
    body:[atom("work","?x")] }]);
  e.assert(fact("source-one","work","s"));
  e.assert(fact("source-two","work","s"));
  assert.equal(e.query("active",["s"]).proof?.derivations[0]?.premises[0]?.assertions.length,2);
  e.retract("source-one");
  assert.equal(e.query("active",["s"]).proof?.derivations[0]?.premises[0]?.assertions.length,1);
  assert.equal(e.query("active",["s"]).status, "true");
  e.retract("source-two");
  assert.equal(e.has("active",["s"]),false);
});

test("unsafe rules, negation and unsupported variables are rejected explicitly", () => {
  assert.throws(() => new PositiveReasoner([{
    id:"unsafe", source:"test", head:atom("out","?unbound"),
    body:[atom("fact","?bound")],
  }]),/unsafe unbound/);
  assert.throws(() => new PositiveReasoner([{
    id:"negative", source:"test", head:atom("out","?x"),
    body:[{...atom("fact","?x"), negated:true} as unknown as ReturnType<typeof atom>],
  }]),/unsupported|malformed/);
  assert.throws(() => new PositiveReasoner([{
    id:"empty", source:"test", head:atom("out","?x"), body:[],
  }]),/nonempty/);
  const e = new PositiveReasoner([]);
  assert.equal(e.query("authority",["main"]).status, "unknown");
  assert.throws(() => e.assert(fact("bad","!negative","x")),/unsupported|malformed/);
});

test("retracted facts can be reasserted with new provenance without stale derivations", () => {
  const e = new PositiveReasoner([{id:"copy",source:"test",head:atom("q","?x"),body:[atom("p","?x")]}]);
  e.assert({id:"id",predicate:"p",args:["one"],source:"before"});
  assert.equal(e.has("q",["one"]),true);
  assert.throws(()=>e.assert({id:"id",predicate:"p",args:["two"],source:"after"}),/explicit retraction/);
  e.retract("id");
  e.assert({id:"id",predicate:"p",args:["two"],source:"after"});
  assert.equal(e.has("q",["one"]),false);
  assert.equal(e.has("q",["two"]),true);
  assert.deepEqual(e.query("q",["two"]).proof?.derivations[0]?.premises[0]?.assertions.map(x=>x.source),["after"]);
});

test("deletion rederivation costs less work than cold construction on unrelated predicates", () => {
  const rules: Rule[] = [
    {id:"copy",source:"fixture",head:atom("active","?a"),body:[atom("seed","?a")]},
    {id:"hop",source:"fixture",head:atom("active","?b"),
      body:[atom("active","?a"),atom("next","?a","?b")]},
  ];
  const e = new PositiveReasoner(rules);
  for(let i=0;i<45;i++) {
    e.assert(fact("next:"+i,"next","step:"+i,"step:"+(i+1)));
    e.assert(fact("unrelated:"+i,"noise","random:"+i));
  }
  e.assert(fact("root","seed","step:0"));
  assert.equal(e.facts("active").length,46);
  const before=e.materializedCount;
  const delta=e.retract("root");
  assert.equal(e.facts("active").length,0);
  assert.ok(delta.affected >= 46);
  assert.ok(delta.scans < 100_000, "bounded local recomputation must not explode");
  assert.ok(e.materializedCount < before);
  assert.equal(e.query("active",["step:45"]).status,"unknown");
  // The fixture is a cost sanity test, not a model-performance claim.
});


test("bounded insertion failure poisons the engine; no partial query or retry is permitted",()=>{
  const e=new PositiveReasoner([{
    id:"cross",source:"test",
    head:atom("derived","?x"),
    body:[atom("trigger","?x"),atom("candidate","?y")],
  }],1);
  e.assert(fact("candidate-1","candidate","a"));
  e.assert(fact("candidate-2","candidate","b"));
  assert.throws(()=>e.assert(fact("trigger-1","trigger","scope")),/join bound exceeded/);
  assert.throws(()=>e.query("derived",["scope"]),/engine invalidated/);
  assert.throws(()=>e.facts(),/engine invalidated/);
  assert.throws(()=>e.has("trigger",["scope"]),/engine invalidated/);
  assert.throws(()=>e.retract("candidate-1"),/engine invalidated/);
  assert.throws(()=>e.assert(fact("third","candidate","c")),/engine invalidated/);
  const rebuilt=new PositiveReasoner([{id:"single",source:"test",
    head:atom("derived","?x"),body:[atom("trigger","?x")]}]);
  rebuilt.assert(fact("fresh","trigger","scope"));
  assert.equal(rebuilt.query("derived",["scope"]).status,"true");
});

test("bounded deletion failure poisons the engine after partial over-deletion",()=>{
  const rules:Rule[]=[
    {id:"seed-rule",source:"test",head:atom("active","?x"),body:[atom("seed","?x")]},
    {id:"next-rule",source:"test",head:atom("active","?y"),
      body:[atom("active","?x"),atom("edge","?x","?y")]},
  ];
  const e=new PositiveReasoner(rules,1000);
  e.assert(fact("ab","edge","a","b"));
  e.assert(fact("ba","edge","b","a"));
  e.assert(fact("bc","edge","b","c"));
  e.assert(fact("seed-a","seed","a"));
  e.assert(fact("seed-b","seed","b"));
  assert.equal(e.has("active",["a"]),true);
  // Fault injection: lower the public engine's private cost guard after the
  // initial valid materialization to exercise the deletion exception path.
  (e as unknown as {maxSteps:number}).maxSteps=1;
  assert.throws(()=>e.retract("seed-a"),/rederivation join bound exceeded/);
  assert.throws(()=>e.query("active",["b"]),/engine invalidated/);
  assert.throws(()=>e.assert(fact("seed-c","seed","c")),/engine invalidated/);
});
