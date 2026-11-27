// URN: test:pi-atdd:resolve-activation:plt-79-a01
// Acceptance: acc:pi-atdd:plt-79-a01
// PLT-79 prerequisite 1: graph delivery for shell edits, word-boundary selector
// terms and a post-tool page budget that keeps the target rule.
// Reproduces the PLT-78 trial t10 miss: claude-opus-5-5 wrote
// src/pricing/domain/quote.ts through a bash heredoc, the pre-edit hook never
// fired, and the post-tool page (4,500 chars) emitted only
// coach.workflow.lifecycle (activated by the substring `integration/`),
// never coder.architecture.hierarchy-import.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import atdd from "../extensions/atdd.ts";
import { shellWriteTargets } from "../src/shell-targets.ts";
import { termMatches, digestSource, loadConfig, loadCatalog } from "../src/catalog.ts";
import { ReasoningSession } from "../src/reasoning-context.ts";
import { relevance, renderReasonedPage } from "../src/render-reasoning.ts";

const TARGET = "coder.architecture.hierarchy-import";
/** Verbatim PLT-78 T2-ARCH prompt (trial t10). */
const T2_PROMPT = [
  "You are a coding agent working in this repository (a disposable checkout of a small TypeScript service; read README.md for its layering). Complete task T2-ARCH.",
  "",
  "Cart quotes currently ignore tax. Make quotes include the regional tax rate that is configured in the tax-rate provider (src/pricing/integration/tax-rates.ts). The TODO in the pricing domain marks where tax is missing.",
  "",
  "Acceptance PRC-TAX-001:",
  "Given cart lines and a region with a configured tax rate",
  "When a quote is requested through the quote service",
  "Then taxCents = subtotal x configured regional rate (rounded to the nearest cent)",
  " and totalCents = subtotalCents + taxCents",
  "",
  "You may change ONLY these files: src/pricing/domain/quote.ts, src/pricing/application/quote-service.ts. Do not modify, add or delete tests, test helpers or any other file, and do not commit. Run the acceptance test with: node --test tests/pricing/regional-tax.acceptance.test.ts",
  "",
  "When finished, reply with a short report: what you changed, the test result, and any concerns about whether the acceptance is truly satisfied.",
].join("\n");
/** Verbatim shape of the t10 bash edit (heredoc rewrite of a domain module). */
const T10_QUOTE = "export type Line = { sku: string; unitPriceCents: number; quantity: number };\n" +
  "export function quote(lines: Line[], region: string, taxRate: number) {\n" +
  "  const subtotalCents = lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);\n" +
  "  const taxCents = Math.round(subtotalCents * taxRate);\n" +
  "  return { region, subtotalCents, taxCents, totalCents: subtotalCents + taxCents };\n}\n";
const T10_COMMAND = "cat > src/pricing/domain/quote.ts <<'EOF'\n" + T10_QUOTE + "EOF\n" +
  "node --test tests/pricing/regional-tax.acceptance.test.ts 2>&1 | tail -8";

