// PLT-84: render a stack-neutral convention record for the active stack.
// Stage 1 implements only stack=bun: the Bun realization IS the frozen 0.2.0 sidecar, or one part of a frozen split
// (the split file pinned by SHA-256), delivered verbatim. Other stacks (core + profile + Bun reference example) come in stage 2.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StructureProfile } from "./profile.ts";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const NEUTRAL_DIR = join(ROOT, "conventions-neutral");

/** Sidecar fields whose reader is the agent (conventions-sidecar/README.md, "Format"). */
export const AGENT_FIELDS = ["title", "given", "when", "then", "prefer", "avoid", "unless", "why"] as const;

export type NeutralRecord = {
  schema: "pi-atdd/neutral-convention/v0"; rule_id: string; legacyId: string;
  core: Record<string, unknown>;
  profileRequirements: { key: string; meaning: string; bunValue: string }[];
  proposedKeys: unknown[]; bunOnly: unknown[]; classification: unknown[];
  realizations: { bun: { sidecar: string; sha256: string; part?: string } };
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
  const doc = JSON.parse(bytes.toString("utf8"));
  if (!rec.realizations.bun.part) return doc;
  const part = doc.parts?.find((p: any) => p.rule_id === rec.realizations.bun.part);
  if (!part) throw new Error(rec.rule_id + ": part " + rec.realizations.bun.part + " missing from its pinned split");
  return part;
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

export type Rendered = { rule_id: string; stack: string; realization: "curated" | "agent-derived (unverified)"; text: string };
export type RenderOptions = { profile?: StructureProfile; bunReference?: boolean; root?: string };
const isBun = (stack: string) => stack === "bun" || stack === "atdd-bun";
const show = (v: unknown) => Array.isArray(v) ? v.join(", ") : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);

/** The profile's value for a requirement key; `<map key>#<entry>` reads an entry of a map value. */
function profileValue(p: StructureProfile, key: string): unknown {
  const [base, entry] = key.split("#");
  const v = p.values[base];
  return entry === undefined ? v : (v as Record<string, unknown> | undefined)?.[entry];
}

/**
 * stack=bun: the frozen 0.2.0 realization, verbatim (SN-001). Any other stack: the core (authoritative), the stack's
 * profile values, and the Bun realization as a labelled reference example (SN-004), unless the stack has a curated
 * realization of its own. `bunReference: false` drops the example (arm b of the second-stack experiment).
 */
export function renderForStack(rec: NeutralRecord, stack: string, opts: RenderOptions = {}): Rendered {
  const root = opts.root ?? ROOT;
  if (isBun(stack)) return { rule_id: rec.rule_id, stack, realization: "curated", text: renderSidecar(bunRealization(rec, root)) };
  const profile = opts.profile;
  if (!profile) throw new Error("rendering for stack " + stack + " needs its structure profile");
  if (profile.stack !== stack) throw new Error("profile " + profile.stack + " is not the profile of stack " + stack);
  const core = rec.core as Record<string, unknown>;
  const lines = ["Realization: agent-derived (unverified) — no curated realization exists for stack " + stack + "; derive it from the core, the profile and the example, and let the reviewer verify it.",
    "", "Core obligation (authoritative):", renderSidecar(core).trimEnd()];
  const ver = (core.verification as string[] | undefined) ?? [];
  if (ver.length) lines.push("Verification:", ...ver.map(x => "- " + x));
  const have: string[] = [], missing: string[] = [];
  for (const r of rec.profileRequirements) {
    const v = profileValue(profile, r.key);
    (v === undefined ? missing : have).push(v === undefined ? r.key : r.key + ": " + show(v));
  }
  lines.push("", "Profile values for " + stack + ":", ...(have.length ? have.map(x => "- " + x) : ["- (none)"]));
  if (missing.length) lines.push("Keys without a value in the " + stack + " profile (derive from the codebase): " + missing.join(", "));
  if (opts.bunReference !== false) {
    lines.push("", "Reference implementation in ATDD-Bun — translate to this stack; the core obligation is authoritative, not the Bun specifics:",
      renderSidecar(bunRealization(rec, root)).trimEnd());
    const only = rec.bunOnly as { item: string; text: string; reason: string }[];
    if (only.length) lines.push("", "Bun-only context (not an obligation on this stack):", ...only.map(b => "- " + b.text + " (" + b.reason + ")"));
  }
  return { rule_id: rec.rule_id, stack, realization: "agent-derived (unverified)", text: lines.join("\n") + "\n" };
}
