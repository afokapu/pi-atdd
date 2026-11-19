/**
 * PLT-85: the 30-run schedule, counterbalanced. Per model, replicate k uses arm order
 * rotated by k (rep1 A,B,C · rep2 B,C,A · rep3 C,A,B) and models are interleaved, so each
 * arm takes each position once per model. Opus reference runs sit at position 4 of each wave.
 */
export const MODELS = { haiku: ["pi-claude-cli", "claude-haiku-5-5"], terra: ["openai-codex", "gpt-5.6-terra"], glm: ["zai", "glm-5.3-flash"], opus: ["pi-claude-cli", "claude-opus-5-5"] };
const rot = (k) => ["A", "B", "C"].slice(k).concat(["A", "B", "C"].slice(0, k));
export const SCHEDULE = [];
for (let k = 0; k < 3; k++) {
  const o = rot(k), wave = [];
  // slot j: haiku o[j], terra o[(j+1)%3], glm o[(j+2)%3]  -> each wave covers every model×arm once
  for (let j = 0; j < 3; j++) wave.push(["haiku", o[j]], ["terra", o[(j + 1) % 3]], ["glm", o[(j + 2) % 3]]);
  wave.splice(3, 0, ["opus", "A"]);
  for (const [m, arm] of wave) SCHEDULE.push({ runId: `${m}-${arm}-${k + 1}`, model: m, arm, provider: MODELS[m][0], modelId: MODELS[m][1], wave: k + 1 });
}
if (process.argv[1] === new URL(import.meta.url).pathname) console.log(SCHEDULE.map((s, i) => `${i + 1}. ${s.runId}`).join("\n"));
