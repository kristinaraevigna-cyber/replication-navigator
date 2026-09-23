// Offline grounding evaluation: runs evaluation/test-questions.json against a running server.
// Usage: BASE_URL=http://localhost:3000 ACCESS_CODE=... node scripts/eval_coach.mjs [repeats]
// Writes evaluation/results/eval-<timestamp>.json and prints a summary. Human raters then score
// the replies with evaluation/expert-rubric.md (automatic checks cover citations only).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const reps = Number(process.argv[2] || 1);
const qs = JSON.parse(readFileSync(new URL('../evaluation/test-questions.json', import.meta.url)));
const results = [];
for (let r = 0; r < reps; r++) for (const q of qs) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/coach`, { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.USER_API_KEY ? { 'x-user-api-key': process.env.USER_API_KEY } : {}) },
    body: JSON.stringify({ stageId: q.stage, messages: [{ role: 'user', content: q.q }], worksheet: {}, sessionId: `eval-${r}-${q.id}`, accessCode: process.env.ACCESS_CODE, consent: false }) });
  const d = await res.json();
  const valid = d.citations?.valid || [], unknown = d.citations?.unknown || [];
  const hit = q.should_cite_any ? valid.some((c) => q.should_cite_any.includes(c)) : null;
  const saysUncovered = /doesn.t cover|does not cover|not covered|outside (the|my) evidence|isn.t covered/i.test(d.text || '');
  results.push({ rep: r, ...q, ok: res.ok, latencyMs: Date.now() - t0, valid, unknown, expectedCardHit: hit, saysUncovered, reply: d.text || d.error });
  process.stdout.write(`${q.id}${res.ok ? '' : '!'} `);
}
mkdirSync(new URL('../evaluation/results/', import.meta.url), { recursive: true });
const file = new URL(`../evaluation/results/eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url);
writeFileSync(file, JSON.stringify(results, null, 1));
const g = results.filter((x) => x.expect === 'grounded');
const oos = results.filter((x) => x.expect === 'out_of_scope');
console.log(`\n\nReplies: ${results.length}`);
console.log(`Replies with ≥1 valid citation: ${results.filter((x) => x.valid.length).length}`);
console.log(`Non-existent citation ids: ${results.reduce((a, x) => a + x.unknown.length, 0)}`);
console.log(`Grounded questions citing an expected card: ${g.filter((x) => x.expectedCardHit).length}/${g.length}`);
console.log(`Out-of-scope questions flagged as not covered: ${oos.filter((x) => x.saysUncovered).length}/${oos.length}`);
console.log(`Saved ${file.pathname}`);
