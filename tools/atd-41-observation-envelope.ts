/**
 * Historical ATD-41 snapshot-only proposal for ATD-39.
 * It does NOT receive actual Pi runtime events or track source retractions.
 * The live internal evidence seam is src/pi-observation-feed.ts (and the
 * matching ATD-41/ATD-40 evidence handoff tests); do not promote this older
 * one-shot projection into a second matcher or authoritative SDK.
 * Never persist source-bearing proofs to sanitized telemetry.
 */
import type { ContextObservation, Reconciliation } from "../src/reasoning-context.ts";

export type ObservationEnvelope = {
  schema: "pi-atdd/observation-envelope/proposal-v1";
  event: {
    id: string; scope: string; origin: ContextObservation["origin"];
    operation: ContextObservation["operation"]; provenance: string;
    repositoryRevision: string | null;
    targetHint: string | null;
  };
  observed: Array<{
    kind: string; value: string; evidenceId: string; origin: string; provenance: string | null;
  }>;
  missing: Reconciliation["missingReasons"];
  receipts: Array<{
    conventionId: string; sourceId: string; sourceDigest: string | null;
    mandatoryRequires: string[]; proof: Reconciliation["activations"][number]["proof"];
  }>;
  gaps: string[];
  disposition: "observation_only_no_authority";
};

/** The caller supplies an actual event ID; a task string or model claim is not an event identity. */
export function observationEnvelope(eventId: string, input: ContextObservation, result: Reconciliation): ObservationEnvelope {
  if (!eventId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(eventId))
    throw new Error("observation envelope requires a caller-supplied event identifier");
  if (input.scope !== result.scope) throw new Error("observation envelope scope mismatch");
  return {
    schema: "pi-atdd/observation-envelope/proposal-v1",
    event: {
      id: eventId, scope: input.scope, origin: input.origin, operation: input.operation,
      provenance: input.provenance, repositoryRevision: input.revision ?? null,
      targetHint: input.path ?? null,
    },
    observed: result.observedFacts.map(f => ({
      kind: f.predicate, value: f.args[1]!, evidenceId: f.id, origin: f.source,
      provenance: f.provenance ?? null,
    })),
    missing: [...result.missingReasons],
    receipts: result.activations.map(a => ({
      conventionId: a.id, sourceId: a.convention.source,
      sourceDigest: result.provenance.find(p => p.id === a.convention.source)?.digest ?? null,
      mandatoryRequires: a.requiredPath.map(e => e.source + " requires " + e.target),
      proof: a.proof,
    })),
    gaps: [...new Set([
      ...result.gaps.map(g => "missing_mandatory:" + g.missingId),
      ...result.unknownFacts.map(f => "unknown_fact:" + f),
    ])].sort(),
    disposition: "observation_only_no_authority",
  };
}
