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
  view: 'stage:target', worksheets: {}, ratings: {}, checklist: {}, chats: {}, recipe: {}, survey: {}, surveySent: false, msgRatings: {}
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
  const done = stage.checklist.filter((_, i) => ticks[i]).length;
  return { done, total: stage.checklist.length };
}
function renderSidebar() {
  $('#stageList').innerHTML = K.stages.map((s) => {
    const { done, total } = stageProgress(s);
    const cls = done === total ? 'done' : done ? 'part' : '';
    const cur = S.view === `stage:${s.id}` ? 'aria-current="step"' : '';
    return `<li><button data-view="stage:${s.id}" ${cur}><span class="stage-num ${cls}">${done === total ? '✓' : s.n}</span><span class="stage-label">${esc(s.title)}</span></button></li>`;
  }).join('');
  $$('.side-link').forEach((b) => b.classList.toggle('active', S.view === b.dataset.view));
  let d = 0, t = 0;
  K.stages.forEach((s) => { const p = stageProgress(s); d += p.done; t += p.total; });
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
}

function render() {
  renderSidebar();
  const [kind, id] = S.view.split(':');
  if (kind === 'stage') renderStage(stageById(id) || K.stages[0]);
  else if (kind === 'recipe') renderRecipe();
  else if (kind === 'survey') renderSurvey();
  else if (kind === 'about') renderAbout();
  else if (kind === 'evidence') renderEvidence();
  renderChat();
}

