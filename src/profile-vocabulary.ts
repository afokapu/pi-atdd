// PLT-84: the closed structure-profile key vocabulary (profiles/vocabulary.yaml).
// A stack-neutral convention core may only reference keys that this module accepts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export const PROFILE_GROUPS = ["roles", "roots", "layout", "suffix", "urn", "idiom", "enforcement", "tooling"] as const;
export type ProfileGroup = typeof PROFILE_GROUPS[number];
export type VocabularyKey = { key: string; group: ProfileGroup; type: string; doc: string; example?: string };
export type Vocabulary = {
  schema: string; version: number;
  groups: Record<ProfileGroup, { doc: string; params?: Record<string, string[]>; keys: Record<string, { type: string; doc: string; example?: string }> }>;
};

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const VOCABULARY_PATH = join(ROOT, "profiles", "vocabulary.yaml");

export function loadVocabulary(path = VOCABULARY_PATH): Vocabulary {
  const v = parse(readFileSync(path, "utf8")) as Vocabulary;
  const groups = Object.keys(v.groups ?? {});
  if (groups.join() !== PROFILE_GROUPS.join()) throw new Error("vocabulary groups must be exactly " + PROFILE_GROUPS.join(", ") + "; got " + groups.join(", "));
  for (const [g, def] of Object.entries(v.groups)) {
    if (!def.doc?.trim()) throw new Error("group " + g + " needs a doc");
    for (const [k, kd] of Object.entries(def.keys)) {
      if (!k.startsWith(g + ".")) throw new Error("key " + k + " must start with " + g + ".");
      if (!kd?.doc?.trim() || !kd.type) throw new Error("key " + k + " needs type and doc");
      for (const p of k.match(/<([a-z_]+)>/g) ?? []) if (!def.params?.[p.slice(1, -1)]?.length) throw new Error("key " + k + " uses undeclared parameter " + p);
    }
  }
  return v;
}

/** Every concrete key, with parametric keys expanded over their declared parameter values. */
export function expandKeys(v: Vocabulary = loadVocabulary()): VocabularyKey[] {
  const out: VocabularyKey[] = [];
  for (const g of PROFILE_GROUPS) {
    const def = v.groups[g];
    for (const [k, kd] of Object.entries(def.keys)) {
      let forms = [k];
      for (const p of k.match(/<([a-z_]+)>/g) ?? []) forms = forms.flatMap(f => def.params![p.slice(1, -1)].map(val => f.replace(p, val)));
      for (const f of forms) out.push({ key: f, group: g, type: kd.type, doc: kd.doc, ...(kd.example ? { example: kd.example } : {}) });
    }
  }
  return out;
}

export function isVocabularyKey(key: string, v: Vocabulary = loadVocabulary()): boolean {
  return expandKeys(v).some(k => k.key === key);
}

/** A proposed key must sit in one of the eight groups, use the key grammar and not exist yet. */
export function proposalProblems(key: string, v: Vocabulary = loadVocabulary()): string[] {
  const problems: string[] = [];
  const group = key.split(".")[0];
  if (!(PROFILE_GROUPS as readonly string[]).includes(group)) problems.push("group must be one of " + PROFILE_GROUPS.join(", "));
  if (!/^[a-z]+(\.[a-z0-9_]+)+$/.test(key)) problems.push("key must match <group>.<name>[.<name>] in snake_case");
  if (isVocabularyKey(key, v)) problems.push("key already exists; use it");
  return problems;
}

/** JSON Schema of a structure-profile file, generated from the vocabulary. */
export function profileSchema(v: Vocabulary = loadVocabulary()) {
  const keys = expandKeys(v);
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://github.com/afokapu/pi-atdd/profiles/profile.schema.json",
    title: "pi-atdd structure profile",
    description: "Generated from profiles/vocabulary.yaml (version " + v.version + "). Do not edit by hand.",
    type: "object",
    required: ["schema", "stack", "values"],
    additionalProperties: false,
    properties: {
      schema: { const: "pi-atdd/structure-profile/v1" },
      stack: { type: "string", pattern: "^[a-z0-9-]+$" },
      extends: { type: "string" },
      vocabularyVersion: { const: v.version },
      values: {
        type: "object", additionalProperties: false,
        properties: Object.fromEntries(keys.map(k => [k.key, {
          description: k.doc,
          ...(k.type === "list" ? { type: "array", items: { type: "string" } } : { type: "string" }),
        }])),
      },
    },
  };
}
