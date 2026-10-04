import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { stages, cards, sources, recipe, glossary, systemBlocks, MODE_PROMPTS, extractCitations, KNOWLEDGE_VERSION } from './knowledge.js';
import { initStore, logEvent, exportEvents } from './store.js';
import { buildPrereg } from './prereg.js';
import { buildPlan } from './plan.js';
import { PAPER_PROMPT, parseJsonLoose } from './paper.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const PAPER_MODEL = process.env.PAPER_MODEL || MODEL;           // model used to read uploaded papers
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 1500);
const ACCESS_CODE = process.env.ACCESS_CODE || '';          // summit access code; empty = no code needed
const ALLOW_BYO_KEY = process.env.ALLOW_BYO_KEY !== 'false'; // let visitors use their own Anthropic key
const SERVER_KEY = process.env.ANTHROPIC_API_KEY || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const API_BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const RATE_PER_HOUR = Number(process.env.RATE_PER_HOUR || 60);
const MAX_PDF_MB = Number(process.env.MAX_PDF_MB || 15);

const app = express();
app.disable('x-powered-by');
const jsonSmall = express.json({ limit: '300kb' });
const jsonLarge = express.json({ limit: `${Math.ceil(MAX_PDF_MB * 1.4) + 1}mb` });
app.use((req, res, next) => (req.path === '/api/analyze-paper' ? jsonLarge : jsonSmall)(req, res, next));
app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));

const safeEq = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// --- simple per-session rate limit (in memory) ---
const hits = new Map();
function rateLimited(key, weight = 1) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < 3600_000);
  for (let i = 0; i < weight; i++) arr.push(now);
  hits.set(key, arr);
  return arr.length > RATE_PER_HOUR;
}

// Which Anthropic key to use for this request, or an error message.
function resolveKey(req, accessCode) {
  const byoKey = req.get('x-user-api-key');
  if (byoKey && ALLOW_BYO_KEY) return { apiKey: byoKey, byo: true };
  if (SERVER_KEY && (!ACCESS_CODE || safeEq(accessCode || '', ACCESS_CODE))) return { apiKey: SERVER_KEY, byo: false };
  return { error: ACCESS_CODE ? 'Please enter the workshop access code in Settings (or add your own API key).' : 'No API key configured on the server. Add your own key in Settings.' };
}
const anthropicHeaders = (apiKey) => ({ 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' });

app.get('/api/config', (_req, res) => {
  res.json({
    requiresAccessCode: Boolean(ACCESS_CODE),
    serverKeyAvailable: Boolean(SERVER_KEY),
    allowByoKey: ALLOW_BYO_KEY,
    model: MODEL,
    maxPdfMb: MAX_PDF_MB,
    knowledgeVersion: KNOWLEDGE_VERSION
  });
});

app.get('/api/knowledge', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ stages, cards, sources, recipe, glossary, knowledgeVersion: KNOWLEDGE_VERSION });
});

app.post('/api/check-code', (req, res) => {
  if (!ACCESS_CODE) return res.json({ ok: true });
  res.json({ ok: safeEq(req.body?.code || '', ACCESS_CODE) });
});

