// Visual report of the lossless-move fleet runs -> ../fleet-report.html
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FLEET } from "./lib.mjs";

const esc = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const J = (p) => JSON.parse(readFileSync(p, "utf8"));
const RUNS = join(FLEET, "runs");
const ids = readdirSync(RUNS).filter(d => existsSync(join(RUNS, d, "result.json"))).sort();
const COLORS = { coder: "#5ad19a", verifier: "#f78c6c", shared: "#7cc4ff", activation: "#c792ea", audit: "#6b7280", structure: "#3a4253", dropped: "#ff6b6b", identity: "#ffd166" };
const bucket = (d) => /^(given|when|then|why|prefer|avoid|unless)/.test(d) ? "coder" : /^(evidence|verifier_detail)/.test(d) ? "verifier"
  : d.startsWith("shared:") ? "shared" : d === "activation" ? "activation" : d === "audit" ? "audit" : d === "structure" ? "structure" : d === "dropped" ? "dropped" : "identity";
const OKS = ["PRESERVED", "COMPRESSED_OK", "DROP_JUSTIFIED"];

const rows = ids.map(id => {
  const d = join(RUNS, id), r = J(join(d, "result.json")), a = existsSync(join(d, "author.json")) ? J(join(d, "author.json")) : existsSync(join(d, "author-prev.json")) ? { ...J(join(d, "author-prev.json")), title: "[final round wrote no author.json — showing previous round] " + (J(join(d, "author-prev.json")).title ?? "") } : { title: "(no author output)", trace: [], prefer: [], avoid: [], unless: [], evidence: [], verifier_detail: [], sharedNodes: [], additions: [] }, segs = J(join(d, "segments.json")).segments;
  const audit = existsSync(join(d, "audit.json")) ? J(join(d, "audit.json")) : null;
  const aud = new Map((audit?.segments ?? []).map(s => [s.seg, s]));
  const tr = new Map(a.trace.map(t => [t.seg, Array.isArray(t.dest) ? t.dest : [t.dest]]));
  const counts = {}; for (const s of segs) { const ds = tr.get(s.id) ?? [s.autoDest ?? "audit"]; const b = bucket(ds[0]); counts[b] = (counts[b] ?? 0) + 1; }
  const review = existsSync(join(d, "review.json")) ? J(join(d, "review.json")) : null;
  return { id, r, a, segs, audit, aud, tr, counts, review };
});

const bar = (counts, total) => `<div class="stack">${Object.entries(COLORS).filter(([k]) => counts[k]).map(([k, c]) =>
  `<div title="${k}: ${counts[k]}" style="width:${100 * counts[k] / total}%;background:${c}">${counts[k]}</div>`).join("")}</div>`;
const li = (xs) => (xs ?? []).map(x => `<li>${esc(x)}</li>`).join("");

