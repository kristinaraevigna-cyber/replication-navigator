// Research log store. Only events from participants who gave consent are stored.
// Uses Postgres when DATABASE_URL is set (recommended on Render, where the local disk is
// wiped on every restart); otherwise appends JSON lines to ./data/events.jsonl.
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

let pool = null;
const file = path.resolve(process.env.LOG_FILE || './data/events.jsonl');

export async function initStore() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false }
    });
    await pool.query(`CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      session_id TEXT NOT NULL,
      participant TEXT,
      type TEXT NOT NULL,
      stage TEXT,
      payload JSONB
    )`);
    console.log('[store] using Postgres');
  } else {
    await mkdir(path.dirname(file), { recursive: true });
    console.log(`[store] using ${file}`);
  }
}

export async function logEvent({ sessionId, participant, type, stage, payload }) {
  const row = { ts: new Date().toISOString(), session_id: sessionId, participant: participant || null, type, stage: stage || null, payload: payload || {} };
  try {
    if (pool) {
      await pool.query('INSERT INTO events (session_id, participant, type, stage, payload) VALUES ($1,$2,$3,$4,$5)', [row.session_id, row.participant, row.type, row.stage, row.payload]);
    } else {
      await appendFile(file, JSON.stringify(row) + '\n');
    }
  } catch (err) {
    console.error('[store] failed to log event', err.message);
  }
}

export async function exportEvents() {
  if (pool) {
    const { rows } = await pool.query('SELECT ts, session_id, participant, type, stage, payload FROM events ORDER BY id');
    return rows;
  }
  try {
    const txt = await readFile(file, 'utf8');
    return txt.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
