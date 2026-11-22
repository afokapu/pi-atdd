import {pathToFileURL} from "node:url";

/**
 * ATD-39 integration-intake lint. Never treats claimed PASS as semantic proof.
 * Original Linear issue acceptance always outranks wrapper issue checklists.
 */
const BASE = "integration/atd-39-ooc-activation";
const STREAMS = {
  "feature/atd-40-ooc-governance-contract": {
    wrapper: "ATD-40", source: "ATD-29", other: ["ATD-26", "ATD-39"],
    criteria: ["Acceptance-01", "Acceptance-02", "Acceptance-03", "Acceptance-04"],
  },
  "feature/atd-41-structural-activation": {
    wrapper: "ATD-41", source: "ATD-22", other: ["ATD-25", "ATD-30", "ATD-39"],
    criteria: ["OBS-001", "OBS-002", "OBS-003", "OBS-004"],
  },
};

export function inspectIntegrationPR({base, head, body = ""}) {
  const problems = [];
  const evidence = [];
  if (base !== BASE) problems.push("Unexpected PR base: " + base);
  const stream = STREAMS[head];
  if (!stream) return {status: "INCOMPLETE", problems: [...problems, "Unexpected stream branch: " + head], evidence};
  for (const ref of [stream.wrapper, stream.source, ...stream.other]) {
    if (!new RegExp("\\b" + ref + "\\b", "i").test(body))
      problems.push("Missing issue reference " + ref);
  }
  for (const acceptance of stream.criteria) {
    const id = stream.source + "/" + acceptance;
    const prefix = new RegExp("^\\s*[-*]\\s+(?:\\[[ xX]\\]\\s*)?" + id + "\\s*:", "i");
    const row = body.split(/\r?\n/).find(line => prefix.test(line));
    if (!row) { problems.push("Missing original criterion " + id); continue; }
    const detail = row.slice(row.indexOf(":") + 1).trim();
    const disposition = /^(PASS|PARTIAL|UNVERIFIED|FAIL)\b/i.exec(detail)?.[1]?.toUpperCase();
    if (!disposition) { problems.push("Missing disposition for " + id); continue; }
    if (!/\b(?:evidence|gap|reason)\s*:\s*\S/i.test(detail)) {
      problems.push("Missing evidence, gap or reason for " + id);
      continue;
    }
    evidence.push({id, disposition});
    if (disposition !== "PASS") problems.push("Original acceptance not complete: " + id + " = " + disposition);
  }
  return {
    status: problems.length ? "INCOMPLETE" : "SELF_DECLARED_COMPLETE",
    problems, evidence,
    caution: "Self-declared completeness does not verify evidence. Independent tests, source-issue acceptance, reviewer sign-off and owner authority remain mandatory.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = inspectIntegrationPR({
    base: process.env.PR_BASE_REF || "",
    head: process.env.PR_HEAD_REF || "",
    body: process.env.PR_BODY || "",
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.status !== "SELF_DECLARED_COMPLETE") process.exitCode = 1;
}