const html = `<!doctype html><html><head><meta charset="utf-8"><title>PLT-81 lossless-move fleet — full catalog</title><style>
body{margin:0;background:#0f1115;color:#e6e8ee;font:14px/1.5 -apple-system,Inter,sans-serif}header,section{padding:20px 36px;border-bottom:1px solid #2a2f3a}
h1{margin:0 0 4px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #2a2f3a;padding:6px 8px;vertical-align:top;text-align:left}th{background:#1d2330}
.PASS{color:#5ad19a;font-weight:700}.FAIL{color:#ff6b6b;font-weight:700}.stack{display:flex;height:22px;border-radius:5px;overflow:hidden;min-width:320px}.stack div{font-size:11px;color:#000;text-align:center;line-height:22px;overflow:hidden}
.legend span{display:inline-block;margin-right:12px}.legend i{display:inline-block;width:12px;height:12px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.sz{display:flex;align-items:center;gap:6px}.sz .b{height:10px;border-radius:3px}
details{background:#171a21;border:1px solid #2a2f3a;border-radius:8px;margin:10px 0;padding:8px 12px}summary{cursor:pointer;font-weight:600}
.card{display:grid;grid-template-columns:1fr 1fr;gap:12px}.box{background:#13201a;border:1px solid #2d6a4f;border-radius:8px;padding:8px 10px}.vbox{background:#201712;border-color:#5a3b2e}.mbox{background:#12151b;border:1px dashed #3a4253}
.k{color:#7cc4ff;font-weight:700}.t{color:#ffd166;font-weight:700}.ok{color:#5ad19a;font-weight:700}.bad{color:#ff6b6b;font-weight:700}
code,.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}.trace td{font-size:12px}.st-bad{background:#4a1f24}.small{color:#9aa3b2;font-size:12px}
</style></head><body>
<header><h1>Lossless-move fleet — full catalog (${rows.length} conventions)</h1>
<p class="small">The pipeline for each convention:</p>
<ol class="small">
<li>A deterministic segmenter splits the canonical YAML into numbered segments.</li>
<li>The <b>author</b> (anthropic/claude-opus-5-5) writes the Gherkin-like convention and assigns every segment a destination.</li>
<li>A <b>mechanical check</b> confirms coverage, the schema, the activation vocabulary and that there is no overfitting.</li>
<li>An <b>independent auditor</b> (openai-codex/gpt-6.1-sol) judges every segment.</li>
<li>Up to 2 rounds are run, followed by a revision pass of up to 2 more rounds for every FAIL. The revision feedback includes the auditor findings, the third-party review and any rule-specific content found in shared nodes. A convention passes only with no LOST, DISTORTED, wrong-reader or unjustified dropped segment, no undeclared addition and no new waiver.</li>
</ol>
<p class="small">Cost of the author and auditor stages: $${rows.reduce((s, x) => s + x.r.cost, 0).toFixed(2)}. Third-party reviews and shared-node dedup are not included. Local proposal, not committed.</p>
${(() => { const pass = rows.filter(x => x.r.status === "PASS").length, rv = rows.filter(x => x.review), agree = rv.filter(x => x.review.agreeWithAuditor).length;
  const OKs = ["PRESERVED", "COMPRESSED_OK", "DROP_JUSTIFIED"]; let tot = 0, bad = 0; rows.forEach(x => (x.audit?.segments ?? []).forEach(s => { tot++; if (!OKs.includes(s.status)) bad++; }));
  const src = rows.reduce((s, x) => s + (x.r.stats.sourceChars || 0), 0), cod = rows.reduce((s, x) => s + (x.r.stats.coderChars || 0), 0);
  const tile = (n, l, c) => `<div style="background:#171a21;border:1px solid #2a2f3a;border-radius:10px;padding:10px 16px;min-width:150px"><div style="font-size:26px;font-weight:700;color:${c}">${n}</div><div class="small">${l}</div></div>`;
  return `<div style="display:flex;gap:12px;flex-wrap:wrap;margin:10px 0">${tile(pass + " / " + rows.length, "conventions passed the lossless audit", "#5ad19a")}${tile(bad + " / " + tot, "segments not preserved (lost, distorted or wrong reader)", "#ff6b6b")}${tile(rows.reduce((s, x) => s + (x.r.stats.dropped || 0), 0), "segments dropped", "#ffd166")}${tile(agree + " / " + rv.length, "third-party reviews that agree with the auditor", "#7cc4ff")}${tile(Math.round(100 * cod / src) + "%", "of source characters sent to the coder", "#c792ea")}</div>`; })()}
<div class="legend">${Object.entries(COLORS).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join("")}</div></header>
<section><h2>Overview</h2><table><tr><th>Convention</th><th>Status</th><th>Rounds</th><th>Where each source segment went</th><th>Size: source YAML vs sent to coder</th><th>Auditor problems left</th><th>Needs a new observer</th><th>3rd-party review (kimi k3.1-pro)</th></tr>
${rows.map(x => { const bad = (x.audit?.segments ?? []).filter(s => !OKS.includes(s.status)); const max = 6500;
  return `<tr><td class="mono"><a href="#${x.id}" style="color:#7cc4ff">${x.id}</a></td><td class="${x.r.status}">${x.r.status}</td><td>${x.r.rounds.length}</td>
<td>${bar(x.counts, x.segs.length)}</td><td><div class="sz"><div class="b" style="width:${180 * x.r.stats.sourceChars / max}px;background:#ff6b6b"></div>${x.r.stats.sourceChars}</div><div class="sz"><div class="b" style="width:${180 * x.r.stats.coderChars / max}px;background:#5ad19a"></div>${x.r.stats.coderChars}</div></td>
<td>${bad.length + (x.audit?.undeclaredAdditions?.length ?? 0) + (x.audit?.waiverCreep?.length ?? 0) + (x.audit?.activation?.status !== "OK" ? 1 : 0)}</td><td class="mono">${[...new Set(x.r.stats.needsNewObserver)].join(", ")}</td><td>${x.review ? `<span class="${x.review.reviewerVerdict}">${x.review.reviewerVerdict}</span> ${x.review.agreeWithAuditor ? "agrees" : "<b class=bad>disagrees</b>"} · usability ${x.review.usability?.score}/5` : "<span class=small>not sampled</span>"}</td></tr>`; }).join("")}
</table></section>
<section><h2>Shared nodes after deduplication</h2><p class="small">Each shared node was merged from every variant by the author model, then the auditor checked that each variant is covered. Content flagged as "not generic" belongs back in its rule.</p>
${readdirSync(join(FLEET, process.env.SHARED_OUT || "../shared")).map(n => { const dd = join(FLEET, process.env.SHARED_OUT || "../shared", n); const c = J(join(dd, "canonical.json")), v = J(join(dd, "variants.json")), au = existsSync(join(dd, "shared-audit.json")) ? J(join(dd, "shared-audit.json")) : {};
  return `<details><summary class="mono">${esc(c.id)} → ${esc(c.proposedId)} · ${v.variants.length} variants · audit <span class="${au.verdict}">${esc(au.verdict)}</span> · ${c.text.length} chars · ${(c.notGeneric ?? []).length} not generic</summary><pre class="mono" style="white-space:pre-wrap">${esc(c.text)}</pre>${(c.notGeneric ?? []).length ? `<b class="bad">Not generic, so it belongs back in the rule:</b><ul>${c.notGeneric.map(g => `<li><code>${esc(g.rule_id)}</code>: ${esc(g.content)}</li>`).join("")}</ul>` : ""}</details>`; }).join("")}</section>
${rows.map(x => { const a = x.a, bad = (x.audit?.segments ?? []).filter(s => !OKS.includes(s.status));
  return `<section id="${x.id}"><h2 class="mono">${x.id} — <span class="${x.r.status}">${x.r.status}</span></h2>
