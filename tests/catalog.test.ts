// Acceptance: acc:pi-atdd:E001-UNIT-002
// Acceptance: acc:pi-atdd:E001-UNIT-003
// Acceptance: acc:pi-atdd:E001-UNIT-004
import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { digestSource, GraphError, loadCatalog, readYaml, resolveContext, validateSelectors, type SourceSpec } from "../src/catalog.ts";
import atdd, { explain } from "../extensions/atdd.ts";

const here = dirname(fileURLToPath(import.meta.url));
function workspace(): { cwd: string; sources: SourceSpec[]; selectors: any[]; cleanup: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-fixture-"));
  cpSync(join(here, "fixtures/bun"), join(cwd, "bun"), { recursive: true });
  cpSync(join(here, "fixtures/flow"), join(cwd, "flow"), { recursive: true });
  cpSync(join(here, "fixtures/selectors.yaml"), join(cwd, "selectors.yaml"));
  const sources: SourceSpec[] = [
    { id: "ATDD-Bun", kind: "bun", path: "bun", sha256: digestSource(join(cwd, "bun"), "bun"), revision: "5945d97e" },
    { id: "ATDD-Flow", kind: "flow", path: "flow", sha256: digestSource(join(cwd, "flow"), "flow"), revision: "2a66019a" },
  ];
  writeFileSync(join(cwd, "atdd-pi.yaml"),
    "schema: pi-atdd/config/v2\nsources:\n" + sources.map(s =>
      "  - id: " + s.id + "\n    kind: " + s.kind + "\n    path: " + s.path +
      "\n    sha256: " + s.sha256 + "\n    revision: " + s.revision + "\n").join("") +
    "selectors: selectors.yaml\n");
  const selectors = readYaml(join(cwd, "selectors.yaml")).selectors as any[];
  return { cwd, sources, selectors, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("Bun + Flow canonicals are loaded unchanged and explicitly pinned", () => {
  const w = workspace();
  try {
    const graph = loadCatalog(w.sources, w.cwd);
    assert.equal(graph.rules.size, 5);
    assert.match(graph.rules.get("atdd-flow.collaboration")!.statement, /accountable delegation/);
    assert.match(graph.rules.get("coder.bun.phase-discipline")!.statement, /GREEN/);
    assert.equal(graph.provenance.length, 2);
    assert.match(graph.rules.get("atdd-bun.review.behavioral-reconciliation")!.file, /^ATDD-Bun\//);
    assert.match(graph.rules.get("atdd-workflow.workflow.lifecycle")!.file, /^ATDD-Flow\//);
    assert.equal(graph.edges.length, 2);
    assert.equal(graph.unresolvedEdges.length, 0);
  } finally { w.cleanup(); }
});

test("mandatory requires closure applies while follows does not imply an extra rule", () => {
  const w = workspace();
  try {
    const graph = loadCatalog(w.sources, w.cwd);
    const found = resolveContext(graph, w.selectors, "Review the implementation", [], "task");
    assert.deepEqual(found.matchingIds,
      ["atdd-bun.review.behavioral-reconciliation", "atdd-bun.review.owner-inspectability"]);
    assert.ok(found.rules.some(r => r.reasons.includes("requires:atdd-bun.review.behavioral-reconciliation")));
    assert.ok(!found.matchingIds.includes("coder.bun.phase-discipline"));
    const flow = resolveContext(graph, w.selectors, "Jujutsu integration branch handover", [], "task");
    assert.ok(flow.matchingIds.includes("atdd-workflow.workflow.lifecycle"));
  } finally { w.cleanup(); }
});

test("nonmatching tasks produce explicit applicability gaps", () => {
  const w = workspace();
  try {
    const graph = loadCatalog(w.sources, w.cwd);
    const ctx = resolveContext(graph, w.selectors, "Update documentation", ["docs/index.md"], "edit");
    assert.equal(ctx.status, "unresolved");
    assert.match(ctx.note, /coverage gap/);
  } finally { w.cleanup(); }
});

test("source drift invalidates locks including modified convention text", () => {
  const w = workspace();
  try {
    writeFileSync(join(w.cwd, "flow/conventions/atdd-flow.collaboration/atdd-flow.collaboration.convention.yaml"),
      readFileSync(join(w.cwd, "flow/conventions/atdd-flow.collaboration/atdd-flow.collaboration.convention.yaml"), "utf8") + "\n# unauthorized edit");
    assert.throws(() => loadCatalog(w.sources, w.cwd), /source drift/);
  } finally { w.cleanup(); }
});

test("YAML duplicate keys and bad relationships are rejected/flagged", () => {
  const w = workspace();
  try {
    const path = join(w.cwd, "bun/conventions/coder.bun/coder.bun.phase-discipline.convention.yaml");
    writeFileSync(path, readFileSync(path, "utf8") + "\nrule_id: duplicate\n");
    w.sources[0]!.sha256 = digestSource(join(w.cwd, "bun"), "bun");
    assert.throws(() => loadCatalog(w.sources, w.cwd), /duplicate|YAML/);
    cpSync(join(here, "fixtures/bun"), join(w.cwd, "bun"), { recursive: true, force: true });
    const edgePath = join(w.cwd, "bun/relationships.yaml");
    writeFileSync(edgePath, readFileSync(edgePath, "utf8").replace(
      "target_ref: atdd-bun.review.owner-inspectability", "target_ref: unknown.external.rule"));
    w.sources[0]!.sha256 = digestSource(join(w.cwd, "bun"), "bun");
    const graph = loadCatalog(w.sources, w.cwd);
    assert.equal(graph.unresolvedEdges.length, 1);
    assert.throws(() => resolveContext(graph, w.selectors, "Review", [], "task"), /unresolved mandatory dependency/);
  } finally { w.cleanup(); }
});

test("dormant selectors with unknown IDs fail before any task matches", () => {
  const w = workspace();
  try {
    const graph = loadCatalog(w.sources, w.cwd);
    validateSelectors(graph, [
      ...w.selectors, { id: "later", paths: ["not/reachable/**/*.ts"], rules: ["fabricated.rule"] },
    ]);
    assert.fail("unknown dormant selector should fail");
  } catch (error) {
    assert.match(String(error), /unknown rule/);
  } finally { w.cleanup(); }
});

test("the actual TypeScript Pi adapter registers commands and activates rules before edits", async () => {
  const w = workspace();
  try {
    const handlers = new Map<string, Function>(), commands = new Map<string, unknown>();
    atdd({
      on(name: string, handler: Function) { handlers.set(name, handler); },
      registerCommand(name: string, cmd: unknown) { commands.set(name, cmd); },
      registerTool() {},
    } as any);
    assert.equal(typeof handlers.get("before_agent_start"), "function");
    assert.equal(typeof handlers.get("tool_call"), "function");
    assert.ok(commands.has("atdd"));
    const ctx = { cwd: w.cwd, isProjectTrusted: () => true, ui: { notify() {} } };
    const initial = await handlers.get("before_agent_start")!({ messageType: "user", prompt: "Green implementation" }, ctx);
    assert.match(initial.message.content, /coder\.bun\.phase-discipline/);
    const event = { toolName: "edit", input: { path: "src/workspace/driver.ts" } };
    const once = await handlers.get("tool_call")!(event, ctx);
    assert.equal(once.block, true);
    assert.match(once.reason, /atdd-workflow.workflow.lifecycle/);
    assert.equal(await handlers.get("tool_call")!(event, ctx), undefined);
    const untrusted = { ...ctx, isProjectTrusted: () => false };
    assert.equal(await handlers.get("tool_call")!(event, untrusted), undefined);
    await handlers.get("before_agent_start")!({ messageType: "user", prompt: "unrelated" }, ctx);
    const gap = await handlers.get("tool_call")!({ toolName: "edit", input: { path: "docs/index.md" } }, ctx);
    assert.equal(gap.block, true);
    assert.match(gap.reason, /unresolved/);
  } finally { w.cleanup(); }
});

test("the repository's user-facing runtime contains no Python dependency", () => {
  const pkg = JSON.parse(readFileSync(join(here, "../package.json"), "utf8"));
  assert.ok(pkg.pi.extensions.includes("./extensions/atdd.ts"));
  assert.ok(!JSON.stringify(pkg).toLowerCase().includes("python"));
});


test("reviewed reasoning package delivers original guidance, graph rationale and executable evidence reference", () => {
  const w = workspace();
  try {
    const graph = loadCatalog(w.sources, w.cwd);
    const context = resolveContext(graph, w.selectors, "Final behavioral review", [], "task");
    const text = explain(context);
    assert.match(text, /Original implementation guidance:/);
    assert.match(text, /Canonical file:/);
    assert.match(text, /atdd-bun.review.behavioral-reconciliation/);
    assert.match(text, /Related obligation:/);
    assert.match(text, /owner.inspection evidence is checked before final behavioral reconciliation/);
    assert.match(text, /Source digest: [a-f0-9]{64}/);
    assert.match(text, /Verification: select relevant acceptance/);
    const flowContext = resolveContext(graph, w.selectors, "Jujutsu integration branch handover", [], "task");
    const flow = explain(flowContext);
    assert.match(flow, /Original implementation guidance:/);
    assert.match(flow, /runtime binding/i);
    assert.match(flow, /No executable detector reference declared/);
  } finally { w.cleanup(); }
});
