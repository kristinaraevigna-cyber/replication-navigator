// Replication Navigator — client app (no build step, no dependencies).
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());

const STORE_KEY = 'replication-navigator:v1';
let K = null;          // knowledge {stages, cards, sources, recipe}
let CONFIG = {};
let cardById = new Map();
let sourceByKey = new Map();
let lastOpenedCitation = null;

// ---------- state ----------
const defaultState = () => ({
  sessionId: uid(), participant: '', consent: false, accessCode: '', onboarded: false,
  view: 'stage:target', worksheets: {}, ratings: {}, checklist: {}, chats: {}, recipe: {}, survey: {}, surveySent: false, msgRatings: {},
  profile: {}, screened: false, showAdvanced: false, paper: null, openHelp: {}
});
let S = defaultState();
function load() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) S = { ...defaultState(), ...JSON.parse(raw) }; } catch { /* storage unavailable */ }
}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch { /* ignore */ } }, 150);
}
const flush = () => { clearTimeout(saveTimer); try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch { /* ignore */ } };
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
const apiKey = () => { try { return sessionStorage.getItem('rn-key') || ''; } catch { return ''; } };
const setApiKey = (k) => { try { k ? sessionStorage.setItem('rn-key', k) : sessionStorage.removeItem('rn-key'); } catch { /* ignore */ } };

