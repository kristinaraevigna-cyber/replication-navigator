// Integrity check for the knowledge base (runs in CI): schema, unique ids, valid references.
import { readFileSync } from 'node:fs';
const load = (f) => JSON.parse(readFileSync(new URL(`../knowledge/${f}`, import.meta.url)));
const cards = load('evidence-cards.json'), stages = load('stages.json'), sources = load('sources.json');
const errors = [];
const ids = new Set(); const srcKeys = new Set(sources.map((s) => s.key));
const STAGES = new Set([...stages.map((s) => s.id), 'foundations', 'teaching']);
const KINDS = new Set(['principle', 'how-to', 'pitfall', 'definition', 'tool', 'template', 'checklist']);
for (const c of cards) {
  if (ids.has(c.id)) errors.push(`duplicate id ${c.id}`); ids.add(c.id);
  if (!/^[a-z]+\d{4}-\d{2,3}$/.test(c.id)) errors.push(`bad id format ${c.id}`);
  for (const k of ['stage', 'kind', 'title', 'guidance', 'action', 'source', 'pdf_page', 'quote']) if (c[k] === undefined || c[k] === '') errors.push(`${c.id}: missing ${k}`);
  if (!STAGES.has(c.stage)) errors.push(`${c.id}: unknown stage ${c.stage}`);
  if (!KINDS.has(c.kind)) errors.push(`${c.id}: unknown kind ${c.kind}`);
  if (!srcKeys.has(c.source)) errors.push(`${c.id}: unknown source ${c.source}`);
  const words = String(c.quote).trim().split(/\s+/).length;
  if (words > 30) errors.push(`${c.id}: quote longer than 30 words (${words})`);
}
for (const s of stages) {
  for (const f of [...s.fields, ...s.checklist]) for (const id of f.cards || []) if (!ids.has(id)) errors.push(`stage ${s.id}: unknown card ${id}`);
  for (const id of s.templates || []) if (!ids.has(id)) errors.push(`stage ${s.id}: unknown template ${id}`);
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`OK: ${cards.length} cards, ${stages.length} stages, ${sources.length} sources`);
