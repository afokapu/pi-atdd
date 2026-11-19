// PLT-84: render a stack-neutral convention record for the active stack.
// Stage 1 implements only stack=bun: the Bun realization IS the frozen 0.2.0 sidecar (pinned by SHA-256),
// delivered verbatim. Other stacks (core + profile + Bun reference example) come in stage 2.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const NEUTRAL_DIR = join(ROOT, "conventions-neutral");

/** Sidecar fields whose reader is the agent (conventions-sidecar/README.md, "Format"). */
export const AGENT_FIELDS = ["title", "given", "when", "then", "prefer", "avoid", "unless", "why"] as const;

export type NeutralRecord = {
  schema: "pi-atdd/neutral-convention/v0"; rule_id: string; legacyId: string;
  core: Record<string, unknown>;
  profileRequirements: { key: string; meaning: string; bunValue: string }[];
  proposedKeys: unknown[]; bunOnly: unknown[]; classification: unknown[];
  realizations: { bun: { sidecar: string; sha256: string } };
  audit: Record<string, unknown>;
};

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

export function loadNeutralRecords(dir = NEUTRAL_DIR): NeutralRecord[] {
  const out: NeutralRecord[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith(".json")) out.push(JSON.parse(readFileSync(p, "utf8"))); } };
  walk(dir);
  return out;
}

/** Load the Bun realization and refuse it unless its bytes match the pinned digest. */
export function bunRealization(rec: NeutralRecord, root = ROOT): Record<string, unknown> {
  const bytes = readFileSync(join(root, rec.realizations.bun.sidecar));
  if (sha(bytes) !== rec.realizations.bun.sha256) throw new Error(rec.rule_id + ": Bun realization differs from its pinned 0.2.0 sidecar");
  return JSON.parse(bytes.toString("utf8"));
}

/** Deterministic agent-facing text of a sidecar rewrite. */
export function renderSidecar(s: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const f of AGENT_FIELDS) {
    const v = s[f];
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) continue;
    const label = f[0].toUpperCase() + f.slice(1);
    if (Array.isArray(v)) { lines.push(label + ":"); for (const x of v) lines.push("- " + String(x)); }
    else lines.push(label + ": " + String(v));
  }
  return lines.join("\n") + "\n";
}

export type Rendered = { rule_id: string; stack: string; realization: "curated"; text: string };

export function renderForStack(rec: NeutralRecord, stack: string, root = ROOT): Rendered {
  if (stack !== "bun") throw new Error("PLT-84 stage 1 renders stack=bun only; " + stack + " needs the stage-2 renderer");
  return { rule_id: rec.rule_id, stack, realization: "curated", text: renderSidecar(bunRealization(rec, root)) };
}
