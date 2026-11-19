/**
 * Classify the exploratory weak-model Pi/JJ pair without mistaking a green CI
 * harness or JSON-shaped assistant text for actual agent tool execution.
 * This is deliberately NOT the evaluator-owned D008 effectiveness protocol.
 */
export type PiExecutionEvents = { started: number; finished: number };
export type SmokeSummary = {
  model: string;
  baselineAcceptanceRed: boolean;
  coder: { exit: number; acceptanceExit: number };
  reviewer: { exit: number };
  jj: { exactDriverParent: boolean; staleHeadDetected: boolean; mainUnchanged: boolean; originalIntegrationHead: string };
};
export type SmokeEvidence = {
  summary: SmokeSummary;
  coderEvents: PiExecutionEvents;
  reviewerEvents: PiExecutionEvents;
  sourceChanged: boolean;
};
export type SmokeVerdict = {
  schema: "pi-atdd/pilot-validity/v1";
  scope: "exploratory-pi-jj-smoke-not-D008";
  status: "INVALID_HARNESS" | "UNQUALIFIED_TOOL_USE" | "TOOL_USE_OBSERVED";
  d008: "NOT_ESTABLISHED";
  toolUseQualified: boolean;
  reasons: string[];
  graph: { coder: PiExecutionEvents; reviewer: PiExecutionEvents; sourceChanged: boolean; acceptanceExit: number };
  baseline: { coder: PiExecutionEvents; reviewer: PiExecutionEvents; sourceChanged: boolean; acceptanceExit: number };
};

/** Count ONLY top-level Pi runtime tool execution events, never text or model tool intentions. */
export function inspectPiJsonl(raw: string): PiExecutionEvents {
  let started = 0;
  let finished = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: unknown;
    try { event = JSON.parse(line); } catch { continue; }
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;
    if ((event as { type?: unknown }).type === "tool_execution_start") started++;
    if ((event as { type?: unknown }).type === "tool_execution_end") finished++;
  }
  return { started, finished };
}

/** A model-run pair is unqualified if either condition never executes real Pi tools. */
export function assessPilotPair(graph: SmokeEvidence, baseline: SmokeEvidence): SmokeVerdict {
  const reasons: string[] = [];
  for (const [label, trial] of [["graph", graph], ["baseline", baseline]] as const) {
    if (!trial.summary?.model || !trial.summary.baselineAcceptanceRed ||
        trial.summary.coder?.exit !== 0 || trial.summary.reviewer?.exit !== 0 ||
        !trial.summary.jj?.exactDriverParent || !trial.summary.jj.staleHeadDetected ||
        !trial.summary.jj.mainUnchanged) {
      reasons.push(label + ": fixture, subprocess, or JJ harness prerequisite failed");
    }
  }
  if (graph.summary.model !== baseline.summary.model) reasons.push("Different models were used across conditions");
  const harnessValid = reasons.length === 0;
  const toolUseQualified = [graph, baseline].every(trial =>
    trial.coderEvents.started > 0 && trial.coderEvents.finished > 0 &&
    trial.reviewerEvents.started > 0 && trial.reviewerEvents.finished > 0);
  if (!toolUseQualified) for (const [label, trial] of [["graph", graph], ["baseline", baseline]] as const) {
    if (trial.coderEvents.started === 0 || trial.coderEvents.finished === 0) reasons.push(label + ": no completed Pi coder tool execution");
    if (trial.reviewerEvents.started === 0 || trial.reviewerEvents.finished === 0) reasons.push(label + ": no completed Pi reviewer tool execution");
  }
  if (graph.summary.jj.originalIntegrationHead !== baseline.summary.jj.originalIntegrationHead) {
    reasons.push("Smoke workspaces have different seed commit IDs; no exact-base D008 comparison");
  }
  reasons.push("Missing D008 independently authenticated manifest, matched trials, weak/strong tiers, and blind semantic review");
  return {
    schema: "pi-atdd/pilot-validity/v1", scope: "exploratory-pi-jj-smoke-not-D008",
    status: !harnessValid ? "INVALID_HARNESS" : !toolUseQualified ? "UNQUALIFIED_TOOL_USE" : "TOOL_USE_OBSERVED",
    d008: "NOT_ESTABLISHED", toolUseQualified: harnessValid && toolUseQualified, reasons,
    graph: { coder: graph.coderEvents, reviewer: graph.reviewerEvents, sourceChanged: graph.sourceChanged, acceptanceExit: graph.summary.coder.acceptanceExit },
    baseline: { coder: baseline.coderEvents, reviewer: baseline.reviewerEvents, sourceChanged: baseline.sourceChanged, acceptanceExit: baseline.summary.coder.acceptanceExit },
  };
}
