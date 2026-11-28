// URN: test:pi-atdd:route-attention:atd-54-a01
// Acceptance: acc:pi-atdd:atd-54-a01
// Acceptance: acc:pi-atdd:atd-54-a02
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAttentionStrip } from "../../../../../src/attention-strip.ts";

const types = ["decision", "grant", "review", "intervention"] as const;
const markers = new Map([["decision", "🧑"], ["grant", "🧑"], ["review", "🤖"], ["intervention", "🤖"]]);

test("ATD-54 Acceptance-01/02: actor markers prefix each item in the strip and list", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-atdd-attention-emoji-"));
  try {
    const handlers = new Map<string, Function[]>();
    const tools = new Map<string, any>();
    const widgets = new Map<string, string[]>();
    const entries: any[] = [];
    const intervals: Array<{ fn: Function; ms: number }> = [];
    const env = (role: "worker" | "coach"): NodeJS.ProcessEnv => ({
      PI_CODING_AGENT_DIR: agentDir,
      PI_ATDD_ATTENTION_ROLE: role,
      PI_ATDD_ATTENTION_IDENTITY: role === "worker" ? "worker-atd-54" : "Coach - pi-atdd",
      PI_ATDD_ATTENTION_PROFILE: "forge",
    });
    const start = (role: "worker" | "coach") => {
      const pi = {
        on: (name: string, fn: Function) => handlers.set(name, [...handlers.get(name) ?? [], fn]),
        registerTool: (tool: any) => tools.set(`${role}:${tool.name}`, tool),
        registerCommand: () => {}, appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
        sendMessage: () => {},
      };
      const ctx = {
        isProjectTrusted: () => true, hasUI: true,
        sessionManager: { getBranch: () => entries, getEntries: () => entries },
        ui: { setWidget: (_key: string, lines: string[] | undefined) => { if (lines) widgets.set(role, lines); }, notify: () => {} },
      };
      registerAttentionStrip(pi as any, { env: env(role), pollMs: 5000,
        setInterval: (fn: Function, ms: number) => { intervals.push({ fn, ms }); return fn; },
        clearInterval: () => {},
      });
      return ctx;
    };
    const workerCtx = start("worker");
    const coachCtx = start("coach");
    const raised = new Map<string, string>();
    for (const type of types) {
      const result = await tools.get("worker:attention_raise").execute("call", { type, summary: `needs ${type}` }, undefined, undefined, workerCtx);
      raised.set(type, result.details.item.id);
    }
    for (const fn of handlers.get("session_start") ?? []) await fn({ reason: "startup" }, coachCtx);

    for (const type of types) {
      const marker = markers.get(type)!;
      const id = raised.get(type)!;
      assert.ok(widgets.get("coach")?.some(line => line.includes(id) && line.startsWith(marker)), `strip ${type} starts with ${marker}`);
    }
    const listing = await tools.get("coach:attention_list").execute("call", {}, undefined, undefined, coachCtx);
    const text = listing.content[0].text as string;
    for (const type of types) {
      const marker = markers.get(type)!;
      const id = raised.get(type)!;
      assert.ok(text.split("\n").some(line => line.startsWith(marker) && line.includes(id)), `list ${type} starts with ${marker}`);
    }
  } finally { rmSync(agentDir, { recursive: true, force: true }); }
});