// --- AI coach (streams NDJSON: {type:'delta',text} … {type:'done',citations,stop}) ---
app.post('/api/coach', async (req, res) => {
  const { stageId, messages = [], worksheet = {}, mode, sessionId = 'anon', participant, consent, accessCode, profile, paper } = req.body || {};
  const key = resolveKey(req, accessCode);
  if (key.error) return res.status(401).json({ error: key.error });
  if (!key.byo && rateLimited(sessionId)) return res.status(429).json({ error: 'Rate limit reached for this session. Please wait a little and try again.' });

  const convo = messages.slice(-16).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 8000) })).filter((m) => m.content);
  if (mode && MODE_PROMPTS[mode]) convo.push({ role: 'user', content: MODE_PROMPTS[mode] });
  while (convo.length && convo[0].role !== 'user') convo.shift();
  // merge consecutive same-role turns (e.g. after an error)
  const merged = [];
  for (const m of convo) { const last = merged[merged.length - 1]; if (last && last.role === m.role) last.content += '\n\n' + m.content; else merged.push({ ...m }); }
  if (!merged.length || merged[merged.length - 1].role !== 'user') return res.status(400).json({ error: 'Nothing to answer.' });

  const started = Date.now();
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
  let upstream;
  try {
    upstream = await fetch(`${API_BASE}/v1/messages`, {
      method: 'POST', signal: ctrl.signal, headers: anthropicHeaders(key.apiKey),
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, temperature: 0.3, stream: true, system: systemBlocks({ stageId, worksheet, mode, profile, paper }), messages: merged })
    });
  } catch (err) {
    console.error('[coach] fetch failed', err.message);
    return res.status(502).json({ error: 'Could not reach the AI service. Please try again.' });
  }
  if (!upstream.ok) {
    const data = await upstream.json().catch(() => ({}));
    console.error('[coach] API error', upstream.status, data?.error?.message);
    return res.status(502).json({ error: `The AI service returned an error (${upstream.status}). ${data?.error?.message || ''}`.trim() });
  }

  res.status(200);
  res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  let text = '', stop = null, usage = {}, model = MODEL, buf = '';
  try {
    const decoder = new TextDecoder();
    for await (const chunk of upstream.body) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (ev.type === 'message_start') { model = ev.message?.model || model; usage = { ...usage, ...(ev.message?.usage || {}) }; }
        else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { text += ev.delta.text; send({ type: 'delta', text: ev.delta.text }); }
        else if (ev.type === 'message_delta') { stop = ev.delta?.stop_reason || stop; usage = { ...usage, ...(ev.usage || {}) }; }
        else if (ev.type === 'error') { send({ type: 'error', error: ev.error?.message || 'The AI service reported an error.' }); }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') { console.error('[coach] stream failed', err.message); send({ type: 'error', error: 'The connection to the AI service was interrupted.' }); }
  }
  const citations = extractCitations(text);
  send({ type: 'done', citations, stop, model });
  res.end();

  if (consent && text) {
    logEvent({
      sessionId, participant, type: 'coach', stage: stageId,
      payload: { mode: mode || 'chat', user: merged[merged.length - 1].content, reply: text, citations: citations.valid, unknownCitations: citations.unknown, stop, latencyMs: Date.now() - started, usage, model, byoKey: key.byo, profile, hasPaper: Boolean(paper), knowledgeVersion: KNOWLEDGE_VERSION }
    });
  }
});

// --- Upload the target paper: extract key facts to pre-fill worksheets ---
app.post('/api/analyze-paper', async (req, res) => {
  const { pdfBase64, sessionId = 'anon', participant, consent, accessCode } = req.body || {};
  const key = resolveKey(req, accessCode);
  if (key.error) return res.status(401).json({ error: key.error });
  if (!pdfBase64 || typeof pdfBase64 !== 'string') return res.status(400).json({ error: 'No PDF received.' });
  const bytes = Math.floor(pdfBase64.length * 3 / 4);
  if (bytes > MAX_PDF_MB * 1024 * 1024) return res.status(413).json({ error: `The PDF is larger than ${MAX_PDF_MB} MB.` });
  if (!Buffer.from(pdfBase64.slice(0, 16), 'base64').toString('latin1').startsWith('%PDF')) return res.status(400).json({ error: 'That file does not look like a PDF.' });
  if (!key.byo && rateLimited(sessionId, 5)) return res.status(429).json({ error: 'Rate limit reached for this session. Please wait a little and try again.' });

  const started = Date.now();
  try {
    const r = await fetch(`${API_BASE}/v1/messages`, {
      method: 'POST', headers: anthropicHeaders(key.apiKey),
      body: JSON.stringify({
        model: PAPER_MODEL, max_tokens: 2500, temperature: 0,
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: PAPER_PROMPT }
        ] }]
      })
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('[paper] API error', r.status, data?.error?.message);
      return res.status(502).json({ error: `The AI service could not read this PDF (${r.status}). ${data?.error?.message || ''}`.trim() });
    }
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    let summary;
    try { summary = parseJsonLoose(text); } catch { return res.status(502).json({ error: 'The paper could not be summarised. Please try again or fill in the details by hand.' }); }
    res.json({ summary });
    if (consent) logEvent({ sessionId, participant, type: 'paper_upload', stage: 'target', payload: { latencyMs: Date.now() - started, usage: data.usage, model: data.model, fields: Object.keys(summary).filter((k) => summary[k]) } });
  } catch (err) {
    console.error('[paper] failed', err);
    res.status(500).json({ error: 'Could not reach the AI service. Please try again.' });
  }
});

