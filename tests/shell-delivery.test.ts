// PLT-79 prerequisite 1: graph delivery for shell edits, word-boundary selector
// terms and a post-tool page budget that keeps the target rule.
// Reproduces the PLT-78 trial t10 miss: claude-opus-5-5 wrote
// src/pricing/domain/quote.ts through a bash heredoc, the pre-edit hook never
// fired, and the post-tool page (4,500 chars) emitted only
// atdd-workflow.workflow.lifecycle (activated by the substring `integration/`),
// never coder.bun.design-hierarchy-import.
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import atdd from "../extensions/atdd.ts";

const TARGET = "coder.bun.design-hierarchy-import";
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
    assert.ok(!page.includes("Convention atdd-workflow.workflow.lifecycle —"), "`integration/` inside a source path is not an integration branch");
    assert.ok(!page.includes("Convention coder.bun.phase-discipline —"), "`red` inside `configured` is not the RED phase");
  } finally { x.cleanup(); }
  const y = sandbox();
  try {
    const page = y.start("Rebase onto integration/feature-tax, then make the red test green")!;
    assert.ok(page.includes("Convention atdd-workflow.workflow.lifecycle —"));
    assert.ok(page.includes("Convention coder.bun.phase-discipline —"));
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
    if (/omitted by budget/.test(text)) assert.ok(!/omitted[^\n]*design-hierarchy-import/.test(text));
  } finally { x.cleanup(); }
});