<p>${esc(x.audit?.summary)}</p>${x.review ? `<div class="box" style="background:#1d2330;border-color:#7cc4ff"><b>Third-party review (${esc(x.review.reviewerVerdict)}, ${x.review.agreeWithAuditor ? "agrees with auditor" : "DISAGREES with auditor"}, usability ${x.review.usability?.score}/5)</b><p>${esc(x.review.summary)}</p><ul>${li(x.review.usability?.risks)}</ul></div>` : ""}
${bad.length || x.audit?.undeclaredAdditions?.length || x.audit?.activation?.status !== "OK" ? `<div class="box" style="background:#2a1a1d;border-color:#ff6b6b"><b class="bad">Auditor findings still open</b><ul>${bad.map(s => `<li><b>${s.seg} ${s.status}</b>: ${esc(s.note)}</li>`).join("")}${(x.audit?.undeclaredAdditions ?? []).map(u => `<li><b>Undeclared addition</b>: ${esc(u)}</li>`).join("")}${x.audit?.activation?.status !== "OK" ? `<li><b>Activation ${esc(x.audit?.activation?.status)}</b>: ${esc(x.audit?.activation?.note)}</li>` : ""}</ul></div>` : ""}
<div class="card" style="margin-top:10px">
<div><div class="box mbox"><b class="k">ACTIVATION</b><ul>${(a.activation?.facts ?? []).map(f => `<li><code>${esc(f.fact)}</code> = ${esc((f.values ?? []).join(", "))} <span class="small">[${esc(f.observability)}]</span></li>`).join("")}</ul>
<span class="ok">fires</span><ul>${li(a.activation?.fires)}</ul><span class="bad">does not fire</span><ul>${li(a.activation?.doesNotFire)}</ul></div></div>
<div><div class="box"><b>${esc(a.title)}</b><p><span class="k">GIVEN</span> ${esc(a.given)}</p><p><span class="k">WHEN</span> ${esc(a.when)}</p><p><span class="t">THEN</span> ${esc(a.then)}</p>
<span class="ok">PREFER</span><ul>${li(a.prefer)}</ul><span class="bad">AVOID</span><ul>${li(a.avoid)}</ul><p><b>UNLESS</b></p><ul>${li(a.unless)}</ul><p><b>WHY</b> ${esc(a.why)}</p></div>
<div class="box vbox" style="margin-top:8px"><b>EVIDENCE</b><ul>${li(a.evidence)}</ul><b>VERIFIER DETAIL</b><ul>${li(a.verifier_detail)}</ul></div>
${a.sharedNodes?.length ? `<div class="box" style="margin-top:8px;background:#12182a;border-color:#7cc4ff"><b>SHARED NODES</b><ul>${a.sharedNodes.map(n => `<li><code>${esc(n.id)}</code>: ${esc(n.text)}</li>`).join("")}</ul></div>` : ""}
${a.additions?.length ? `<div class="box" style="margin-top:8px;background:#221a2b;border-color:#c792ea"><b>DECLARED ADDITIONS</b><ul>${a.additions.map(n => `<li><code>${esc(n.field)}</code>: ${esc(n.text)} <span class="small">(${esc(n.justification)})</span></li>`).join("")}</ul></div>` : ""}
</div></div>
<details><summary>Where did each line go? (${x.segs.length} segments)</summary><table class="trace"><tr><th>#</th><th>Source path</th><th>Source text</th><th>Destination</th><th>Auditor</th></tr>
${x.segs.map(s => { const au = x.aud.get(s.id); const ds = x.tr.get(s.id) ?? [s.autoDest ?? "audit (auto)"];
  return `<tr class="${au && !OKS.includes(au.status) ? "st-bad" : ""}"><td class="mono">${s.id}</td><td class="mono small">${esc(s.path)}</td><td>${esc(s.text)}</td><td class="mono"><span style="color:${COLORS[bucket(ds[0])] ?? "#fff"}">${esc(ds.join(", "))}</span></td><td class="small">${esc(au?.status ?? "")}${au?.note ? ": " + esc(au.note) : ""}</td></tr>`; }).join("")}
</table></details></section>`; }).join("")}
</body></html>`;
writeFileSync(join(FLEET, "../fleet-report.html"), html);
console.log("ok", rows.length);