function renderStage(stage) {
  const ws = S.worksheets[stage.id] || {};
  const rt = S.ratings[stage.id] || {};
  const ticks = S.checklist[stage.id] || [];
  const idx = K.stages.indexOf(stage);
  const prev = K.stages[idx - 1], next = K.stages[idx + 1];

  const fieldHtml = (f) => {
    const v = ws[f.id] ?? (f.type === 'checks' ? [] : '');
    let input = '';
    if (f.type === 'textarea') input = `<textarea id="f-${f.id}" data-field="${f.id}">${esc(v)}</textarea>`;
    else if (f.type === 'text') input = `<input type="text" id="f-${f.id}" data-field="${f.id}" value="${esc(v)}">`;
    else if (f.type === 'select') input = `<select id="f-${f.id}" data-field="${f.id}"><option value="">— choose —</option>${f.options.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (f.type === 'checks') input = `<div class="checks">${f.options.map((o) => `<label class="check"><input type="checkbox" data-multi="${f.id}" value="${esc(o)}" ${v.includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div>`;
    const rating = f.rating ? `<span class="rating" data-rating="${f.id}">Rate 1–5: ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-r="${n}" class="${rt[f.id] === n ? 'on' : ''}" aria-label="${n}">${n}</button>`).join('')}</span>` : '';
    const cites = (f.cards || []).map(citeChip).join('');
    const lab = f.type === 'checks' ? `<span class="flabel">${esc(f.label)}</span>` : `<label for="f-${f.id}">${esc(f.label)}</label>`;
    return `<div class="field">${lab}${input}<div class="field-meta">${rating}${cites ? `<small>Evidence:</small> ${cites}` : ''}</div></div>`;
  };

  $('#main').innerHTML = `
    <div class="eyebrow">Stage ${stage.n} of ${K.stages.length}</div>
    <h1>${esc(stage.title)}</h1>
    <p class="goal">${esc(stage.goal)}</p>
    ${stage.expert_review ? '<span class="expert">★ Expert check-point: have an expert review this stage before moving on</span>' : ''}
    <div class="card" style="margin-top:16px">
      <h3 style="margin-top:0">Questions to answer</h3>
      <ul class="questions">${stage.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
    </div>
    <h2>Worksheet</h2>
    <div class="card">${stage.fields.map(fieldHtml).join('')}
      ${stage.id === 'target' ? '<p><small>Ratings help you compare candidate targets. Isager et al. caution that scores support <em>ranking</em>, not precise ratios.</small> ' + citeChip('isager2021-24') + '</p>' : ''}
      ${stage.id === 'differences' ? `<p><small>For a full structured version, fill in the <a href="#" data-view="recipe">Replication Recipe</a> (Brandt et al., 2014).</small></p>` : ''}
    </div>
    <h2>Checklist</h2>
    <div class="card"><ul class="checklist">${stage.checklist.map((c, i) => `
      <li><input type="checkbox" id="ck-${i}" data-check="${i}" ${ticks[i] ? 'checked' : ''}>
      <label class="txt" for="ck-${i}">${esc(c.text)}</label><span>${c.cards.map(citeChip).join('')}</span></li>`).join('')}
    </ul></div>
    ${stage.templates ? `<h2>Templates</h2><div class="card">${stage.templates.map((id) => { const c = cardById.get(id); return `<p><strong>${esc(c.title)}</strong> ${citeChip(id)}<br><small>${esc(c.guidance)}</small></p>`; }).join('')}<button class="btn" data-mode-shortcut="email">Draft an email with the coach</button></div>` : ''}
    ${stage.id === 'prereg' ? `<h2>Draft your preregistration</h2><div class="card"><p>Download a draft preregistration in the <strong>Replication Recipe</strong> format (Brandt et al., 2014) as a Word document. It uses your answers on the <a href="#" data-view="recipe">Replication Recipe</a> page and fills any gaps from your stage worksheets. Gaps that are still empty are highlighted in yellow.</p><button class="btn primary" data-prereg>Download draft preregistration (.docx)</button></div>` : ''}
    <h2>Resources</h2>
    <div class="card"><ul class="resources">${stage.resources.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a></li>`).join('')}</ul></div>
    <div class="nav-row">
      ${prev ? `<button class="btn" data-view="stage:${prev.id}">← ${esc(prev.title)}</button>` : '<span></span>'}
      ${next ? `<button class="btn primary" data-view="stage:${next.id}">${esc(next.title)} →</button>` : `<button class="btn primary" data-view="survey">Finish: give feedback →</button>`}
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
    chat.innerHTML = `<p class="empty-chat">${st ? `Hi! I'm your coach for <strong>${esc(st.title)}</strong>. Start with <em>Explain this stage</em>, or fill in the worksheet and ask me to <em>Review</em> it.` : 'Ask me anything about planning your replication.'}</p>`;
    return;
  }
  chat.innerHTML = msgs.map((m, i) => {
    if (m.role === 'user') return `<div class="msg user">${esc(m.display || m.content)}</div>`;
    if (m.role === 'error') return `<div class="msg error">${esc(m.content)}</div>`;
    const r = S.msgRatings[m.id];
    return `<div class="msg assistant">${renderMarkdown(m.content)}
      <div class="msg-tools">Helpful? <button data-rate="up" data-i="${i}" class="${r === 'up' ? 'on' : ''}">👍</button><button data-rate="down" data-i="${i}" class="${r === 'down' ? 'on' : ''}">👎</button>
      ${m.unknown?.length ? `<span>⚠ ${m.unknown.length} citation(s) not in evidence base</span>` : ''}</div></div>`;
  }).join('');
  chat.scrollTop = chat.scrollHeight;
}

let busy = false;
async function ask({ text, mode }) {
  if (busy) return;
  const key = chatKey();
  const msgs = (S.chats[key] ||= []);
  const label = mode ? $(`[data-mode="${mode}"]`)?.textContent : null;
  if (text) msgs.push({ role: 'user', content: text });
  else if (mode) msgs.push({ role: 'user', content: `[${label}]`, display: label, mode });
  renderChat();
  busy = true; $('#sendBtn').disabled = true;
  $('#chat').insertAdjacentHTML('beforeend', '<p class="typing" id="typing">Coach is thinking…</p>');
  $('#chat').scrollTop = $('#chat').scrollHeight;

  const history = msgs.filter((m) => m.role === 'user' || m.role === 'assistant').filter((m) => !m.mode || m !== msgs[msgs.length - 1]).map((m) => ({ role: m.role, content: m.mode ? `(I pressed "${m.display}")` : m.content }));
  const worksheet = key === 'recipe' ? { replicationRecipe: S.recipe } : { thisStage: S.worksheets[key] || {}, ratings: S.ratings[key] || {}, earlierStages: summariseEarlier(key) };
  try {
    const headers = { 'content-type': 'application/json' };
    if (apiKey()) headers['x-user-api-key'] = apiKey();
    const r = await fetch('/api/coach', { method: 'POST', headers, body: JSON.stringify({ stageId: currentStage()?.id || 'target', mode, messages: history, worksheet, sessionId: S.sessionId, participant: S.participant, consent: S.consent, accessCode: S.accessCode }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Request failed');
    msgs.push({ role: 'assistant', content: data.text, id: uid(), unknown: data.citations?.unknown || [] });
  } catch (err) {
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
function exportPlan() {
  const lines = [`# Replication plan`, '', `Generated with Replication Navigator (${new Date().toISOString().slice(0, 10)}). Participant: ${S.participant || '—'}`, ''];
  const cited = new Set();
  for (const s of K.stages) {
    const ws = S.worksheets[s.id] || {}, rt = S.ratings[s.id] || {}, ticks = S.checklist[s.id] || [];
    lines.push(`## ${s.n}. ${s.title}`, '');
    for (const f of s.fields) {
      const v = Array.isArray(ws[f.id]) ? ws[f.id].join('; ') : ws[f.id];
      lines.push(`**${f.label}**${rt[f.id] ? ` (rating ${rt[f.id]}/5)` : ''}`, '', v ? String(v) : '_(not yet completed)_', '');
    }
    lines.push('**Checklist**', '');
    s.checklist.forEach((c, i) => { lines.push(`- [${ticks[i] ? 'x' : ' '}] ${c.text} (${c.cards.join(', ')})`); c.cards.forEach((x) => cited.add(x)); });
    lines.push('');
  }
  if (Object.values(S.recipe).some(Boolean)) {
    lines.push('## Replication Recipe (Brandt et al., 2014)', '');
    K.recipe.forEach((q) => { if (S.recipe[q.n]) lines.push(`${q.n}. ${q.text}`, `   ${S.recipe[q.n]}`, ''); });
  }
  lines.push('## Evidence cards referenced', '');
  [...cited].sort().forEach((id) => { const c = cardById.get(id); lines.push(`- **${id}**: ${c.title} (${cardLabel(c)})`); });
  lines.push('', '## Sources', '');
  K.sources.forEach((s) => lines.push(`- ${s.citation} ${s.url}`));
  download(`replication-plan-${S.participant || 'draft'}.md`, lines.join('\n'), 'text/markdown');
  download(`replication-plan-${S.participant || 'draft'}.json`, JSON.stringify({ app: 'replication-navigator', version: 1, worksheets: S.worksheets, ratings: S.ratings, checklist: S.checklist, recipe: S.recipe }, null, 1), 'application/json');
  track('export', null, { worksheets: S.worksheets, ratings: S.ratings, checklist: S.checklist, recipe: S.recipe });
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
    if (c.missing !== undefined) alert(`Draft preregistration downloaded.\n\n${c.recipe} answers from your Replication Recipe\n${c.drafted} drafted from your worksheets (please check)\n${c.missing} still to complete (highlighted in yellow)`);
  } catch (err) {
    alert(err.message);
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
});

$('#settingsBtn').addEventListener('click', () => {
  $('#setParticipant').value = S.participant; $('#setCode').value = S.accessCode; $('#setKey').value = apiKey();
  $('#setConsent').checked = S.consent; $('#byoRow').hidden = !CONFIG.allowByoKey;
  $('#settings').showModal();
});
$('#saveSettings').addEventListener('click', () => {
  S.participant = $('#setParticipant').value.trim(); S.accessCode = $('#setCode').value.trim();
  setApiKey($('#setKey').value.trim()); S.consent = $('#setConsent').checked; save();
});
$('#resetBtn').addEventListener('click', () => {
  if (!confirm('Clear all your answers, checklist ticks and chats in this browser?')) return;
  S = { ...defaultState(), participant: S.participant, consent: S.consent, accessCode: S.accessCode, onboarded: true };
  save(); $('#settings').close(); render();
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'replication-navigator') throw new Error();
    Object.assign(S, { worksheets: d.worksheets || {}, ratings: d.ratings || {}, checklist: d.checklist || {}, recipe: d.recipe || {} });
    save(); $('#settings').close(); render();
  } catch { alert('That file is not a Replication Navigator plan.'); }
});

// ---------- global events ----------
document.addEventListener('click', (e) => {
  const v = e.target.closest('[data-view]');
  if (v) { e.preventDefault(); go(v.dataset.view); return; }
  if (e.target.closest('[data-prereg]')) { exportPrereg(); return; }
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
  render();
  if (!S.onboarded) openWelcome();
})();