function track(type, stage, payload = {}) {
  if (!S.consent) return;
  fetch('/api/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: S.sessionId, participant: S.participant, consent: true, type, stage, payload }) }).catch(() => {});
}

// ---------- helpers ----------
const P = () => S.profile || {};
const isNew = () => P().level === 'new';
const matches = (cond) => !cond || Object.entries(cond).every(([k, v]) => !P()[k] || P()[k] === v);
const visible = (item) => matches(item.when);
const stageOptional = (s) => Boolean(s.optional_when) && Object.entries(s.optional_when).every(([k, v]) => P()[k] === v);
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}`.trim() : `${m} min`);
function totalMinutes() { return K.stages.filter((s) => s.id !== 'report' && !stageOptional(s)).reduce((a, s) => a + (s.minutes || 0), 0); }

// Glossary: wrap the first occurrence of each term in a text block with a clickable explanation.
let GLOSS_RE = null; const GLOSS = new Map();
function initGlossary() {
  const entries = [];
  for (const g of K.glossary || []) for (const w of [g.term, ...(g.aliases || [])]) { GLOSS.set(w.toLowerCase(), g); entries.push(w); }
  entries.sort((a, b) => b.length - a.length);
  const escRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  GLOSS_RE = new RegExp(`(^|[^A-Za-z0-9])(${entries.map(escRe).join('|')})(?![A-Za-z0-9])`, 'gi');
}
function gloss(text) {
  const html = esc(text);
  if (!GLOSS_RE) return html;
  const used = new Set();
  return html.replace(GLOSS_RE, (m, pre, word) => {
    const g = GLOSS.get(word.toLowerCase());
    if (!g || used.has(g.term)) return m;
    used.add(g.term);
    return `${pre}<button type="button" class="term" data-term="${esc(g.term)}">${word}</button>`;
  });
}
function openTerm(term) {
  const g = (K.glossary || []).find((x) => x.term === term); if (!g) return;
  $('#termBody').innerHTML = `<h3 style="margin:0 0 .4rem">${esc(g.term)}</h3><p>${esc(g.def)}</p>${g.card ? `<p><small>Evidence:</small> ${citeChip(g.card)}</p>` : ''}`;
  $('#termDialog').showModal();
  track('help_open', currentStage()?.id, { term });
}
let toastTimer;
function toast(msg, ms = 6000) {
  const el = $('#toast'); el.innerHTML = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

const stageById = (id) => K.stages.find((s) => s.id === id);
const currentStage = () => (S.view.startsWith('stage:') ? stageById(S.view.slice(6)) : null);

function citeChip(id) {
  const ok = cardById.has(id);
  return ok ? `<button type="button" class="cite" data-card="${esc(id)}">${esc(id)}</button>`
            : `<span class="cite bad" title="This id is not in the evidence base">${esc(id)}</span>`;
}
function cardLabel(c) {
  const s = sourceByKey.get(c.source);
  const pg = c.printed_page ? `p. ${c.printed_page}` : `PDF p. ${c.pdf_page}`;
  return `${s ? s.short : c.source}, ${pg}`;
}

// Minimal, safe markdown: escape first, then format.
function renderMarkdown(text) {
  const lines = esc(text).split('\n');
  let html = ''; let list = null;
  const inline = (t) => t
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([a-z]+\d{4}-\d{2,3})\]/g, (_, id) => citeChip(id));
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    let m;
    if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^#{1,4}\s+(.*)/))) { close(); html += `<p><strong>${inline(m[1])}</strong></p>`; }
    else if (!l.trim()) { close(); }
    else { close(); html += `<p>${inline(l)}</p>`; }
  }
  close();
  return html;
}

// ---------- progress / sidebar ----------
function stageProgress(stage) {
  const ticks = S.checklist[stage.id] || [];
  const items = stage.checklist.map((c, i) => ({ c, i })).filter(({ c }) => visible(c));
  const done = items.filter(({ i }) => ticks[i]).length;
  return { done, total: items.length };
}
function renderSidebar() {
  $('#stageList').innerHTML = K.stages.map((s) => {
    const { done, total } = stageProgress(s);
    const opt = stageOptional(s);
    const cls = done === total ? 'done' : done ? 'part' : '';
    const cur = S.view === `stage:${s.id}` ? 'aria-current="step"' : '';
    const meta = opt ? 'optional for you' : s.id === 'report' ? 'after data collection' : `≈ ${s.minutes} min`;
    return `<li><button data-view="stage:${s.id}" ${cur} class="${opt ? 'opt' : ''}"><span class="stage-num ${cls}">${done === total ? '✓' : s.n}</span><span class="stage-label">${esc(s.title)}<small class="stage-meta">${meta}</small></span></button></li>`;
  }).join('');
  $$('.side-link').forEach((b) => b.classList.toggle('active', S.view === b.dataset.view));
  let d = 0, t = 0;
  K.stages.forEach((s) => { if (stageOptional(s) || s.id === 'report') return; const p = stageProgress(s); d += p.done; t += p.total; });
  $('#timeTotal').textContent = `Stages 1–9 take about ${fmtMin(totalMinutes())}`;
  const pct = Math.round((d / t) * 100);
  $('#progressBar').style.width = pct + '%';
  $('#progressText').textContent = pct + '%';
}

// ---------- views ----------
function go(view) {
  S.view = view; save();
  render();
  $('#sidebar').classList.remove('open');
  $('#main').scrollTop = 0; window.scrollTo(0, 0);
  if (view.startsWith('stage:')) track('stage_view', view.slice(6));
  if (view === 'finish') track('finish_view', null, { progress: $('#progressText').textContent });
}

function render() {
  renderSidebar();
  const [kind, id] = S.view.split(':');
  if (kind === 'stage') renderStage(stageById(id) || K.stages[0]);
  else if (kind === 'recipe') renderRecipe();
  else if (kind === 'survey') renderSurvey();
  else if (kind === 'about') renderAbout();
  else if (kind === 'evidence') renderEvidence();
  else if (kind === 'finish') renderFinish();
  renderChat();
}

function renderStage(stage) {
  const ws = S.worksheets[stage.id] || {};
  const rt = S.ratings[stage.id] || {};
  const ticks = S.checklist[stage.id] || [];
  const idx = K.stages.indexOf(stage);
  const prev = K.stages[idx - 1], next = K.stages[idx + 1];
  const optional = stageOptional(stage);
  const fields = stage.fields.filter(visible);
  const hideAdv = isNew() && !S.showAdvanced;
  const advCount = fields.filter((f) => f.advanced).length;
  const helpOpen = (key) => (S.openHelp[key] ?? isNew());

  const fieldHtml = (f) => {
    if (f.advanced && hideAdv && !ws[f.id]) return '';
    const v = ws[f.id] ?? (f.type === 'checks' ? [] : '');
    let input = '';
    if (f.type === 'textarea') input = `<textarea id="f-${f.id}" data-field="${f.id}">${esc(v)}</textarea>`;
    else if (f.type === 'text') input = `<input type="text" id="f-${f.id}" data-field="${f.id}" value="${esc(v)}">`;
    else if (f.type === 'select') input = `<select id="f-${f.id}" data-field="${f.id}"><option value="">— choose —</option>${f.options.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (f.type === 'checks') input = `<div class="checks">${f.options.map((o) => `<label class="check"><input type="checkbox" data-multi="${f.id}" value="${esc(o)}" ${v.includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div>`;
    const rating = f.rating ? `<span class="rating" data-rating="${f.id}">Rate 1–5: ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-r="${n}" class="${rt[f.id] === n ? 'on' : ''}" aria-label="${n}">${n}</button>`).join('')}</span>` : '';
    const cites = (f.cards || []).map(citeChip).join('');
    const hk = `${stage.id}.${f.id}`;
    const helpBtn = f.help ? `<button type="button" class="help-btn" data-help="${hk}" aria-expanded="${helpOpen(hk)}" title="What does this mean?">?</button>` : '';
    const lab = f.type === 'checks' ? `<span class="flabel">${gloss(f.label)}${helpBtn}</span>` : `<label for="f-${f.id}">${gloss(f.label)}</label>${helpBtn}`;
    const help = f.help ? `<div class="help" id="help-${hk.replace('.', '-')}" ${helpOpen(hk) ? '' : 'hidden'}>${gloss(f.help)}</div>` : '';
    return `<div class="field ${f.advanced ? 'adv' : ''}"><div class="label-row">${lab}${f.advanced ? '<span class="tag">optional</span>' : ''}</div>${help}${input}<div class="field-meta">${rating}${cites ? `<small>Evidence:</small> ${cites}` : ''}</div></div>`;
  };

  const checks = stage.checklist.map((c, i) => ({ c, i })).filter(({ c }) => visible(c));
  const paperCard = stage.id === 'target' ? paperCardHtml() : '';
  const qualNote = P().approach === 'qualitative' && ['target', 'sample', 'analysis'].includes(stage.id)
    ? '<div class="note">You said your study is qualitative. The evidence base is mostly about quantitative replication, so some fields here may not fit. Skip what does not apply and ask the experts.</div>' : '';

  $('#main').innerHTML = `
    <div class="eyebrow">Stage ${stage.n} of ${K.stages.length} · ${stage.id === 'report' ? 'after data collection' : `≈ ${stage.minutes} min`}</div>
    <h1>${esc(stage.title)}</h1>
    ${stage.expert_review ? '<span class="expert">★ Expert check-point: have an expert look at this stage before moving on</span>' : ''}
    ${optional ? `<div class="note">Based on your setup answers, this stage probably doesn't apply to you (the original data are not available). Note that in the first field and move on. <button class="btn" data-view="stage:${next.id}">Skip to ${esc(next.title)} →</button></div>` : ''}
    ${qualNote}
    <div class="card intro">
      <h3 style="margin-top:0">What this stage is about</h3>
      <p>${gloss(stage.intro || stage.goal)}</p>
      <details ${isNew() ? '' : 'open'}><summary>Questions to answer</summary><ul class="questions">${stage.questions.map((q) => `<li>${gloss(q)}</li>`).join('')}</ul></details>
    </div>
    ${paperCard}
    <h2>Worksheet</h2>
    <div class="card">${fields.map(fieldHtml).join('')}
      ${hideAdv && advCount ? `<button class="btn ghost small" data-show-adv>Show ${advCount} optional field${advCount > 1 ? 's' : ''} for more detail</button>` : ''}
      ${stage.id === 'target' ? '<p><small>Ratings help you compare candidate studies. They are for ranking, not precise scores.</small> ' + citeChip('isager2021-24') + '</p>' : ''}
      ${stage.id === 'differences' ? `<p><small>For a full structured version, fill in the <a href="#" data-view="recipe">Replication Recipe</a> (Brandt et al., 2014).</small></p>` : ''}
    </div>
    <h2>Checklist</h2>
    <div class="card"><ul class="checklist">${checks.map(({ c, i }) => `
      <li><input type="checkbox" id="ck-${i}" data-check="${i}" ${ticks[i] ? 'checked' : ''}>
      <div class="txt"><label for="ck-${i}">${gloss(c.text)}</label>${c.technical && c.technical !== c.text ? `<div class="tech">In the literature: ${esc(c.technical)}</div>` : ''}</div><span class="cites">${c.cards.map(citeChip).join('')}</span></li>`).join('')}
    </ul></div>
    ${stage.templates ? `<h2>Email templates</h2><div class="card">${stage.templates.map((id) => { const c = cardById.get(id); return `<p><strong>${esc(c.title.replace('Email: ', ''))}</strong> ${citeChip(id)}<br><small>${esc(c.guidance)}</small></p>`; }).join('')}<button class="btn" data-mode-shortcut="email">Draft an email with the coach</button></div>` : ''}
    ${stage.id === 'prereg' ? `<h2>Draft your preregistration</h2><div class="card"><p>Download a draft preregistration in the <strong>Replication Recipe</strong> format (Brandt et al., 2014) as a Word document. It uses your answers on the <a href="#" data-view="recipe">Replication Recipe</a> page and fills gaps from your stage worksheets. Anything still empty is highlighted in yellow.</p><button class="btn primary" data-prereg>Download draft preregistration (.docx)</button></div>` : ''}
    <h2>Resources</h2>
    <div class="card"><ul class="resources">${stage.resources.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a></li>`).join('')}</ul></div>
    <div class="nav-row">
      ${prev ? `<button class="btn" data-view="stage:${prev.id}">← ${esc(prev.title)}</button>` : '<span></span>'}
      ${stage.id === 'analysis' ? `<span class="row"><button class="btn" data-view="stage:report">${esc(next.title)}</button><button class="btn primary" data-view="finish">Finish &amp; download →</button></span>`
        : next ? `<button class="btn primary" data-view="stage:${next.id}">${esc(next.title)} →</button>` : `<button class="btn primary" data-view="finish">Finish &amp; download →</button>`}
    </div>`;

  $('#coachStage').textContent = `Stage ${stage.n}: ${stage.title}`;
  $('#emailMode').hidden = !stage.templates;

  $$('[data-field]', $('#main')).forEach((el) => el.addEventListener('input', () => {
    (S.worksheets[stage.id] ||= {})[el.dataset.field] = el.value; save();
  }));
  $$('[data-multi]', $('#main')).forEach((el) => el.addEventListener('change', () => {
    const f = el.dataset.multi;
    (S.worksheets[stage.id] ||= {})[f] = $$(`[data-multi="${f}"]:checked`).map((x) => x.value); save();
  }));
  $$('[data-rating]', $('#main')).forEach((wrap) => wrap.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-r]'); if (!b) return;
    (S.ratings[stage.id] ||= {})[wrap.dataset.rating] = Number(b.dataset.r); save();
    $$('button', wrap).forEach((x) => x.classList.toggle('on', x === b));
  }));
  $$('[data-check]', $('#main')).forEach((el) => el.addEventListener('change', () => {
    const arr = (S.checklist[stage.id] ||= []); arr[Number(el.dataset.check)] = el.checked; save();
    renderSidebar();
    track('checklist', stage.id, { item: Number(el.dataset.check), checked: el.checked });
  }));
  if (stage.id === 'target') bindPaperCard();
}

