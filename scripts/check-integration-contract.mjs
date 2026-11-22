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
  "feature/atd-29-pass-a-semantic-completion": {
    wrapper: "ATD-26", source: "ATD-26", other: ["ATD-29", "ATD-28", "ATD-27", "ATD-39"],
    criteria: [], // Original 4+4+4+8 gate rows are required below, not just the Pass A wrapper.
    issueCriteria: {
      "ATD-29": ["Acceptance-01", "Acceptance-02", "Acceptance-03", "Acceptance-04"],
      "ATD-28": ["Acceptance-01", "Acceptance-02", "Acceptance-03", "Acceptance-04"],
      "ATD-27": ["Acceptance-01", "Acceptance-02", "Acceptance-03", "Acceptance-04"],
      "ATD-26": [
        "Acceptance-01", "Acceptance-02", "Acceptance-03", "Acceptance-04",
        "Acceptance-05", "Acceptance-06", "Acceptance-07", "Acceptance-08",
      ],
    },
  },
  "feature/atd-39-register-atd-26-review-intake": {
    wrapper: "ATD-39", source: "ATD-39", other: ["ATD-26", "ATD-29"],
    criteria: [], // Coordinator CI policy only; never an original-issue completion claim.
  },
  "feature/atd-41-structural-activation": {
    wrapper: "ATD-41", source: "ATD-22", other: ["ATD-25", "ATD-30", "ATD-39"],
    criteria: ["OBS-001", "OBS-002", "OBS-003", "OBS-004"],
  },
  "feature/atd-39-reconcile-trusted-phase": {
    wrapper: "ATD-39", source: "ATD-42", other: ["ATD-41"],
    criteria: [], // Coordinator-only conflict resolution; not an original issue completion.
  },
  "sync/atd-39-main-3007c139": {
    wrapper: "ATD-39", source: "ATD-39", other: [],
    criteria: [], // Exact-main-revision sync: review applicable changes, not ATD-22/29 criteria.
  },
  "feature/atd-42-trusted-phase-activation": {
    wrapper: "ATD-42", source: "ATD-42", other: ["ATD-39"],
    criteria: [], // Pi-only phase slice; the broad cross-repo Coach gate remains separately pending.
  },
};

export function inspectIntegrationPR({base, head, body = ""}) {
  const problems = [];
  const evidence = [];
  const outstanding = [];
  if (base !== BASE) problems.push("Unexpected PR base: " + base);
  const stream = STREAMS[head];
  if (!stream) return {status: "INCOMPLETE", problems: [...problems, "Unexpected stream branch: " + head], evidence};
  for (const ref of [stream.wrapper, stream.source, ...stream.other]) {
    if (!new RegExp("\\b" + ref + "\\b", "i").test(body))
      problems.push("Missing issue reference " + ref);
  }
  // Multi-issue work must disclose every original acceptance, not only a
  // delivery wrapper or just whichever issue makes the current PR look green.
  // Existing single-issue streams keep their original strict source contract.
  const required = stream.issueCriteria
    ? Object.entries(stream.issueCriteria).flatMap(([issue, criteria]) =>
      criteria.map(acceptance => issue + "/" + acceptance))
    : stream.criteria.map(acceptance => stream.source + "/" + acceptance);
  for (const id of required) {
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
    if (disposition !== "PASS") outstanding.push(id + " = " + disposition);
  }
  return {
    status: problems.length ? "INCOMPLETE" : outstanding.length ? "DISCLOSED_PARTIAL" : required.length ? "SELF_DECLARED_COMPLETE" : "SCOPE_REVIEW_ONLY",
    problems, evidence, outstanding,
    caution: "An integration checkpoint can carry explicit partial criteria. This does NOT close the original issue or prove behavior. Only source-verified applicable conventions, independent tests, review, and owner authority can govern acceptance.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = inspectIntegrationPR({
    base: process.env.PR_BASE_REF || "",
    head: process.env.PR_HEAD_REF || "",
    body: process.env.PR_BODY || "",
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.status === "INCOMPLETE") process.exitCode = 1;
}