const docxHeaders = (res, name) => {
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.set('Content-Disposition', `attachment; filename="${name}"`);
};
const safeName = (p) => String(p || 'draft').replace(/[^A-Za-z0-9_-]/g, '') || 'draft';

// Draft preregistration (Replication Recipe) as a Word document, built from the team's answers.
app.post('/api/prereg', async (req, res) => {
  const { worksheets = {}, recipe = {}, participant = '', sessionId, consent } = req.body || {};
  try {
    const { buffer, counts } = await buildPrereg({ worksheets, recipe, participant: String(participant).slice(0, 40) });
    docxHeaders(res, `preregistration-${safeName(participant)}.docx`);
    res.set('X-Prereg-Counts', JSON.stringify(counts));
    res.send(buffer);
    if (consent && sessionId) logEvent({ sessionId, participant, type: 'prereg_export', stage: 'prereg', payload: { counts } });
  } catch (err) {
    console.error('[prereg] failed', err);
    res.status(500).json({ error: 'Could not build the preregistration document.' });
  }
});

// Full replication plan as a Word document.
app.post('/api/plan', async (req, res) => {
  const { participant = '', sessionId, consent, ...state } = req.body || {};
  try {
    const buffer = await buildPlan({ ...state, participant: String(participant).slice(0, 40) });
    docxHeaders(res, `replication-plan-${safeName(participant)}.docx`);
    res.send(buffer);
    if (consent && sessionId) logEvent({ sessionId, participant, type: 'export', stage: null, payload: { worksheets: state.worksheets, ratings: state.ratings, checklist: state.checklist, recipe: state.recipe, profile: state.profile } });
  } catch (err) {
    console.error('[plan] failed', err);
    res.status(500).json({ error: 'Could not build the plan document.' });
  }
});

// Consented interaction events: stage views, checklist ticks, ratings, citation flags, survey, screener.
const ALLOWED_EVENTS = new Set(['session_start', 'stage_view', 'checklist', 'rating', 'citation_flag', 'citation_open', 'export', 'survey', 'worksheet_snapshot', 'screener', 'help_open', 'prefill', 'finish_view']);
app.post('/api/event', (req, res) => {
  const { sessionId, participant, type, stage, payload, consent } = req.body || {};
  if (!consent || !ALLOWED_EVENTS.has(type) || !sessionId) return res.json({ ok: false });
  const body = JSON.stringify(payload || {});
  if (body.length > 60000) return res.status(413).json({ ok: false });
  logEvent({ sessionId, participant, type, stage, payload });
  res.json({ ok: true });
});

app.get('/api/admin/export', async (req, res) => {
  if (!ADMIN_TOKEN || !safeEq(req.get('x-admin-token') || req.query.token || '', ADMIN_TOKEN)) return res.status(403).json({ error: 'forbidden' });
  const rows = await exportEvents();
  res.set('Content-Type', 'application/x-ndjson');
  res.set('Content-Disposition', 'attachment; filename="replication-navigator-events.jsonl"');
  res.send(rows.map((r) => JSON.stringify(r)).join('\n'));
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

await initStore();
app.listen(PORT, () => console.log(`Replication Navigator on http://localhost:${PORT} (model ${MODEL}, ${cards.length} cards, ${sources.length} sources)`));