// ---------- target paper upload ----------
function paperCardHtml() {
  const p = S.paper;
  if (!p) return `
    <div class="card upload">
      <h3 style="margin-top:0">Optional: upload the paper you're replicating</h3>
      <p>Upload the PDF and the AI will pull out the key details (sample size, effect size, design, measures) to fill in your worksheets, and the coach will tailor its advice to that study. It takes about 30–60 seconds.</p>
      <p><small>The PDF is sent to the AI service (Anthropic) only to extract these details and is not stored. Use a paper you have legal access to. Always check the extracted details against the paper.</small></p>
      <label class="btn primary file-btn">Choose PDF…<input type="file" id="paperFile" accept="application/pdf" hidden></label>
      <span id="paperStatus" class="status"></span>
    </div>`;
  const parts = p.participants || {}, eff = p.effect || {};
  const row = (k, v) => (v ? `<tr><th>${esc(k)}</th><td>${esc(typeof v === 'string' ? v : JSON.stringify(v))}</td></tr>` : '');
  const sugg = prefillSuggestions();
  return `
    <div class="card upload">
      <h3 style="margin-top:0">Your target paper</h3>
      <table class="kv">
        ${row('Reference', p.citation)}${row('Study', p.study_label)}${row('Main claim', p.main_claim)}${row('Design', p.design)}
        ${row('Participants', [parts.n, parts.population, parts.country, parts.setting].filter(Boolean).join(' · '))}
        ${row('Key result', [eff.statistic, eff.effect_size, eff.ci && 'CI ' + eff.ci].filter(Boolean).join(' · '))}
        ${row('Measures', (p.measures || []).map((m) => [m.construct, m.instrument, m.reliability].filter(Boolean).join(': ')).join(' | '))}
        ${row('Data / materials', [p.data_availability, p.materials_availability].filter(Boolean).join(' · '))}
      </table>
      <p><small>Extracted automatically, so check each detail against the paper. The coach now uses this summary.</small></p>
      ${sugg.length ? `<details open><summary><strong>Fill ${sugg.length} empty field${sugg.length > 1 ? 's' : ''} with these details</strong></summary>
        <ul class="prefill">${sugg.map((x, i) => `<li><label class="check"><input type="checkbox" data-sugg="${i}" checked> <span><strong>${esc(x.label)}:</strong> ${esc(x.value.length > 160 ? x.value.slice(0, 160) + '…' : x.value)}</span></label></li>`).join('')}</ul>
        <button class="btn primary" id="applyPrefill">Fill selected fields</button></details>` : '<p><small>Your matching fields are already filled in.</small></p>'}
      <p><button class="btn ghost small" id="removePaper">Remove paper</button></p>
    </div>`;
}
function prefillSuggestions() {
  const p = S.paper; if (!p) return [];
  const parts = p.participants || {}, eff = p.effect || {};
  const effText = [eff.effect_size, eff.ci && `95% CI ${eff.ci}`, eff.statistic, parts.n && `N = ${parts.n}`].filter(Boolean).join('; ');
  const measures = (p.measures || []).map((m) => [m.construct, m.instrument, m.items && `${m.items} items`, m.reliability].filter(Boolean).join(' – ')).join('\n');
  const list = [
    ['ws', 'target', 'citation', 'Stage 1 · Target study', p.citation],
    ['ws', 'target', 'claim', 'Stage 1 · Claim', p.main_claim],
    ['ws', 'sample', 'orig', 'Stage 6 · Original effect size, CI and N', effText],
    ['ws', 'measures', 'measures', 'Stage 5 · Key measures', measures],
    ['ws', 'analysis', 'primary', 'Stage 9 · Primary analysis', p.analysis && `Original analysis: ${p.analysis}`],
    ['rq', null, 1, 'Recipe 1 · Description of the effect', p.main_claim],
    ['rq', null, 3, 'Recipe 3 · Original effect size', eff.effect_size],
    ['rq', null, 4, 'Recipe 4 · Confidence interval', eff.ci],
    ['rq', null, 5, 'Recipe 5 · Original sample size', parts.n],
    ['rq', null, 6, 'Recipe 6 · Where the study was run', parts.setting],
    ['rq', null, 7, 'Recipe 7 · Country / region', parts.country],
    ['rq', null, 8, 'Recipe 8 · Kind of sample', parts.population],
    ['rq', null, 9, 'Recipe 9 · Paper or computer', parts.mode]
  ];
  return list.filter(([kind, sid, fid, , v]) => v && typeof v === 'string' && !/^null$/i.test(v.trim())
    && !(kind === 'ws' ? (S.worksheets[sid] || {})[fid] : S.recipe[fid]))
    .map(([kind, sid, fid, label, value]) => ({ kind, sid, fid, label, value: String(value).trim() }));
}
function bindPaperCard() {
  const input = $('#paperFile');
  if (input) input.addEventListener('change', async () => {
    const f = input.files[0]; if (!f) return;
    const max = (CONFIG.maxPdfMb || 15) * 1024 * 1024;
    if (f.size > max) { $('#paperStatus').textContent = `That PDF is over ${CONFIG.maxPdfMb || 15} MB.`; return; }
    $('#paperStatus').textContent = 'Reading the paper… this takes about 30–60 seconds.';
    $('.file-btn').classList.add('disabled');
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
      const headers = { 'content-type': 'application/json' };
      if (apiKey()) headers['x-user-api-key'] = apiKey();
      const r = await fetch('/api/analyze-paper', { method: 'POST', headers, body: JSON.stringify({ pdfBase64: b64, sessionId: S.sessionId, participant: S.participant, consent: S.consent, accessCode: S.accessCode }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Upload failed');
      S.paper = d.summary; save(); render();
    } catch (err) {
      $('#paperStatus').textContent = err.message;
      $('.file-btn')?.classList.remove('disabled');
    }
  });
  $('#applyPrefill')?.addEventListener('click', () => {
    const sugg = prefillSuggestions(); const applied = [];
    $$('[data-sugg]').forEach((cb) => {
      if (!cb.checked) return; const x = sugg[Number(cb.dataset.sugg)]; if (!x) return;
      if (x.kind === 'ws') (S.worksheets[x.sid] ||= {})[x.fid] = x.value; else S.recipe[x.fid] = x.value;
      applied.push(x.label);
    });
    save(); render(); track('prefill', 'target', { applied });
    toast(`Filled ${applied.length} field${applied.length === 1 ? '' : 's'}. Check them against the paper as you go.`);
  });
  $('#removePaper')?.addEventListener('click', () => { if (confirm('Remove the paper summary? Fields already filled stay as they are.')) { S.paper = null; save(); render(); } });
}

function renderRecipe() {
  const sections = [...new Set(K.recipe.map((q) => q.section))];
  $('#main').innerHTML = `
    <div class="eyebrow">Structured template</div>
    <h1>The Replication Recipe</h1>
    <p class="goal">The 36 questions from Brandt et al. (2014). Filling these in documents your replication fully and makes a strong basis for a preregistration. Your answers are included in the exported plan. ${citeChip('brandt2014-02')} ${citeChip('brandt2014-17')}</p>
    ${sections.map((sec) => `<h2>${esc(sec)}</h2><div class="card">${K.recipe.filter((q) => q.section === sec).map((q) => `
      <div class="field"><label for="rq-${q.n}">${q.n}. ${esc(q.text)}</label><textarea id="rq-${q.n}" data-rq="${q.n}">${esc(S.recipe[q.n] || '')}</textarea></div>`).join('')}</div>`).join('')}
    <div class="card"><p><strong>Ready to preregister?</strong> Download these answers as a draft preregistration. Questions you left blank are drafted from your stage worksheets where possible.</p><button class="btn primary" data-prereg>Download draft preregistration (.docx)</button></div>
    <p><small>Source: Brandt et al. (2014), Journal of Experimental Social Psychology, 50, 217–224. Official template: <a href="https://osf.io/4jd46/" target="_blank" rel="noopener">osf.io/4jd46</a>.</small></p>`;
  $('#coachStage').textContent = 'Replication Recipe';
  $$('[data-rq]').forEach((el) => el.addEventListener('input', () => { S.recipe[el.dataset.rq] = el.value; save(); }));
}

function renderEvidence() {
  const stageOpts = ['all', ...K.stages.map((s) => s.id), 'foundations', 'teaching'];
  $('#main').innerHTML = `
    <div class="eyebrow">What the coach knows</div>
    <h1>Evidence base</h1>
    <p class="goal">${K.cards.length} evidence cards from ${K.sources.length} sources. Each card paraphrases one piece of guidance and carries a short verbatim quote with its page number, so you can check it against the original.</p>
    <div class="filters">
      <input id="q" placeholder="Search cards…" aria-label="Search cards">
      <select id="fs" aria-label="Filter by stage">${stageOpts.map((s) => `<option value="${s}">${s === 'all' ? 'All stages' : (stageById(s)?.title || s)}</option>`).join('')}</select>
      <select id="fsrc" aria-label="Filter by source"><option value="all">All sources</option>${K.sources.map((s) => `<option value="${s.key}">${esc(s.short)}</option>`).join('')}</select>
    </div>
    <div id="cardList"></div>
    <h2>Sources</h2>
    <div class="card"><ol>${K.sources.map((s) => `<li>${esc(s.citation)} <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>${s.page_note ? `<br><small>${esc(s.page_note)}</small>` : ''}</li>`).join('')}</ol></div>`;
  const draw = () => {
    const q = $('#q').value.toLowerCase(), st = $('#fs').value, src = $('#fsrc').value;
    const list = K.cards.filter((c) => (st === 'all' || c.stage === st) && (src === 'all' || c.source === src) && (!q || `${c.title} ${c.guidance} ${c.action} ${c.quote} ${c.id}`.toLowerCase().includes(q)));
    $('#cardList').innerHTML = `<p><small>${list.length} cards</small></p>` + list.slice(0, 200).map(cardHtml).join('');
  };
  $('#coachStage').textContent = 'Evidence base';
  ['input', 'change'].forEach((ev) => ['#q', '#fs', '#fsrc'].forEach((s) => $(s).addEventListener(ev, draw)));
  draw();
}

function cardHtml(c) {
  const s = sourceByKey.get(c.source);
  return `<div class="card ecard">
    <div class="meta"><span class="tag">${esc(c.id)}</span><span class="tag ${c.kind}">${esc(c.kind)}</span><span class="tag">${esc(stageById(c.stage)?.title || c.stage)}</span></div>
    <h3>${esc(c.title)}</h3>
    <p>${esc(c.guidance)}</p>
    <p><strong>Action:</strong> ${esc(c.action)}</p>
    <blockquote>“${esc(c.quote)}”</blockquote>
    <small>${esc(cardLabel(c))}${s ? ` · <a href="${esc(s.url)}" target="_blank" rel="noopener">source</a>` : ''}</small>
  </div>`;
}

const SUS = [
  'I think that I would like to use this tool frequently.',
  'I found the tool unnecessarily complex.',
  'I thought the tool was easy to use.',
  'I think that I would need the support of a technical person to be able to use this tool.',
  'I found the various functions in this tool were well integrated.',
  'I thought there was too much inconsistency in this tool.',
  'I would imagine that most people would learn to use this tool very quickly.',
  'I found the tool very cumbersome to use.',
  'I felt very confident using the tool.',
  'I needed to learn a lot of things before I could get going with this tool.'
];
const CUSTOM = [
  'The AI coach\'s advice was accurate and relevant to my replication.',
  'The citations helped me trust and check the advice.',
  'The tool improved the rigour of my replication plan.',
  'I understand the replication process better after using the tool.',
  'I would recommend this tool to other doctoral students.'
];
function renderSurvey() {
  const lik = (key, i) => `<div class="likert">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="${key}${i}" value="${n}" ${S.survey[key + i] == n ? 'checked' : ''}>${n}</label>`).join('')}</div><div class="likert-ends"><span>Strongly disagree</span><span>Strongly agree</span></div>`;
  $('#main').innerHTML = `
    <div class="eyebrow">Pilot evaluation</div>
    <h1>Feedback survey</h1>
    <p class="goal">About 4 minutes. It covers the System Usability Scale (SUS) plus a few questions about the coach. ${S.consent ? '' : '<strong>You have not consented to research logging, so your answers stay in this browser unless you turn logging on in Settings.</strong>'}</p>
    <form id="surveyForm">
      <div class="card"><div class="field"><label for="role">Your role</label><select id="role" name="role"><option value="">—</option>${['PhD student', 'Master student', 'Postdoc / early-career', 'Faculty / expert', 'Other'].map((r) => `<option ${S.survey.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div class="field"><label for="prior">Prior replication experience</label><select id="prior" name="prior"><option value="">—</option>${['None', 'Read about it', 'Helped with one', 'Led one or more'].map((r) => `<option ${S.survey.prior === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div></div>
      <h2>Usability (SUS)</h2>
      <div class="card">${SUS.map((q, i) => `<div class="field"><span class="flabel">${i + 1}. ${esc(q)}</span>${lik('sus', i + 1)}</div>`).join('')}</div>
      <h2>The coach and the process</h2>
      <div class="card">${CUSTOM.map((q, i) => `<div class="field"><span class="flabel">${esc(q)}</span>${lik('c', i + 1)}</div>`).join('')}</div>
      <h2>Open questions</h2>
      <div class="card">
        <div class="field"><label for="best">What was most useful?</label><textarea id="best" name="best">${esc(S.survey.best || '')}</textarea></div>
        <div class="field"><label for="worst">What was wrong, confusing or missing?</label><textarea id="worst" name="worst">${esc(S.survey.worst || '')}</textarea></div>
        <div class="field"><label for="errors">Did the coach say anything incorrect? Please describe.</label><textarea id="errors" name="errors">${esc(S.survey.errors || '')}</textarea></div>
      </div>
      <button class="btn primary" type="submit">${S.surveySent ? 'Update answers' : 'Submit feedback'}</button> <span id="surveyMsg"></span>
    </form>`;
  $('#coachStage').textContent = 'Feedback';
  const form = $('#surveyForm');
  form.addEventListener('change', () => { Object.assign(S.survey, Object.fromEntries(new FormData(form))); save(); });
  form.addEventListener('input', () => { Object.assign(S.survey, Object.fromEntries(new FormData(form))); save(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    Object.assign(S.survey, Object.fromEntries(new FormData(form)));
    const odd = [1, 3, 5, 7, 9], even = [2, 4, 6, 8, 10];
    const have = [...odd, ...even].every((i) => S.survey['sus' + i]);
    const sus = have ? (odd.reduce((a, i) => a + (S.survey['sus' + i] - 1), 0) + even.reduce((a, i) => a + (5 - S.survey['sus' + i]), 0)) * 2.5 : null;
    S.surveySent = true; save();
    track('survey', null, { ...S.survey, susScore: sus, progress: $('#progressText').textContent });
    $('#surveyMsg').textContent = S.consent ? 'Thank you! Your feedback was recorded.' : 'Saved in this browser (research logging is off).';
  });
}

function renderFinish() {
  const rows = K.stages.map((s) => {
    const { done, total } = stageProgress(s);
    const filled = s.fields.filter(visible).filter((f) => { const v = (S.worksheets[s.id] || {})[f.id]; return Array.isArray(v) ? v.length : v; }).length;
    const nf = s.fields.filter(visible).length;
    const note = stageOptional(s) ? 'optional for you' : s.id === 'report' ? 'after data collection' : '';
    return `<tr><td><a href="#" data-view="stage:${s.id}">${s.n}. ${esc(s.title)}</a>${note ? ` <small>(${note})</small>` : ''}</td><td>${filled} / ${nf}</td><td>${done} / ${total}</td></tr>`;
  }).join('');
  $('#main').innerHTML = `
    <div class="eyebrow">You're done for now</div>
    <h1>Finish &amp; download</h1>
    <p class="goal">Well done. Here is everything you need to take your replication forward. Download your documents now: your work is only saved in this browser.</p>
    <div class="grid2">
      <div class="card action-card">
        <h3>1. Your replication plan</h3>
        <p>A formatted Word document with all your worksheet answers, checklists and the evidence behind them. Share it with your supervisor.</p>
        <button class="btn primary" id="finishPlan">Download plan (.docx)</button>
      </div>
      <div class="card action-card">
        <h3>2. Draft preregistration</h3>
        <p>Your answers turned into a preregistration in the Replication Recipe format. Gaps are highlighted for you to complete before registering on OSF.</p>
        <button class="btn primary" data-prereg>Download preregistration (.docx)</button>
      </div>
    </div>
    <h2>How complete is your plan?</h2>
    <div class="card"><table class="kv progress-table"><thead><tr><th>Stage</th><th>Fields answered</th><th>Checklist</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h2>Next steps</h2>
    <div class="card"><ol class="next-steps">
      <li>Discuss your plan with your supervisor or an expert, especially stages 1, 6 and 9.</li>
      <li>Complete the highlighted gaps in the preregistration and register it on <a href="https://osf.io/registries" target="_blank" rel="noopener">OSF Registries</a> (or submit a Registered Report).</li>
      <li>If you haven't yet, email the original authors (templates in Stage 3).</li>
      <li>After data collection, come back to Stage 10 to interpret and report your results, and log them in <a href="https://forrt-replications.shinyapps.io/fred_explorer/" target="_blank" rel="noopener">FReD</a>.</li>
    </ol>
    <p><small>To continue later on another device, <a href="#" id="finishBackup">download a backup file</a> and import it there via Settings.</small></p></div>
    <h2>Help us improve</h2>
    <div class="card"><p>Please take 4 minutes to tell us what worked and what didn't. Your feedback directly shapes the next version.</p><button class="btn" data-view="survey">Give feedback →</button></div>`;
  $('#coachStage').textContent = 'Finish';
  $('#finishPlan').addEventListener('click', exportPlan);
  $('#finishBackup').addEventListener('click', (e) => { e.preventDefault(); downloadBackup(); });
}

function renderAbout() {
  $('#main').innerHTML = `
    <div class="eyebrow">About</div>
    <h1>About Replication Navigator</h1>
    <div class="card">
      <p>Replication Navigator is an open-source, evidence-grounded guide and AI coach for planning replication and reproduction studies. It was developed for the Open Science Management (OSM) summit pilot.</p>
      <h3>How the coach is grounded</h3>
      <p>The coach may only use a curated evidence base of <strong>${K.cards.length} evidence cards</strong> drawn from ${K.sources.length} sources. Each card holds paraphrased guidance, a checklist action, and a short verbatim quote with its page number. A script checks automatically that every quote appears on the stated page. The coach must cite card ids, and the app flags any id that doesn't exist. Use the <a href="#" data-view="evidence">Evidence base</a> to browse everything the coach knows.</p>
      <h3>The process</h3>
      <p>The 10 stages follow the FORRT <em>Handbook for Reproduction and Replication Studies</em> and its checklist. Each stage adds specialist guidance: target selection (Isager et al.), purpose and publication (Obenauer), replication goals and analysis (Anderson &amp; Maxwell; Bonett), measurement (Flake et al.), documenting differences (Brandt et al.), theory (Irvine) and doctoral training (Schwab et al.).</p>
      <h3>Limits</h3>
      <p>The coach can make mistakes, including citing a card that doesn't quite support its claim. Please flag these with the card viewer. It doesn't replace expert supervision, especially at the expert check-points (stages 1, 6 and 9). The evidence base currently has little on qualitative replication.</p>
      <p><small>Model: ${esc(CONFIG.model || '')} · Knowledge: ${esc(CONFIG.knowledgeVersion || '')}</small></p>
    </div>`;
  $('#coachStage').textContent = 'About';
}

// ---------- coach ----------
function chatKey() { return S.view.startsWith('stage:') ? S.view.slice(6) : S.view; }
function renderChat() {
  const msgs = S.chats[chatKey()] || [];
  const chat = $('#chat');
  if (!msgs.length) {
    const st = currentStage();
    chat.innerHTML = `<div class="empty-chat">${st ? `<p>Hi! I'm your coach for <strong>${esc(st.title)}</strong>. I can see your worksheet${S.paper ? ' and the paper you uploaded' : ''}.</p><p>Ask me a specific question about your study, or fill in the worksheet and press <em>Review my worksheet</em>.</p>${(STARTERS[st.id] || []).map((q) => `<button class="starter" data-starter="${esc(q)}">${esc(q)}</button>`).join('')}` : '<p>Ask me anything about planning your replication.</p>'}</div>`;
    return;
  }
  chat.innerHTML = msgs.map((m, i) => {
    if (m.role === 'user') return m.hidden ? '' : `<div class="msg user">${esc(m.display || m.content)}</div>`;
    if (m.role === 'error') return `<div class="msg error">${esc(m.content)}</div>`;
    const r = S.msgRatings[m.id];
    const cont = m.stop === 'max_tokens' && i === msgs.length - 1 ? '<button class="btn small" data-continue>Continue ↓</button>' : '';
    return `<div class="msg assistant">${renderMarkdown(m.content)}${cont}
      <div class="msg-tools">Helpful? <button data-rate="up" data-i="${i}" class="${r === 'up' ? 'on' : ''}">👍</button><button data-rate="down" data-i="${i}" class="${r === 'down' ? 'on' : ''}">👎</button>
      ${m.unknown?.length ? `<span>⚠ ${m.unknown.length} citation(s) not in evidence base</span>` : ''}</div></div>`;
  }).join('');
  chat.scrollTop = chat.scrollHeight;
}

const STARTERS = {
  target: ['How do I find out if this study has already been replicated?', 'Is my reason for choosing this study strong enough?'],
  aim: ['Should we do a close or a conceptual replication?', 'Which replication goal fits what we want to show?'],
  materials: ['What should we ask the original authors for?', 'Some materials are missing. What can we do?'],
  reproduce: ['Do we need to reproduce the analysis if we have no data?', 'What is a seed and do we need one?'],
  measures: ['Is Cronbach\'s alpha enough to show our measure works?', 'We are translating the questionnaire. What should we check?'],
  sample: ['How do we find the original effect size?', 'How many participants do we need, roughly?'],
  differences: ['Which differences from the original matter most?'],
  prereg: ['Where should we preregister?', 'What exclusion rules are sensible for our study?'],
  analysis: ['How do we decide if the replication succeeded?', 'Our result might be non-significant. What then?'],
  report: ['How do we describe a failed replication fairly?']
};

let busy = false;
async function ask({ text, mode, cont }) {
  if (busy) return;
  const key = chatKey();
  const msgs = (S.chats[key] ||= []);
  const label = mode ? ($(`[data-mode="${mode}"]`)?.textContent || mode) : null;
  if (cont) msgs.push({ role: 'user', content: 'Please continue exactly where you stopped.', display: 'Continue', hidden: true });
  else if (text) msgs.push({ role: 'user', content: text });
  else if (mode) msgs.push({ role: 'user', content: `[${label}]`, display: label, mode });
  renderChat();
  busy = true; $('#sendBtn').disabled = true;
  $('#chat').insertAdjacentHTML('beforeend', '<div class="msg assistant live" id="liveMsg"><p class="typing">Coach is thinking…</p></div>');
  $('#chat').scrollTop = $('#chat').scrollHeight;

  const last = msgs[msgs.length - 1];
  const history = msgs.filter((m) => (m.role === 'user' || m.role === 'assistant') && !(m.mode && m === last))
    .map((m) => ({ role: m.role, content: m.mode ? `(I pressed "${m.display}")` : m.content }));
  const worksheet = key === 'recipe' ? { replicationRecipe: S.recipe } : { thisStage: S.worksheets[key] || {}, ratings: S.ratings[key] || {}, earlierStages: summariseEarlier(key) };
  const reply = { role: 'assistant', content: '', id: uid(), unknown: [] };
  try {
    const headers = { 'content-type': 'application/json' };
    if (apiKey()) headers['x-user-api-key'] = apiKey();
    const r = await fetch('/api/coach', { method: 'POST', headers, body: JSON.stringify({ stageId: currentStage()?.id || 'target', mode, messages: history, worksheet, profile: S.profile, paper: S.paper, sessionId: S.sessionId, participant: S.participant, consent: S.consent, accessCode: S.accessCode }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Request failed'); }
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''; let frame = null;
    const paint = () => { frame = null; const el = $('#liveMsg'); if (el) { el.innerHTML = renderMarkdown(reply.content) || '<p class="typing">Coach is thinking…</p>'; const c = $('#chat'); if (c.scrollHeight - c.scrollTop - c.clientHeight < 120) c.scrollTop = c.scrollHeight; } };
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === 'delta') { reply.content += ev.text; if (!frame) frame = requestAnimationFrame(paint); }
        else if (ev.type === 'done') { reply.unknown = ev.citations?.unknown || []; reply.stop = ev.stop; }
        else if (ev.type === 'error') throw new Error(ev.error);
      }
    }
    if (!reply.content) throw new Error('The coach returned an empty answer. Please try again.');
    msgs.push(reply);
  } catch (err) {
    if (reply.content) { reply.stop = 'max_tokens'; msgs.push(reply); }
    msgs.push({ role: 'error', content: err.message });
  } finally {
    busy = false; $('#sendBtn').disabled = false; save(); renderChat();
  }
}
function summariseEarlier(key) {
  const out = {};
  for (const s of K.stages) {
    if (s.id === key) break;
    const ws = S.worksheets[s.id];
    if (ws && Object.keys(ws).length) out[s.title] = ws;
  }
  return out;
}

// ---------- card dialog ----------
function openCard(id) {
  const c = cardById.get(id); if (!c) return;
  lastOpenedCitation = id;
  $('#cardBody').innerHTML = cardHtml(c).replace('class="card ecard"', 'class="ecard" style="padding-left:12px"');
  $('#flagCitation').textContent = "Flag: doesn't support the coach's claim";
  $('#flagCitation').disabled = false;
  $('#cardDialog').showModal();
  track('citation_open', currentStage()?.id, { card: id });
}

// ---------- export / import ----------
async function postDownload(url, body, fallbackName) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Download failed');
  const blob = await r.blob();
  const name = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || fallbackName;
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return r;
}
async function exportPlan() {
  try {
    await postDownload('/api/plan', { worksheets: S.worksheets, ratings: S.ratings, checklist: S.checklist, recipe: S.recipe, profile: S.profile, paper: S.paper, participant: S.participant, sessionId: S.sessionId, consent: S.consent }, 'replication-plan.docx');
    toast('Your replication plan was downloaded as a Word document.');
  } catch (err) { toast(esc(err.message)); }
}
function downloadBackup() {
  download(`replication-navigator-backup-${(S.participant || 'draft').replace(/[^A-Za-z0-9_-]/g, '')}.json`, JSON.stringify({ app: 'replication-navigator', version: 2, worksheets: S.worksheets, ratings: S.ratings, checklist: S.checklist, recipe: S.recipe, profile: S.profile, paper: S.paper }, null, 1), 'application/json');
}
async function exportPrereg() {
  const btns = $$('[data-prereg], #preregBtn');
  btns.forEach((b) => { b.disabled = true; });
  try {
    const r = await fetch('/api/prereg', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ worksheets: S.worksheets, recipe: S.recipe, participant: S.participant, sessionId: S.sessionId, consent: S.consent }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Export failed');
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `preregistration-${(S.participant || 'draft').replace(/[^A-Za-z0-9_-]/g, '') || 'draft'}.docx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    let c = {}; try { c = JSON.parse(r.headers.get('X-Prereg-Counts') || '{}'); } catch { /* ignore */ }
    if (c.missing !== undefined) toast(`<strong>Draft preregistration downloaded.</strong><br>${c.recipe} answers from your Replication Recipe · ${c.drafted} drafted from your worksheets (please check) · ${c.missing} still to complete (highlighted in yellow)`, 9000);
  } catch (err) {
    toast(esc(err.message));
  } finally {
    btns.forEach((b) => { b.disabled = false; });
  }
}
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- onboarding & settings ----------
function openWelcome() {
  $('#codeRow').hidden = !CONFIG.requiresAccessCode;
  $('#participantInput').value = S.participant;
  $('#welcome').showModal();
}
$('#welcomeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#codeInput').value.trim();
  if (CONFIG.requiresAccessCode && code) {
    const r = await fetch('/api/check-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!r.ok) { $('#welcomeError').textContent = 'That access code is not correct.'; return; }
  }
  S.participant = $('#participantInput').value.trim();
  S.accessCode = code;
  S.consent = new FormData(e.target).get('consent') === 'yes';
  S.onboarded = true; save();
  $('#welcome').close();
  track('session_start', null, { userAgent: navigator.userAgent.slice(0, 120), width: innerWidth });
  render();
  if (!S.screened) openScreener();
});

// ---------- setup screener ----------
function openScreener() {
  const f = $('#screenerForm');
  for (const [k, v] of Object.entries(S.profile || {})) { const el = f.querySelector(`input[name="${k}"][value="${v}"]`); if (el) el.checked = true; }
  $('#screener').showModal();
}
$('#screenerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  S.profile = { level: d.level || 'some', data: d.data || 'unsure', translate: d.translate || 'no', approach: d.approach || 'quantitative' };
  S.screened = true; save();
  $('#screener').close();
  track('screener', null, S.profile);
  render();
  toast(`Set up for you. Stages 1–9 should take about ${fmtMin(totalMinutes())}. You can change these answers in Settings.`);
});
$('#screenerSkip').addEventListener('click', () => { S.screened = true; save(); $('#screener').close(); render(); });

$('#settingsBtn').addEventListener('click', () => {
  $('#setParticipant').value = S.participant; $('#setCode').value = S.accessCode; $('#setKey').value = apiKey();
  $('#setConsent').checked = S.consent; $('#byoRow').hidden = !CONFIG.allowByoKey;
  $('#settings').showModal();
});
$('#saveSettings').addEventListener('click', () => {
  S.participant = $('#setParticipant').value.trim(); S.accessCode = $('#setCode').value.trim();
  setApiKey($('#setKey').value.trim()); S.consent = $('#setConsent').checked; save();
});
$('#changeSetup').addEventListener('click', () => { $('#settings').close(); openScreener(); });
$('#backupBtn').addEventListener('click', downloadBackup);
$('#resetBtn').addEventListener('click', () => {
  if (!confirm('Clear all your answers, checklist ticks and chats in this browser?')) return;
  S = { ...defaultState(), participant: S.participant, consent: S.consent, accessCode: S.accessCode, onboarded: true, profile: S.profile, screened: S.screened };
  save(); $('#settings').close(); render();
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'replication-navigator') throw new Error();
    Object.assign(S, { worksheets: d.worksheets || {}, ratings: d.ratings || {}, checklist: d.checklist || {}, recipe: d.recipe || {} });
    if (d.profile) { S.profile = d.profile; S.screened = true; }
    if (d.paper) S.paper = d.paper;
    save(); $('#settings').close(); render();
  } catch { alert('That file is not a Replication Navigator plan.'); }
});

// ---------- global events ----------
document.addEventListener('click', (e) => {
  const v = e.target.closest('[data-view]');
  if (v) { e.preventDefault(); go(v.dataset.view); return; }
  if (e.target.closest('[data-prereg]')) { exportPrereg(); return; }
  const term = e.target.closest('button.term[data-term]');
  if (term) { openTerm(term.dataset.term); return; }
  const hb = e.target.closest('[data-help]');
  if (hb) {
    const k = hb.dataset.help; const box = document.getElementById('help-' + k.replace('.', '-'));
    const open = box.hidden; box.hidden = !open; hb.setAttribute('aria-expanded', String(open)); S.openHelp[k] = open; save();
    if (open) track('help_open', currentStage()?.id, { field: k });
    return;
  }
  if (e.target.closest('[data-show-adv]')) { S.showAdvanced = true; save(); render(); return; }
  const st = e.target.closest('[data-starter]');
  if (st) { ask({ text: st.dataset.starter }); openCoachMobile(); return; }
  if (e.target.closest('[data-continue]')) { ask({ cont: true }); return; }
  const c = e.target.closest('button.cite[data-card]');
  if (c) { openCard(c.dataset.card); return; }
  const m = e.target.closest('[data-mode]');
  if (m && m.closest('#modes')) { ask({ mode: m.dataset.mode }); openCoachMobile(); return; }
  const ms = e.target.closest('[data-mode-shortcut]');
  if (ms) { ask({ mode: ms.dataset.modeShortcut }); openCoachMobile(); return; }
  const rt = e.target.closest('[data-rate]');
  if (rt) {
    const msg = (S.chats[chatKey()] || [])[Number(rt.dataset.i)];
    if (msg) { S.msgRatings[msg.id] = rt.dataset.rate; save(); renderChat(); track('rating', currentStage()?.id, { rating: rt.dataset.rate, reply: msg.content.slice(0, 4000) }); }
  }
});
$('#flagCitation').addEventListener('click', () => {
  const key = chatKey(); const msgs = S.chats[key] || [];
  const last = [...msgs].reverse().find((m) => m.role === 'assistant' && m.content.includes(`[${lastOpenedCitation}]`));
  track('citation_flag', currentStage()?.id, { card: lastOpenedCitation, reply: last ? last.content.slice(0, 4000) : null });
  $('#flagCitation').textContent = S.consent ? 'Flagged. Thank you!' : 'Noted (logging is off)';
  $('#flagCitation').disabled = true;
});
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault(); const t = $('#prompt').value.trim(); if (!t) return;
  $('#prompt').value = ''; ask({ text: t });
});
$('#prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });
$('#exportBtn').addEventListener('click', exportPlan);
$('#preregBtn').addEventListener('click', exportPrereg);
$('#evidenceBtn').addEventListener('click', () => go('evidence'));
$('#navToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
function openCoachMobile() { if (matchMedia('(max-width: 900px)').matches) $('#coach').classList.add('open'); }
$('#coachOpen').addEventListener('click', () => $('#coach').classList.add('open'));
$('#coachClose').addEventListener('click', () => $('#coach').classList.remove('open'));

// ---------- boot ----------
(async function boot() {
  load();
  try {
    [CONFIG, K] = await Promise.all([fetch('/api/config').then((r) => r.json()), fetch('/api/knowledge').then((r) => r.json())]);
  } catch {
    document.body.innerHTML = '<p style="padding:2rem">Could not load the app. Please refresh.</p>';
    return;
  }
  cardById = new Map(K.cards.map((c) => [c.id, c]));
  sourceByKey = new Map(K.sources.map((s) => [s.key, s]));
  initGlossary();
  render();
  if (!S.onboarded) openWelcome();
  else if (!S.screened) openScreener();
})();
