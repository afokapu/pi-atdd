// PLT-103: runtime resolution of the legacy surfaces the vocabulary rename changed (URN schemes, field keys,
// detector refs, moved folders), and the sunset transition of the advisory legacy-vocabulary convention.
// The maps are the data in conventions/aliases.json; every function returns the input unchanged when it is not a legacy name.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

// Local, not imported from catalog.ts: catalog.ts imports these helpers, so importing back would be a cycle.
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const LEGACY_TERMS_TABLE = join(packageRoot, "conventions/legacy-terms.yaml");

type AliasDoc = {
  movedPaths: Record<string, string>;
  vocabulary: { urnSchemes: Record<string, string>; fieldKeys: Record<string, string>; detectorRefs: Record<string, string> };
};

let cached: AliasDoc | undefined;
function aliasDoc(): AliasDoc {
  cached ??= JSON.parse(readFileSync(join(packageRoot, "conventions/aliases.json"), "utf8")) as AliasDoc;
  return cached;
}
function lookup(map: Record<string, string>, key: string): string {
  return Object.hasOwn(map, key) ? map[key]! : key;
}

/** URN scheme: `train:` -> `user-system-flow:` (the owner table). A current scheme resolves to itself. */
export function resolveUrnScheme(scheme: string): string {
  return lookup(aliasDoc().vocabulary.urnSchemes, scheme);
}

/** Field key: `interlockingId` -> `flowRouterId`, `wagon` -> `capability`. A current key resolves to itself. */
export function resolveFieldKey(key: string): string {
  return lookup(aliasDoc().vocabulary.fieldKeys, key);
}

/** Detector ref: the upstream atdd-bun name (old) -> the name this repository ships (new). */
export function resolveDetectorRef(ref: string): string {
  return lookup(aliasDoc().vocabulary.detectorRefs, ref);
}

/** The upstream atdd-bun detector name for a shipped (new) detector ref, so the link to upstream stays traceable. */
export function upstreamDetectorRef(ref: string): string {
  const hit = Object.entries(aliasDoc().vocabulary.detectorRefs).find(([, current]) => current === ref);
  return hit ? hit[0] : ref;
}

/** Folder: an old convention path -> the moved path. */
export function resolveMovedPath(path: string): string {
  return lookup(aliasDoc().movedPaths, path);
}

/** True when the path is a current (new) location of a moved file, so it is the form a caller may already hold. */
export function isCurrentMovedPath(path: string): boolean {
  return Object.values(aliasDoc().movedPaths).includes(path);
}

/** True when the scheme is a current URN scheme (a value of the mapping table). */
export function isCurrentUrnScheme(scheme: string): boolean {
  return Object.values(aliasDoc().vocabulary.urnSchemes).includes(scheme);
}

/** True when the key is a current field key (a value of the mapping table). */
export function isCurrentFieldKey(key: string): boolean {
  return Object.values(aliasDoc().vocabulary.fieldKeys).includes(key);
}

/** Sunset of the advisory legacy-vocabulary convention: advisory (warning) until 60 days after the release date,
 * strict from then on. No release date yet (null) means advisory. */
export const LEGACY_TERMS_SUNSET_DAYS = 60;
/** The release date that starts the sunset, from conventions/legacy-terms.yaml (`sunset.date`, null until the owner sets it). */
export function legacySunsetRelease(path = LEGACY_TERMS_TABLE): string | null {
  const table = parse(readFileSync(path, "utf8")) as { sunset?: { date?: unknown } };
  const date = table.sunset?.date;
  if (date === null || date === undefined) return null;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error("legacy-terms.yaml sunset.date must be YYYY-MM-DD or null");
  return date;
}

export function legacyTermsPhase(input: { release: string | null; today: string }): "advisory" | "strict" {
  if (input.release === null) return "advisory";
  const days = (Date.parse(input.today) - Date.parse(input.release)) / 86_400_000;
  if (!Number.isFinite(days)) throw new Error("legacyTermsPhase: invalid date");
  return days >= LEGACY_TERMS_SUNSET_DAYS ? "strict" : "advisory";
}