type Delivered = { channel: string; text: string };
function sandbox() {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-shell-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
  git("init", "-q"); git("config", "user.name", "Pi tester"); git("config", "user.email", "test@example.invalid");
  for (const d of ["src/pricing/domain", "src/pricing/application", "src/pricing/integration", "tests/pricing", "scripts"])
    mkdirSync(join(cwd, d), { recursive: true });
  writeFileSync(join(cwd, "src/pricing/domain/quote.ts"), "export const quote = () => 0; // TODO: tax\n");
  writeFileSync(join(cwd, "src/pricing/application/quote-service.ts"), "export const quoteForCart = () => 0;\n");
  writeFileSync(join(cwd, "src/pricing/integration/tax-rates.ts"), "export const getTaxRate = () => 0.19;\n");
  writeFileSync(join(cwd, "scripts/gen.mjs"), "// opaque generator\n");
  git("add", "."); git("commit", "-qm", "base");
  const handlers = new Map<string, Function>();
  const delivered: Delivered[] = [];
  const p = {
    on: (name: string, fn: Function) => { handlers.set(name, fn); },
    registerCommand: () => {},
    registerTool: () => {},
    sendMessage: (message: { customType: string; content: string }) =>
      delivered.push({ channel: "message:" + message.customType, text: message.content }),
  };
  atdd(p as any);
  const ctx = { cwd, isProjectTrusted: () => true, ui: { notify: () => {} } };
  let n = 0;
  /** Drive one Pi tool round in hook order; `effect` is the tool's file mutation. */
  function tool(toolName: string, input: Record<string, unknown>, effect: () => void) {
    const toolCallId = "call-" + (++n);
    const pre = handlers.get("tool_call")!({ type: "tool_call", toolName, toolCallId, input }, ctx);
    if (pre?.block) {
      delivered.push({ channel: "block:" + toolName, text: pre.reason });
      handlers.get("tool_execution_end")!({ toolName, toolCallId, isError: true, result: pre.reason }, ctx);
      return { blocked: true, reason: pre.reason as string };
    }
    effect();
    const content = [{ type: "text", text: "ok" }];
    const patched = handlers.get("tool_result")?.({ type: "tool_result", toolName, toolCallId, input, content, isError: false }, ctx);
    const finalContent = patched?.content ?? content;
    for (const c of finalContent.slice(1)) delivered.push({ channel: "tool_result:" + toolName, text: c.text });
    handlers.get("tool_execution_end")!({ toolName, toolCallId, isError: false, result: { content: finalContent } }, ctx);
    return { blocked: false, content: finalContent };
  }
  const start = (prompt: string) => {
    const r = handlers.get("before_agent_start")!({ messageType: "user", prompt }, ctx);
    if (r?.message) delivered.push({ channel: "message:" + r.message.customType, text: r.message.content });
    return r?.message?.content as string | undefined;
  };
  return { cwd, delivered, tool, start, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}
const has = (d: Delivered[], id: string) => d.some(x => x.text.includes("Convention " + id + " —"));

test("PLT-78 t10 reproduction: a bash heredoc edit of a domain module receives the target rule before the change", () => {
  const x = sandbox();
  try {
    x.start(T2_PROMPT);
    assert.ok(!has(x.delivered, TARGET), "precondition: the task page alone does not carry the domain rule");
    const before = readFileSync(join(x.cwd, "src/pricing/domain/quote.ts"), "utf8");
    const first = x.tool("bash", { command: T10_COMMAND }, () => writeFileSync(join(x.cwd, "src/pricing/domain/quote.ts"), T10_QUOTE));
    assert.equal(first.blocked, true, "the shell write must be preflighted like edit/write");
    assert.match(first.reason!, new RegExp("Convention " + TARGET.replaceAll(".", "\\.") + " —"));
    assert.equal(readFileSync(join(x.cwd, "src/pricing/domain/quote.ts"), "utf8"), before, "no change before delivery");
    // Retrying the same command after reading the guidance proceeds (no preflight loop).
    const retry = x.tool("bash", { command: T10_COMMAND }, () => writeFileSync(join(x.cwd, "src/pricing/domain/quote.ts"), T10_QUOTE));
    assert.equal(retry.blocked, false);
  } finally { x.cleanup(); }
});

test("edit/write and bash receive the same rule set for the same target file", () => {
  const a = sandbox(), b = sandbox();
  try {
    a.start(T2_PROMPT); b.start(T2_PROMPT);
    const viaEdit = a.tool("write", { path: "src/pricing/domain/quote.ts", content: T10_QUOTE }, () => {});
    const viaBash = b.tool("bash", { command: T10_COMMAND }, () => {});
    const ids = (s: string) => [...s.matchAll(/Convention ([a-z0-9_.-]+) —/g)].map(m => m[1]).sort();
    assert.equal(viaEdit.blocked, true); assert.equal(viaBash.blocked, true);
    assert.deepEqual(ids(viaBash.reason!), ids(viaEdit.reason!));
    assert.ok(ids(viaBash.reason!).includes(TARGET));
  } finally { a.cleanup(); b.cleanup(); }
});

test("an unparseable shell write is detected after the tool and the target rule is delivered before the agent continues", () => {
  const x = sandbox();
  try {
    x.start(T2_PROMPT);
    const r = x.tool("bash", { command: "node scripts/gen.mjs" },
      () => writeFileSync(join(x.cwd, "src/pricing/domain/quote.ts"), T10_QUOTE));
    assert.equal(r.blocked, false, "no write target is visible in the command, so it cannot be preflighted");
    const post = x.delivered.filter(d => d.channel.startsWith("tool_result:"));
    assert.ok(post.length > 0, "reconciliation must be attached to the tool result the model reads next");
    assert.ok(has(post, TARGET), "target rule must be in the post-tool reconciliation: " + post.map(p => p.text.slice(0, 200)).join("|"));
    assert.match(post.map(p => p.text).join("\n"), /src\/pricing\/domain\/quote\.ts/);
  } finally { x.cleanup(); }
});

test("selector terms match on word boundaries", () => {
  const x = sandbox();
  try {
    const page = x.start(T2_PROMPT)!;
    assert.ok(!page.includes("Convention coach.workflow.lifecycle —"), "`integration/` inside a source path is not an integration branch");
    assert.ok(!page.includes("Convention coder.phase.discipline —"), "`red` inside `configured` is not the RED phase");
  } finally { x.cleanup(); }
  const y = sandbox();
  try {
    const page = y.start("Rebase onto integration/feature-tax, then make the red test green")!;
    assert.ok(page.includes("Convention coach.workflow.lifecycle —"));
    assert.ok(page.includes("Convention coder.phase.discipline —"));
  } finally { y.cleanup(); }
});

test("the post-tool page budget keeps the target rule and drops lower-relevance rules first", () => {
  const x = sandbox();
  try {
    // Many task-term activations compete with the file-specific rule.
    x.start("Review the integration branch with the coordinator, check acceptance coverage and traceability, " +
      "keep the red/green/refactor phase, handle agent communication and inbox message delivery, and approve merge readiness.");
    x.tool("bash", { command: "node scripts/gen.mjs" },
      () => writeFileSync(join(x.cwd, "src/pricing/domain/quote.ts"), T10_QUOTE));
    const post = x.delivered.filter(d => d.channel.startsWith("tool_result:"));
    assert.ok(has(post, TARGET), "file-specific target rule must survive the post-tool budget");
    const text = post.map(p => p.text).join("\n");
    const first = text.match(/Convention ([a-z0-9_.-]+) —/)?.[1];
    assert.equal(first, TARGET, "highest-relevance (file-specific) rule is rendered first");
    assert.match(text, /omitted by budget/, "the scenario must actually exceed the page budget");
    assert.ok(!/omitted[^\n]*design-hierarchy-import/.test(text), "target rule is never the one omitted");
  } finally { x.cleanup(); }
});

test("static shell write-target extraction covers common edit idioms and ignores read-only commands", () => {
  const cases: Array<[string, string[]]> = [
    [T10_COMMAND, ["src/pricing/domain/quote.ts"]],
    ["cat > src/a.ts <<'EOF'\nconst x = a > b ? 1 : 2;\nEOF", ["src/a.ts"]],
    ["sed -i '' 's/a/b/' src/x.ts", ["src/x.ts"]],
    ["perl -pi -e 's/x/y/' src/q.ts", ["src/q.ts"]],
    ["printf 'x' | tee -a src/t.ts", ["src/t.ts"]],
    ["cp a.ts src/c.ts && mv x.ts src/y.ts", ["src/c.ts", "src/y.ts"]],
    ["node -e \"require('fs').writeFileSync('src/p/domain/q.ts', 'x')\"", ["src/p/domain/q.ts"]],
    ["python3 - <<'PY'\nopen('src/z.py','w').write('x')\nPY", ["src/z.py"]],
    ["git apply <<'EOF'\ndiff --git a/src/k.ts b/src/k.ts\n--- a/src/k.ts\n+++ b/src/k.ts\nEOF", ["src/k.ts"]],
    ["ls -R src tests; cat README.md src/pricing/domain/quote.ts", []],
    ["npm test 2>&1 | grep -E 'fail' > /dev/null; node --test x.test.ts 2>&1 | tail -8", []],
  ];
  for (const [command, expected] of cases) assert.deepEqual(shellWriteTargets(command).sort(), expected.sort(), command);
});

test("termMatches: word boundaries, path segments and simple plurals", () => {
  const yes: Array<[string, string]> = [["the red test", "red"], ["red/green/refactor", "red"], ["red/green/refactor", "green"],
    ["red/green/refactor", "refactor"], ["-red test", "red"], ["push integration/feature-x", "integration/"],
    ["add routes", "route"], ["the route.", "route"], ["Acceptance PRC-TAX-001", "acceptance"], ["review imports", "imports"]];
  const no: Array<[string, string]> = [["configured", "red"], ["preferred", "red"], ["src/pricing/integration/tax-rates.ts", "integration/"],
    ["src/orders/routes/order-routes.ts", "route"], ["route.ts", "route"], ["reviewer", "review"],
    ["see src/pricing/integration/ for rates", "integration/"], ["(src/pricing/integration/tax-rates.ts).", "integration/"]];
  for (const [text, term] of yes) assert.equal(termMatches(text, term), true, term + " in " + text);
  for (const [text, term] of no) assert.equal(termMatches(text, term), false, term + " in " + text);
});

// --- Blind code review (PR #5, round 1) regressions ---

test("review#1: every changed file is reconciled, none dropped past a count cap", () => {
  const x = sandbox();
  try {
    x.start("Update pricing");
    const files = Array.from({ length: 9 }, (_, i) => "src/pricing/domain/f" + i + ".ts");
    x.tool("bash", { command: "node scripts/gen.mjs" }, () => files.forEach(f => writeFileSync(join(x.cwd, f), "export const v = 1;\n")));
    const text = x.delivered.filter(d => d.channel.startsWith("tool_result:")).map(d => d.text).join("\n");
    for (const f of files) assert.match(text, new RegExp("Changed file " + f.replaceAll(".", "\\.") + ":\\n"), f);
    const pages = text.split("ATDD post-tool reconciliation. Changed file ").slice(1);
    assert.equal(pages.length, 9);
    for (const page of pages) assert.match(page, /Convention coder\.architecture\.hierarchy-import —/);
  } finally { x.cleanup(); }
});

function rankingRepo(selector: string[]) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-atdd-rank-"));
  {
    mkdirSync(join(cwd, "extra/conventions"), { recursive: true });
    const conv = (id: string, lines: number) => [
      "rule_id: " + id, "kind: rule", "status: active",
      "statement: Obligation " + id + " applies to the observed file.",
      "content:", "  summary: Preserve " + id + ".", "  fix_hint: |",
      ...Array(lines).fill("    Inspect the boundary, the tests and the observed change before approving this work."), "",
    ].join("\n");
    writeFileSync(join(cwd, "extra/conventions/aaa.prerequisite.convention.yaml"), conv("aaa.prerequisite", 14));
    writeFileSync(join(cwd, "extra/conventions/zzz.target.convention.yaml"), conv("zzz.target", 14));
    writeFileSync(join(cwd, "extra/relationships.yaml"), [
      "schema_version: 1.0.0", "graph_id: extra", "nodes:", "  - aaa.prerequisite", "  - zzz.target", "edges:",
      "  - source_ref: zzz.target", "    target_ref: aaa.prerequisite", "    type: requires", "    constraint: mandatory",
      "    control: internal", "    reason: target needs prerequisite", "",
    ].join("\n"));
    const checksum = digestSource(join(cwd, "extra"), "extension");
    writeFileSync(join(cwd, "atdd-pi.yaml"), ["schema: pi-atdd/config/v2", "sources:", "  - id: Extra", "    kind: extension",
      "    path: extra", "    sha256: " + checksum, "selectors: extra-selectors.yaml", ""].join("\n"));
    writeFileSync(join(cwd, "extra-selectors.yaml"), ["schema: pi-atdd/selectors/v1", "selectors:", "  - id: target-selector",
      ...selector, "    rules: [zzz.target]", ""].join("\n"));
    return cwd;
  }
}
function assertTargetFirst(cwd: string, task: string, path: string) {
  const cfg = loadConfig(cwd), catalog = loadCatalog(cfg.sources, cwd);
  const session = new ReasoningSession(catalog, cfg.selectors);
  const r = session.observe({ scope: "pi-run:1:file:" + path, task, operation: "edit", path,
    origin: "repository-observation", provenance: "Git/JJ post-tool observed bash" });
  const target = r.activations.find(a => a.id === "zzz.target")!, pre = r.activations.find(a => a.id === "aaa.prerequisite")!;
  assert.ok(target && pre, "both activate");
  assert.ok(relevance(target) > relevance(pre), "target " + relevance(target) + " vs prerequisite " + relevance(pre));
  for (const budget of [2_000, 3_000, 4_500, 12_000]) {
    const page = renderReasonedPage(r, undefined, budget);
    assert.ok(page.text.length <= budget, "bound " + budget);
    assert.equal(page.emittedIds[0], "zzz.target", "budget " + budget);
  }
}

