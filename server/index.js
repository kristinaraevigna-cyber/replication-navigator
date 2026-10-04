import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { stages, cards, sources, recipe, systemBlocks, MODE_PROMPTS, extractCitations, KNOWLEDGE_VERSION } from './knowledge.js';
import { initStore, logEvent, exportEvents } from './store.js';
import { buildPrereg } from './prereg.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 1200);
const ACCESS_CODE = process.env.ACCESS_CODE || '';          // summit access code; empty = no code needed
const ALLOW_BYO_KEY = process.env.ALLOW_BYO_KEY !== 'false'; // let visitors use their own Anthropic key
const SERVER_KEY = process.env.ANTHROPIC_API_KEY || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const API_BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const RATE_PER_HOUR = Number(process.env.RATE_PER_HOUR || 60);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));

const safeEq = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// --- simple per-session rate limit (in memory) ---
const hits = new Map();
function rateLimited(key) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < 3600_000);
  arr.push(now); hits.set(key, arr);
  return arr.length > RATE_PER_HOUR;
}

app.get('/api/config', (_req, res) => {
  res.json({
    requiresAccessCode: Boolean(ACCESS_CODE),
    serverKeyAvailable: Boolean(SERVER_KEY),
    allowByoKey: ALLOW_BYO_KEY,
    model: MODEL,
    knowledgeVersion: KNOWLEDGE_VERSION
  });
});

app.get('/api/knowledge', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ stages, cards, sources, recipe, knowledgeVersion: KNOWLEDGE_VERSION });
});

app.post('/api/check-code', (req, res) => {
  if (!ACCESS_CODE) return res.json({ ok: true });
  res.json({ ok: safeEq(req.body?.code || '', ACCESS_CODE) });
});

app.post('/api/coach', async (req, res) => {
  const { stageId, messages = [], worksheet = {}, mode, sessionId = 'anon', participant, consent, accessCode } = req.body || {};
  const byoKey = req.get('x-user-api-key');

  let apiKey;
  if (byoKey && ALLOW_BYO_KEY) apiKey = byoKey;
  else if (SERVER_KEY && (!ACCESS_CODE || safeEq(accessCode || '', ACCESS_CODE))) apiKey = SERVER_KEY;
  else return res.status(401).json({ error: ACCESS_CODE ? 'Please enter the workshop access code (or your own API key).' : 'No API key configured on the server. Add your own key in Settings.' });

  if (!byoKey && rateLimited(sessionId)) return res.status(429).json({ error: 'Rate limit reached for this session. Please wait a little and try again.' });

  // Build conversation: keep last 16 turns; a coach "mode" becomes a user turn.
  const convo = messages.slice(-16).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 8000) }));
  if (mode && MODE_PROMPTS[mode]) convo.push({ role: 'user', content: MODE_PROMPTS[mode] });
  if (!convo.length || convo[convo.length - 1].role !== 'user') return res.status(400).json({ error: 'Nothing to answer.' });
  while (convo.length && convo[0].role !== 'user') convo.shift();

  const started = Date.now();
  try {
    const r = await fetch(`${API_BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, temperature: 0.3, system: systemBlocks({ stageId, worksheet, mode }), messages: convo })
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('[coach] API error', r.status, data?.error?.message);
      return res.status(502).json({ error: `The AI service returned an error (${r.status}). ${data?.error?.message || ''}`.trim() });
    }
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const citations = extractCitations(text);
    res.json({ text, citations, usage: data.usage, model: data.model });

    if (consent) {
      logEvent({
        sessionId, participant, type: 'coach', stage: stageId,
        payload: {
          mode: mode || 'chat',
          user: convo[convo.length - 1].content,
          reply: text,
          citations: citations.valid,
          unknownCitations: citations.unknown,
          latencyMs: Date.now() - started,
          usage: data.usage,
          model: data.model,
          byoKey: Boolean(byoKey),
          knowledgeVersion: KNOWLEDGE_VERSION
        }
      });
    }
  } catch (err) {
    console.error('[coach] failed', err);
    res.status(500).json({ error: 'Could not reach the AI service. Please try again.' });
  }
});

// Draft preregistration (Replication Recipe) as a Word document, built from the team's answers.
app.post('/api/prereg', async (req, res) => {
  const { worksheets = {}, recipe = {}, participant = '', sessionId, consent } = req.body || {};
  try {
    const { buffer, counts } = await buildPrereg({ worksheets, recipe, participant: String(participant).slice(0, 40) });
    const safe = String(participant || 'draft').replace(/[^A-Za-z0-9_-]/g, '') || 'draft';
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `attachment; filename="preregistration-${safe}.docx"`);
    res.set('X-Prereg-Counts', JSON.stringify(counts));
    res.send(buffer);
    if (consent && sessionId) logEvent({ sessionId, participant, type: 'prereg_export', stage: 'prereg', payload: { counts } });
  } catch (err) {
    console.error('[prereg] failed', err);
    res.status(500).json({ error: 'Could not build the preregistration document.' });
  }
});

// Consented interaction events: stage views, checklist ticks, ratings, citation flags, survey, export.
const ALLOWED_EVENTS = new Set(['session_start', 'stage_view', 'checklist', 'rating', 'citation_flag', 'citation_open', 'export', 'survey', 'worksheet_snapshot']);
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
