#!/usr/bin/env python3
"""Summarise pilot logs exported from /api/admin/export (JSON lines).

Usage: python3 scripts/analyse_logs.py events.jsonl [--out summary_dir]
Outputs descriptive statistics for the methods paper: participation, usage per stage,
citation validity, flags, reply ratings, checklist completion and SUS scores.
Writes CSV tables to --out (default ./analysis) for further analysis in R/Python.
"""
import csv, json, sys, statistics as st
from collections import Counter, defaultdict
from pathlib import Path

args = sys.argv[1:]
if not args: sys.exit(__doc__)
out = Path(args[args.index('--out') + 1]) if '--out' in args else Path('analysis')
out.mkdir(exist_ok=True)
rows = [json.loads(l) for l in open(args[0]) if l.strip()]
P = lambda r: r.get('payload') or {}

sessions = {r['session_id'] for r in rows}
participants = {r.get('participant') for r in rows if r.get('participant')}
by_type = Counter(r['type'] for r in rows)
coach = [r for r in rows if r['type'] == 'coach']

print(f'Events: {len(rows)} | sessions: {len(sessions)} | participant codes: {len(participants)}')
print('Event types:', dict(by_type))

# Coach turns & citation validity
n_valid = sum(len(P(r).get('citations', [])) for r in coach)
n_unknown = sum(len(P(r).get('unknownCitations', [])) for r in coach)
uncited = sum(1 for r in coach if not P(r).get('citations'))
print(f'\nCoach turns: {len(coach)}')
if coach:
    print(f'  citations: {n_valid} valid, {n_unknown} non-existent ids '
          f'({100 * n_unknown / max(1, n_valid + n_unknown):.1f}% invalid)')
    print(f'  turns without any citation: {uncited} ({100 * uncited / len(coach):.1f}%)')
    lat = [P(r).get('latencyMs') for r in coach if P(r).get('latencyMs')]
    if lat: print(f'  median latency: {st.median(lat) / 1000:.1f}s')
    print('  turns by mode:', dict(Counter(P(r).get('mode') for r in coach)))
    print('  turns by stage:', dict(Counter(r.get('stage') for r in coach)))

# Ratings & flags
ratings = Counter(P(r).get('rating') for r in rows if r['type'] == 'rating')
flags = [r for r in rows if r['type'] == 'citation_flag']
opens = [r for r in rows if r['type'] == 'citation_open']
print(f'\nReply ratings: {dict(ratings)}')
print(f'Citation opens: {len(opens)} | citation flags: {len(flags)}')
flag_cards = Counter(P(r).get('card') for r in flags)
if flag_cards: print('  most flagged cards:', flag_cards.most_common(10))

# Checklist completion (last state per session/stage/item)
state = {}
for r in rows:
    if r['type'] == 'checklist':
        state[(r['session_id'], r.get('stage'), P(r).get('item'))] = P(r).get('checked')
comp = defaultdict(int)
for (sid, stage, _), v in state.items():
    if v: comp[stage] += 1
print('\nChecked checklist items by stage (all sessions):', dict(comp))

# Survey
surveys = {}
for r in rows:
    if r['type'] == 'survey': surveys[r['session_id']] = P(r)
sus = [s['susScore'] for s in surveys.values() if s.get('susScore') is not None]
print(f'\nSurveys: {len(surveys)}')
if sus: print(f'  SUS mean {st.mean(sus):.1f} (sd {st.pstdev(sus):.1f}, n={len(sus)})')
for i in range(1, 6):
    vals = [int(s[f'c{i}']) for s in surveys.values() if s.get(f'c{i}')]
    if vals: print(f'  custom item c{i}: mean {st.mean(vals):.2f} (n={len(vals)})')

# CSV exports
with open(out / 'coach_turns.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['ts', 'session', 'participant', 'stage', 'mode', 'n_valid_cites', 'n_invalid_cites', 'latency_ms', 'user', 'reply'])
    for r in coach:
        p = P(r); w.writerow([r['ts'], r['session_id'], r.get('participant'), r.get('stage'), p.get('mode'), len(p.get('citations', [])), len(p.get('unknownCitations', [])), p.get('latencyMs'), p.get('user'), p.get('reply')])
with open(out / 'surveys.csv', 'w', newline='') as f:
    keys = sorted({k for s in surveys.values() for k in s})
    w = csv.writer(f); w.writerow(['session'] + keys)
    for sid, s in surveys.items(): w.writerow([sid] + [s.get(k) for k in keys])
with open(out / 'citation_audit_sample.csv', 'w', newline='') as f:
    # one row per (coach turn, cited card) for blinded expert audit of citation support
    w = csv.writer(f); w.writerow(['turn_ts', 'stage', 'card', 'reply', 'supports (2=fully,1=partly,0=no)', 'rater'])
    for r in coach:
        for c in P(r).get('citations', []): w.writerow([r['ts'], r.get('stage'), c, P(r).get('reply'), '', ''])
print(f'\nCSV tables written to {out}/')
