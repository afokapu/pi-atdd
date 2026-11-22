/**
 * ATD-22 OBS-004: run a real, bounded source validator over source supplied by
 * the repository observer. This is not a parser for untrusted shell output.
 * A finding receipt is tied to both the observed HEAD and exact source bytes.
 */
import { createHash } from "node:crypto";
import type { DetectorFinding } from "./reasoning-context.ts";
import { classifyFileKind, observeDomainImports } from "./operational-observers.ts";

export const IMPORT_BOUNDARY_DETECTOR = "pi-atdd.ts-import-boundary.v1";
export type ImportValidation = {
  detectorId: typeof IMPORT_BOUNDARY_DETECTOR;
  file: string; revision: string | null; sourceDigest: string | null;
  status: "finding" | "clean" | "unknown";
  findings: readonly DetectorFinding[];
  missingReasons: readonly string[];
};

/** The repository revision is a real Git/JJ object identity, not task text. */
function validRevision(value: string | undefined): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(value);
}

/** Source-level validation is distinct from a before/after change observer.
 * A prior snapshot is not needed to detect a current forbidden dependency.
 */
export function validateImportBoundary(file: string, sourceText?: string,
  revision?: string): ImportValidation {
  const sourceDigest = sourceText === undefined ? null :
    createHash("sha256").update(sourceText).digest("hex");
  const base = {
    detectorId: IMPORT_BOUNDARY_DETECTOR, file,
    revision: validRevision(revision) ? revision : null, sourceDigest,
  };
  const unknown = (reasons: string[]): ImportValidation =>
    ({...base, status:"unknown", findings:[], missingReasons:reasons});
  if (!validRevision(revision)) return unknown(["revision_unavailable_or_unverified"]);
  if (sourceText === undefined) return unknown(["source_unavailable"]);
  const kind = classifyFileKind(file,sourceText);
  if (kind.status === "unknown") return unknown([kind.reason]);
  if (kind.kind !== "source")
    return {...base,status:"clean",findings:[],missingReasons:[]};
  const observation = observeDomainImports(file,sourceText);
  // A post-tool validator knows it read the current file. The absence of the
  // pre-edit source is not an unknown for this source-level validation.
  const missingReasons = observation.unknownReasons.filter(x=>x!=="prior_source_unavailable");
  if (!observation.sourceObserved) return unknown(["source_not_observed",...missingReasons]);
  const findings: DetectorFinding[] = observation.present ? [{
    code:"domain_to_integration_import",
    detectorId:IMPORT_BOUNDARY_DETECTOR,
    evidenceId:"sha:"+createHash("sha256").update(file).update("\0")
      .update(sourceText).update("\0").update(revision).digest("hex"),
    file,revision,
  }] : [];
  return {...base, status: findings.length ? "finding" : missingReasons.length ? "unknown" : "clean",
    findings, missingReasons};
}