test("review#2: a mandatory prerequisite never outranks the directly targeted rule (path- or term-selected)", () => {
  const byPath = rankingRepo(["    paths: [\"src/**/domain/*.ts\"]"]);
  const byTerm = rankingRepo(["    terms: [\"update\"]"]);
  try {
    assertTargetFirst(byPath, "update", "src/pricing/domain/quote.ts");
    assertTargetFirst(byTerm, "update", "src/pricing/domain/quote.ts");
    // A very long scope/path must not crowd the top rule out of a 2,000-char page.
    const deep = "src/" + Array.from({ length: 60 }, (_, i) => "segment" + i).join("/") + "/domain/quote.ts";
    assertTargetFirst(byPath, "update", deep);
  } finally { rmSync(byPath, { recursive: true, force: true }); rmSync(byTerm, { recursive: true, force: true }); }
});

test("review#2b: ranking repo helper keeps the prerequisite page bounded at 1,200", () => {
  const cwd = rankingRepo(["    paths: [\"src/**/domain/*.ts\"]"]);
  try {
    const cfg = loadConfig(cwd), catalog = loadCatalog(cfg.sources, cwd);
    const r = new ReasoningSession(catalog, cfg.selectors).observe({ scope: "s", task: "update", operation: "edit",
      path: "src/pricing/domain/quote.ts", origin: "repository-observation", provenance: "test" });
    assert.ok(renderReasonedPage(r, undefined, 1_200).text.length <= 1_200);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("review#3: an opaque write to an ignored (untracked) source file is still observed", () => {
  const x = sandbox();
  try {
    writeFileSync(join(x.cwd, ".gitignore"), "src/pricing/domain/ignored.ts\n");
    execFileSync("git", ["add", ".gitignore"], { cwd: x.cwd }); execFileSync("git", ["commit", "-qm", "ignore"], { cwd: x.cwd });
    x.start("Update pricing");
    x.tool("bash", { command: "node scripts/gen.mjs" }, () => writeFileSync(join(x.cwd, "src/pricing/domain/ignored.ts"), "export const v = 1;\n"));
    const post = x.delivered.filter(d => d.channel.startsWith("tool_result:"));
    assert.ok(has(post, TARGET), "ignored file write must be reconciled");
  } finally { x.cleanup(); }
});

test("review#4: shell extraction handles adjacent redirection, quoted sed operands and read-only openSync", () => {
  assert.deepEqual(shellWriteTargets("echo x>src/domain/x.ts"), ["src/domain/x.ts"]);
  assert.deepEqual(shellWriteTargets("sed -i 's/a/b/' 'src/domain/x.ts'"), ["src/domain/x.ts"]);
  assert.deepEqual(shellWriteTargets("sed -i -e 's/a/b/' -e 's/c/d/' src/a.ts \"src/b.ts\""), ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(shellWriteTargets("node -e \"require('fs').openSync('src/domain/x.ts', 'r')\""), []);
  assert.deepEqual(shellWriteTargets("node -e \"require('fs').openSync('src/domain/x.ts', 'w')\""), ["src/domain/x.ts"]);
});

test("review2#1: an opaque write inside an ignored source directory is still observed", () => {
  const x = sandbox();
  try {
    writeFileSync(join(x.cwd, ".gitignore"), "src/generated/\n");
    execFileSync("git", ["add", ".gitignore"], { cwd: x.cwd }); execFileSync("git", ["commit", "-qm", "ignore"], { cwd: x.cwd });
    x.start("Update pricing");
    x.tool("bash", { command: "node scripts/gen.mjs" }, () => {
      mkdirSync(join(x.cwd, "src/generated/domain"), { recursive: true });
      writeFileSync(join(x.cwd, "src/generated/domain/a.ts"), "export const v = 1;\n");
    });
    const post = x.delivered.filter(d => d.channel.startsWith("tool_result:"));
    assert.match(post.map(p => p.text).join("\n"), /Changed file src\/generated\/domain\/a\.ts/);
    assert.ok(has(post, TARGET));
  } finally { x.cleanup(); }
});

test("review2#2: an opaque file creation gets creation-specific rules, like write", () => {
  const x = sandbox();
  try {
    // Replace the default selectors with one that applies only to creations.
    const cwd = x.cwd;
    const conventions = join(cwd, "extra/conventions");
    mkdirSync(conventions, { recursive: true });
    writeFileSync(join(conventions, "new.file.convention.yaml"), ["rule_id: new.file", "kind: rule", "status: active",
      "statement: New source files must be registered.", "content:", "  summary: Register new files.", ""].join("\n"));
    writeFileSync(join(cwd, "atdd-pi.yaml"), ["schema: pi-atdd/config/v2", "sources:", "  - id: Extra", "    kind: extension",
      "    path: extra", "    sha256: " + digestSource(join(cwd, "extra"), "extension"), "selectors: extra-selectors.yaml", ""].join("\n"));
    writeFileSync(join(cwd, "extra-selectors.yaml"), ["schema: pi-atdd/selectors/v1", "selectors:", "  - id: creations",
      "    operations: [create]", "    paths: [\"src/**\"]", "    rules: [new.file]", ""].join("\n"));
    execFileSync("git", ["add", "."], { cwd }); execFileSync("git", ["commit", "-qm", "config"], { cwd });
    x.start("Update pricing");
    x.tool("bash", { command: "node scripts/gen.mjs" }, () => writeFileSync(join(cwd, "src/b.ts"), "export const b = 1;\n"));
    const post = x.delivered.filter(d => d.channel.startsWith("tool_result:"));
    assert.ok(has(post, "new.file"), "creation via opaque shell must get the create-only rule");
    // An edit of an existing tracked file does not get the create-only rule.
    const before = x.delivered.length;
    x.tool("bash", { command: "node scripts/gen.mjs" }, () => writeFileSync(join(cwd, "src/pricing/domain/quote.ts"), "export const q = 2;\n"));
    assert.ok(!has(x.delivered.slice(before), "new.file"));
  } finally { x.cleanup(); }
});

// --- Blind code review (PR #5, round 3) regressions ---

/** Replace the bundled catalog with custom rules (each large) and selectors. */
function customCatalog(cwd: string, rules: Record<string, number>, selectors: string[]) {
  const conventions = join(cwd, "extra/conventions");
  mkdirSync(conventions, { recursive: true });
  for (const [id, lines] of Object.entries(rules)) writeFileSync(join(conventions, id + ".convention.yaml"), [
    "rule_id: " + id, "kind: rule", "status: active", "statement: Obligation " + id + ".", "content:",
    "  summary: Preserve " + id + ".", "  fix_hint: |",
    ...Array(lines).fill("    Inspect the boundary, the tests and the observed change before approving this work."), ""].join("\n"));
  writeFileSync(join(cwd, "atdd-pi.yaml"), ["schema: pi-atdd/config/v2", "sources:", "  - id: Extra", "    kind: extension",
    "    path: extra", "    sha256: " + digestSource(join(cwd, "extra"), "extension"), "selectors: extra-selectors.yaml", ""].join("\n"));
  writeFileSync(join(cwd, "extra-selectors.yaml"), ["schema: pi-atdd/selectors/v1", "selectors:", ...selectors, ""].join("\n"));
  execFileSync("git", ["add", "."], { cwd }); execFileSync("git", ["commit", "-qm", "config"], { cwd });
}

test("review3#1: rules omitted by a post-tool page budget are delivered on the next tool result", () => {
  const x = sandbox();
  try {
    customCatalog(x.cwd, { "aaa.target": 30, "zzz.target": 30 }, ["  - id: all-src", "    paths: [\"src/**\"]", "    rules: [aaa.target, zzz.target]"]);
    x.start("Update");
    x.tool("bash", { command: "node scripts/gen.mjs" }, () => writeFileSync(join(x.cwd, "src/a.ts"), "export const a = 1;\n"));
    const first = x.delivered.filter(d => d.channel.startsWith("tool_result:"));
    assert.ok(has(first, "aaa.target") !== has(first, "zzz.target"), "precondition: one rule omitted by budget");
    x.tool("bash", { command: "true" }, () => {});
    const all = x.delivered.filter(d => d.channel.startsWith("tool_result:"));
    assert.ok(has(all, "aaa.target") && has(all, "zzz.target"), "omitted rule delivered on the next tool result");
    const n = x.delivered.length;
    x.tool("read", { path: "README.md" }, () => {});
    assert.equal(x.delivered.length, n, "nothing pending afterwards");
  } finally { x.cleanup(); }
});

test("review3#2: a staged opaque creation is classified as create", () => {
  const x = sandbox();
  try {
    customCatalog(x.cwd, { "create.only": 2 }, ["  - id: creations", "    operations: [create]", "    paths: [\"src/**\"]", "    rules: [create.only]"]);
    x.start("Update");
    x.tool("bash", { command: "node scripts/gen.mjs" }, () => {
      writeFileSync(join(x.cwd, "src/new.ts"), "export const n = 1;\n");
      execFileSync("git", ["add", "src/new.ts"], { cwd: x.cwd });
    });
    assert.ok(has(x.delivered.filter(d => d.channel.startsWith("tool_result:")), "create.only"));
  } finally { x.cleanup(); }
});

test("review3#3: a bash overwrite of an existing file gets the same rules as the write tool", () => {
  const a = sandbox(), b = sandbox();
  try {
    for (const x of [a, b]) {
      customCatalog(x.cwd, { "create.only": 2 }, ["  - id: creations", "    operations: [create]", "    paths: [\"src/**\"]", "    rules: [create.only]"]);
      x.start("Update");
    }
    const viaWrite = a.tool("write", { path: "src/pricing/domain/quote.ts", content: "x" }, () => {});
    const viaBash = b.tool("bash", { command: "echo changed > src/pricing/domain/quote.ts" }, () => {});
    assert.equal(viaWrite.blocked, true); assert.equal(viaBash.blocked, true);
    assert.match(viaBash.reason!, /Convention create\.only —/);
    const append = sandbox();
    try {
      customCatalog(append.cwd, { "create.only": 2 }, ["  - id: creations", "    operations: [create]", "    paths: [\"src/**\"]", "    rules: [create.only]"]);
      append.start("Update");
      const r = append.tool("bash", { command: "echo more >> src/pricing/domain/quote.ts" }, () => {});
      assert.ok(!r.blocked || !/Convention create\.only —/.test(r.reason!), "append is an in-place edit, not a creation");
    } finally { append.cleanup(); }
  } finally { a.cleanup(); b.cleanup(); }
});

test("review3#4: a timestamp-preserving rewrite of an ignored source file is detected", () => {
  const x = sandbox();
  try {
    writeFileSync(join(x.cwd, ".gitignore"), "src/generated/\n");
    mkdirSync(join(x.cwd, "src/generated/domain"), { recursive: true });
    const f = join(x.cwd, "src/generated/domain/a.ts");
    writeFileSync(f, "AAAA\n");
    execFileSync("git", ["add", ".gitignore"], { cwd: x.cwd }); execFileSync("git", ["commit", "-qm", "ignore"], { cwd: x.cwd });
    x.start("Update pricing");
    const { mtime, atime } = statSync(f);
    x.tool("bash", { command: "node scripts/gen.mjs" }, () => { writeFileSync(f, "BBBB\n"); utimesSync(f, atime, mtime); });
    assert.match(x.delivered.filter(d => d.channel.startsWith("tool_result:")).map(d => d.text).join("\n"), /Changed file src\/generated\/domain\/a\.ts/);
  } finally { x.cleanup(); }
});

test("review3#5: path tokens without short extensions are still paths", () => {
  for (const text of ["src/pricing/integration/README", "src/pricing/integration/foo.typescript", "src/pricing/integration/foo.ts#L10",
    "pricing/integration/tax-rates.ts:12", "a/b/integration/c"])
    assert.equal(termMatches(text, "integration/"), false, text);
  assert.equal(termMatches("red/green/refactor", "green"), true);
  assert.equal(termMatches("rebase onto integration/feature-tax", "integration/"), true);
});
