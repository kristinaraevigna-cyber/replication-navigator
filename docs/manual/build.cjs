// Builds the participant manual (Word) from the Replication Navigator knowledge base.
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, LevelFormat, Footer, Header, PageNumber, TableOfContents,
  PageBreak, ExternalHyperlink, TabStopType, LineRuleType
} = require('docx');

const KB = path.join(__dirname, '..', '..', 'knowledge');
const cards = JSON.parse(fs.readFileSync(path.join(KB, 'evidence-cards.json')));
const stages = JSON.parse(fs.readFileSync(path.join(KB, 'stages.json')));
const sources = JSON.parse(fs.readFileSync(path.join(KB, 'sources.json')));
const C = Object.fromEntries(cards.map((c) => [c.id, c]));
const SRC = Object.fromEntries(sources.map((s) => [s.key, s]));

const ACCENT = '245C73', MUTED = '5D6870', SOFT = 'E2EEF2', WARN_SOFT = 'FBF0DF', WARN = '9A5B12', OK_SOFT = 'E3F1E8';
const PAGE_W = 11906, MARGIN = 1134, CONTENT_W = PAGE_W - 2 * MARGIN; // A4, 2 cm margins

// ---------- helpers ----------
const t = (text, o = {}) => new TextRun({ text, ...o });
const P = (children, o = {}) => new Paragraph({ children: Array.isArray(children) ? children : [t(children)], spacing: { after: 120 }, ...o });
const H1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t(text)], pageBreakBefore: true });
const H2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, children: [t(text)] });
const H3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, keepNext: true, children: [t(text)] });
const bullet = (children, level = 0) => new Paragraph({ numbering: { reference: 'bullets', level }, children: Array.isArray(children) ? children : [t(children)], spacing: { after: 60 } });
let numRef = 0;
const numbered = (items) => { const ref = `num${numRef++}`; numberingConfigs.push({ reference: ref, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] }); return items.map((it) => new Paragraph({ numbering: { reference: ref, level: 0 }, children: Array.isArray(it) ? it : [t(it)], spacing: { after: 60 } })); };
const checkbox = (text, cite) => new Paragraph({ children: [t('☐  ', { size: 24 }), t(text), ...(cite ? [t(`  ${cite}`, { color: MUTED, size: 16 })] : [])], spacing: { after: 80 }, indent: { left: 360, hanging: 360 } });
const link = (text, url) => new ExternalHyperlink({ link: url, children: [t(text, { style: 'Hyperlink' })] });
const numberingConfigs = [{ reference: 'bullets', levels: [
  { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } },
  { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1000, hanging: 300 } } } }] }];

const border = { style: BorderStyle.SINGLE, size: 4, color: 'DEDBD2' };
const borders = { top: border, bottom: border, left: border, right: border };
function box(children, fill = SOFT, title) {
  const kids = [];
  if (title) kids.push(new Paragraph({ children: [t(title, { bold: true, color: fill === WARN_SOFT ? WARN : ACCENT })], spacing: { after: 80 } }));
  kids.push(...children);
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: [CONTENT_W], rows: [new TableRow({ cantSplit: true, children: [new TableCell({ width: { size: CONTENT_W, type: WidthType.DXA }, shading: { fill, type: ShadingType.CLEAR, color: 'auto' }, borders: { top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: BorderStyle.SINGLE, size: 24, color: fill === WARN_SOFT ? WARN : ACCENT } }, margins: { top: 140, bottom: 140, left: 220, right: 220 }, children: kids })] })] });
}
function table(headers, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (content, i, head) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, borders,
    shading: head ? { fill: ACCENT, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: (Array.isArray(content) ? content : [content]).map((c) => typeof c === 'string' ? new Paragraph({ children: [t(c, head ? { bold: true, color: 'FFFFFF' } : {})] }) : c)
  });
  return new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: widths, rows: [
    new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, i) => cell(h, i, true)) }),
    ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) }))] });
}
const spacer = () => new Paragraph({ children: [], spacing: { after: 120 } });
function srcLabel(c) {
  const s = SRC[c.source];
  return `${s.short}, ${c.printed_page ? 'p. ' + c.printed_page : 'PDF p. ' + c.pdf_page}`;
}
// Evidence recommendation: bold title, guidance, grey source + card id
function rec(id) {
  const c = C[id]; if (!c) throw new Error('missing card ' + id);
  return new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 100 }, children: [
    t(c.title + '. ', { bold: true }), t(c.guidance + ' '), t(`(${srcLabel(c)}; card ${c.id})`, { color: MUTED, size: 17 })] });
}

// ---------- content ----------
const GENERAL = process.env.AUDIENCE === 'general';
const DOC_NAME = GENERAL ? 'User Guide' : 'Participant Manual';
const doc = [];

// Cover
doc.push(new Paragraph({ spacing: { before: 3200, after: 240, line: 240, lineRule: LineRuleType.AUTO }, children: [t(GENERAL ? 'USER GUIDE' : 'OSM SUMMIT 2026 · PARTICIPANT MANUAL', { color: ACCENT, bold: true, size: 20, characterSpacing: 40 })] }));
doc.push(new Paragraph({ spacing: { after: 200, line: 240, lineRule: LineRuleType.AUTO }, children: [t('Replication Navigator', { bold: true, size: 64, font: 'Georgia' })] }));
doc.push(new Paragraph({ spacing: { after: 600 }, children: [t('User guide, replication handbook and resource pack', { size: 32, color: MUTED, font: 'Georgia' })] }));
doc.push(box([
  ...(GENERAL ? [] : [P([t('App address:  ', { bold: true }), t('[insert app address]')])]),
  P([t('No sign-in needed. ', { bold: true }), t(GENERAL ? 'Open Replication Navigator in your browser, answer four quick questions and start. It is free and open access.' : 'Open the address (or scan the QR code), answer four quick questions and start.')], { spacing: { after: 0 } })
], SOFT, GENERAL ? 'Getting started' : 'Keep this page handy'));
doc.push(new Paragraph({ spacing: { before: 1400 }, children: [t('Version 0.2 · October 2026 · Built on 322 evidence cards drawn from nine key sources on replication', { color: MUTED, size: 18 })] }));

// TOC
doc.push(new Paragraph({ pageBreakBefore: true, children: [t('Contents', { bold: true, size: 36, font: 'Georgia', color: ACCENT })], spacing: { after: 240 } }));
doc.push(new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }));
doc.push(P([t('If page numbers are missing, right-click the table and choose “Update field”.', { italics: true, color: MUTED, size: 18 })]));

// 1. Quick start
doc.push(H1('1. Quick start'));
doc.push(P('Everything you need to get going in five minutes. Planning stages 1–9 takes about 1½–2 hours, less if some stages do not apply to you. The rest of this manual explains each part in more detail.'));
doc.push(...numbered([
  [t('Open the app ', { bold: true }), t(GENERAL ? 'in your web browser, ideally on a laptop. There is no sign-in and no account.' : 'by scanning the QR code or typing the app address, ideally on a laptop. There is no sign-in and no code to type.')],
  [t('Answer four quick questions on the start screen ', { bold: true }), t('(your experience, whether the original data are available, whether you translate materials, quantitative or qualitative). The tool hides what you do not need and adjusts how much it explains.')],
  [t('Tick the research box if you are happy to help. ', { bold: true }), t('It is optional and the tool works fully either way. See section 9.')],
  [t('Optional: upload the paper you are replicating ', { bold: true }), t('on Stage 1. The AI pulls out the sample size, effect size, design and measures to pre-fill your worksheets, and the coach tailors its advice to that study.')],
  [t('Work through the stages. ', { bold: true }), t('Each stage starts with a plain-language explanation. Click “?” next to a field for help, and click any underlined term for a short definition.')],
  [t('Check the evidence. ', { bold: true }), t('Click any grey-blue citation label (e.g. isager2021-02) to see the source, page and exact quote behind the coach’s advice.')],
  [t('Finish & download. ', { bold: true }), t('At the end, “Finish & download” (in the sidebar) gives you your plan and a draft preregistration as Word documents. Then fill in the short feedback survey.')]
]));
doc.push(spacer());
doc.push(box([
  bullet('Your work is saved automatically in your browser, but only on that device and browser. Export regularly.'),
  bullet('The first coach reply of the day can take up to a minute while the server wakes up. After that, replies start appearing within a few seconds.'),
  bullet('The coach can be wrong. Treat it as a well-read colleague, not an authority, and check citations and key decisions with an expert.')
], WARN_SOFT, 'Three things to remember'));

// 2. About
doc.push(H1('2. What Replication Navigator is'));
doc.push(P('Replication Navigator is a step-by-step guide and AI coach for planning a rigorous replication or reproduction study. It turns the best available guidance on replication into ten practical stages. Each stage has a worksheet, a checklist, resources and a coach. By the end you have a written replication plan that you can discuss with a supervisor, turn into a preregistration, or develop into a paper.'));
doc.push(H2('Why an “evidence-grounded” coach?'));
doc.push(P('General chatbots answer from everything they were trained on, so you cannot tell where their advice comes from. This coach is different: it may only use a curated evidence base of 322 evidence cards drawn from nine sources on replication, and it must cite the card behind every recommendation. Each card contains:'));
doc.push(bullet([t('a short piece of guidance, ', { bold: true }), t('paraphrased in plain language;')]));
doc.push(bullet([t('an action ', { bold: true }), t('you can tick off;')]));
doc.push(bullet([t('a short verbatim quote ', { bold: true }), t('from the source, with its page number, so you can check it.')]));
doc.push(P('Every quote has been automatically checked against the original PDF. If the evidence base does not cover a question, the coach is instructed to say so rather than improvise.'));
doc.push(H2('The nine sources'));
doc.push(table(['Source', 'What it contributes'], [
  ['Röseler, Wallrich et al. (2025). FORRT Handbook for Reproduction and Replication Studies', 'The backbone of the process, from choosing a target to publishing, plus the 10-item checklist and email templates'],
  ['Isager et al. (2023). Deciding what to replicate', 'How to choose a target: value, uncertainty, costs'],
  ['Obenauer (2024). Designing, executing, and publishing replication research', 'Practical advice from purpose to publication, especially in management'],
  ['Anderson & Maxwell (2016). There’s more than one way to conduct a replication study', 'Six different replication goals and the analysis each one needs'],
  ['Bonett (2021). Design and analysis of replication studies', 'Sample size, equivalence tests and confidence-interval criteria'],
  ['Brandt et al. (2014). The Replication Recipe', 'What makes a replication convincing; the 36-question template'],
  ['Flake, Davidson, Wong & Pek (2022). Construct validity and the validity of replication studies', 'Measurement and construct validity in replications'],
  ['Irvine (2021). The role of replication studies in theory building', 'How replications connect to theory'],
  ['Schwab et al. (2023). How replication studies can improve doctoral student education', 'Replication as training for doctoral researchers']
], [4300, CONTENT_W - 4300]));
doc.push(spacer());
doc.push(P('Full references with DOIs are in section 8.'));

// 3. Platform tour
doc.push(H1('3. Using the platform'));
doc.push(H2('The screen at a glance'));
doc.push(table(['Area', 'What it does'], [
  ['Left sidebar', 'The ten stages with a time estimate for each (stages that don’t apply to you are greyed out). A number turns into a tick when all checklist items are done. Below: Finish & download, Replication Recipe, Evidence base, Feedback survey, About.'],
  ['Top bar', 'Overall progress, Evidence base, Export plan, Preregistration and Settings.'],
  ['Centre', 'The current stage: a plain-language explanation, worksheet, checklist, templates and resources.'],
  ['Right panel', 'The AI coach. On a phone, open it with the “Ask the coach” button.']
], [2200, CONTENT_W - 2200]));
doc.push(H2('Each stage page'));
doc.push(bullet([t('What this stage is about: ', { bold: true }), t('a short plain-language explanation of what you decide and why it matters, with the key questions underneath.')]));
doc.push(bullet([t('Worksheet: ', { bold: true }), t('fields for your decisions. Click “?” for an explanation and an example. Underlined terms open a one-sentence definition. Fields marked “optional” add detail; newcomers see them only on request. “Evidence” labels link to the cards behind each field.')]));
doc.push(bullet([t('Checklist: ', { bold: true }), t('tick items when your team has genuinely done them. Each item is in plain language, with the wording used in the literature underneath and links to its evidence.')]));
doc.push(bullet([t('Templates: ', { bold: true }), t('in stages 3 and 10, email templates for contacting the original authors.')]));
doc.push(bullet([t('Resources: ', { bold: true }), t('links to databases, tools and registries.')]));
doc.push(bullet([t('Expert check-points: ', { bold: true }), t('stages 1, 6 and 9 carry a ★ badge. Ask an expert to review your decisions before moving on.')]));
doc.push(H2('Working with the AI coach'));
doc.push(P('Ask your own question, click one of the suggested questions, or use the buttons at the top of the coach panel. The coach sees your worksheet for the current stage, a summary of earlier stages, your setup answers and (if you uploaded it) a summary of your target paper. It answers your question first and keeps replies short; ask it to go deeper if you want more. Replies appear word by word as they are written. If a long reply stops early, click “Continue”.'));
doc.push(table(['Button', 'Use it when'], [
  ['Review my worksheet', 'You have written something and want the 2–3 most important problems named, with concrete fixes.'],
  ['What am I missing?', 'You want the most common pitfalls checked against your plan.'],
  ['Challenge me', 'You want a critical but fair “reviewer” to test your choices.'],
  ['Draft author email', 'Stages 3 and 10: drafts an email to the original authors from the template.']
], [2600, CONTENT_W - 2600]));
doc.push(spacer());
doc.push(H3('Good questions to ask'));
['“Is my justification for this target strong enough? What would a reviewer say?”',
 '“Which replication goal fits what we want to show, and what does that mean for our analysis?”',
 '“We plan to translate the scale into Italian. What should we check?”',
 '“Our original study had N = 60. How should we think about our sample size?”',
 '“How should we word our conclusion if the effect is smaller but still positive?”'].forEach((q) => doc.push(bullet(q)));
doc.push(H3('Checking citations'));
doc.push(P('Every recommendation should end with one or more citation labels, such as isager2021-02. Click a label to open the card: its guidance, the exact quote, the source and the page. If a card does not actually support what the coach said, click “Flag: doesn’t support the coach’s claim”. Flags are valuable data for improving the tool. A label that is struck through means the coach cited a card that does not exist, so treat that statement with extra caution.'));
doc.push(box([
  bullet('It can misread your situation or cite a card that only partly supports its point.'),
  bullet('It will not calculate your sample size for you. It explains which approach to use and points to tools.'),
  bullet(GENERAL ? 'It knows little about qualitative replication. For those questions, ask a supervisor or methods expert.' : 'It knows little about qualitative replication. For those questions, ask the experts.'),
  bullet('Do not paste personal or confidential data into the coach.')
], WARN_SOFT, 'What the coach cannot do'));
doc.push(H2('Other features'));
doc.push(bullet([t('Replication Recipe: ', { bold: true }), t('the full 36-question template from Brandt et al. (2014). Filling it in gives you most of a preregistration. Your answers are included when you export.')]));
doc.push(bullet([t('Preregistration: ', { bold: true }), t('the “Preregistration” button (top bar, Stage 8 and the Replication Recipe page) downloads a draft preregistration as a Word document in the Replication Recipe format. It uses your Recipe answers and fills blanks from your stage worksheets. Drafted answers are marked “check and edit”; questions still empty are highlighted in yellow. Review everything with your supervisor, then copy it into the Replication Recipe template on OSF Registries.')]));
doc.push(bullet([t('Evidence base: ', { bold: true }), t('search and filter all 322 cards by stage and source. Useful for reading around a topic.')]));
doc.push(bullet([t('Export plan: ', { bold: true }), t('downloads your whole plan as a formatted Word document: an overview of progress, all your answers stage by stage, your checklists, your Replication Recipe answers, next steps and the evidence cards referenced.')]));
doc.push(bullet([t('Finish & download: ', { bold: true }), t('a final page with your plan, your draft preregistration, a completeness overview, next steps and the feedback survey.')]));
doc.push(bullet([t('Upload your target paper: ', { bold: true }), t('on Stage 1. The PDF is sent to the AI service only to extract the key details and is not stored. Always check the extracted details against the paper.')]));
doc.push(bullet([t('Settings: ', { bold: true }), t('change your setup answers, switch research logging on or off, download or import a backup (.json), or start over.')]));
doc.push(bullet([t('Feedback survey: ', { bold: true }), t(GENERAL ? 'a four-minute questionnaire. Your feedback shapes the next version.' : 'a four-minute questionnaire at the end of the session.')]));
doc.push(H2('Saving and moving your work'));
doc.push(P('Your answers are stored in your browser as you type. They stay there if you close the tab, but they do not follow you to another device or browser, and clearing your browser data deletes them. To continue elsewhere, go to Settings → Download backup, then on the new device go to Settings → Import plan and choose the .json file.'));
doc.push(H2('Working as a team'));
doc.push(P('Teams work best with one person “driving” the app on a shared screen while the others read the cited cards, check the sources and challenge decisions. Replications are well suited to collaborative student teams, where members can debate how to implement the study and what to infer from it.'));
doc.push(rec('schwab2023-31'));

if (GENERAL) {
// 4. Ways to use it
doc.push(H1('4. Ways to use Replication Navigator'));
doc.push(P('Stages 1–9 take about 1½–2 hours in total. You do not have to do them in one sitting: your work is saved in your browser, so you can stop after any stage and come back on the same device.'));
doc.push(table(['Situation', 'Suggested approach'], [
  ['On your own (e.g. a PhD student planning a replication)', 'Upload the paper you are replicating on Stage 1, then work through one or two stages per session. Use “Review my worksheet” before moving on, and take your exported plan to your supervisor at the expert check-points (stages 1, 6 and 9).'],
  ['As a team', 'One person “drives” on a shared screen while the others read the cited evidence and challenge decisions. Export the plan at the end of each session and share it with the team.'],
  ['In a course or workshop', 'Give each team one pre-selected target study so time goes into the process rather than the search. Plan about two hours for stages 1–9, and have an expert visit each team at the check-points. Ask teams to put their team name in the file name of the exported plan.'],
  ['After data collection', 'Come back to Stage 10 to interpret and report your results, invite the original authors to comment, and log your replication in FReD.']
], [3000, CONTENT_W - 3000]));
doc.push(spacer());

} else {
// 4. Session plan
doc.push(H1('4. The summit session'));
doc.push(table(['Time', 'What happens'], [
  ['0–10 min', 'Welcome, information sheet, open the tool via QR code'],
  ['10–20 min', 'Demo: one stage, the coach, and how to check a citation'],
  ['20–45 min', 'Stages 1–3: target, aim, materials (★ expert check-point after stage 1)'],
  ['45–70 min', 'Stages 4–7: reproduce, measurement, sample size (★ after stage 6), differences'],
  ['70–95 min', 'Stages 8–9: preregistration, analysis and success criteria (★ after stage 9)'],
  ['95–105 min', 'Finish & download: save your plan and draft preregistration, and upload the plan to the shared folder'],
  ['105–115 min', 'Feedback survey (sidebar → Feedback survey)'],
  ['115–120 min', 'Plenary: what worked, what didn’t']
], [2000, CONTENT_W - 2000]));
doc.push(spacer());
doc.push(P('Each team works on a pre-selected target study, so the time goes into the process rather than the search. Stage 10 (reporting) is for after the summit, once you have data.'));

}
// 5. Stage-by-stage handbook
doc.push(H1('5. The replication process, stage by stage'));
doc.push(P('This section is a portable version of the ten stages. For each stage you will find its goal, the key recommendations and pitfalls from the evidence base (with source, page and card id so you can find the card in the app), the checklist, and the main resources.'));

const STAGE_RECS = {
  target: { do: ['forrt2025-09', 'isager2021-02', 'isager2021-08', 'forrt2025-15', 'obenauer2024-12'], avoid: ['isager2021-07', 'isager2021-13', 'forrt2025-16', 'isager2021-24'] },
  aim: { do: ['obenauer2024-03', 'anderson2016-01', 'forrt2025-05', 'forrt2025-24'], avoid: ['forrt2025-04', 'brandt2014-25'] },
  materials: { do: ['brandt2014-06', 'forrt2025-26', 'brandt2014-07', 'forrt2025-18'], avoid: ['schwab2023-07'] },
  reproduce: { do: ['forrt2025-19', 'forrt2025-27', 'forrt2025-29', 'forrt2025-22'], avoid: ['forrt2025-20'] },
  measures: { do: ['flake2023-02', 'flake2023-11', 'forrt2025-42'], avoid: ['flake2023-05', 'flake2023-19', 'flake2023-23'] },
  sample: { do: ['bonett2021-19', 'forrt2025-36', 'forrt2025-37', 'anderson2016-15'], avoid: ['forrt2025-34', 'anderson2016-13', 'bonett2021-13', 'forrt2025-45'] },
  differences: { do: ['brandt2014-13', 'brandt2014-14', 'forrt2025-121', 'schwab2023-04'], avoid: ['flake2023-15', 'irvine2021-07'] },
  prereg: { do: ['forrt2025-31', 'obenauer2024-22', 'obenauer2024-20', 'forrt2025-108'], avoid: ['forrt2025-33'] },
  analysis: { do: ['anderson2016-02', 'brandt2014-18', 'forrt2025-106', 'bonett2021-07'], avoid: ['bonett2021-06', 'anderson2016-07', 'anderson2016-22', 'bonett2021-02'] },
  report: { do: ['forrt2025-125', 'obenauer2024-25', 'forrt2025-123', 'brandt2014-23', 'forrt2025-126'], avoid: ['obenauer2024-34', 'forrt2025-119', 'forrt2025-120', 'anderson2016-23'] }
};
const OUTPUT = {
  target: 'A named target study and claim, with a written rationale covering value, uncertainty, feasibility and existing replications.',
  aim: 'A stated purpose, replication type and replication goal (1–6) that will drive your sample size and analysis.',
  materials: 'A materials inventory, a log of contact with the original authors, and a record of how gaps were filled.',
  reproduce: 'A reproduction of the original result (or a reason why that is not possible), with software versions documented.',
  measures: 'A summary of validity evidence for each key measure, and the checks you will run in your own data.',
  sample: 'A planned sample size with a full justification that fits your replication goal.',
  differences: 'A table of every difference from the original (Exact / Close / Different) and which ones might matter.',
  prereg: 'A preregistration or Registered Report plan covering hypotheses, exclusions, analyses, success criteria and contingencies.',
  analysis: 'A primary analysis matched to your goal, and success / failure / inconclusive criteria fixed in advance.',
  report: 'A balanced interpretation, open materials and data, comments invited from the original authors, and a target outlet.'
};
for (const s of stages) {
  doc.push(new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: s.n === 1 ? 300 : 520, after: 140 }, border: s.n === 1 ? undefined : { top: { style: BorderStyle.SINGLE, size: 6, color: 'DEDBD2', space: 12 } }, children: [t(`Stage ${s.n}. ${s.title}`)] }));
  if (s.expert_review) doc.push(P([t('★ Expert check-point: ', { bold: true, color: WARN }), t('have an expert review your decisions before moving on.', { color: WARN })]));
  doc.push(P([t('Goal. ', { bold: true }), t(s.goal)]));
  doc.push(P([t('Output of this stage. ', { bold: true }), t(OUTPUT[s.id])]));
  doc.push(H3('Questions to answer'));
  s.questions.forEach((q) => doc.push(bullet(q)));
  doc.push(H3('Key recommendations'));
  STAGE_RECS[s.id].do.forEach((id) => doc.push(rec(id)));
  doc.push(H3('Pitfalls to avoid'));
  STAGE_RECS[s.id].avoid.forEach((id) => doc.push(rec(id)));
  doc.push(H3('Checklist'));
  s.checklist.forEach((c) => doc.push(checkbox(c.text, c.cards.join(', '))));
  doc.push(H3('Resources'));
  s.resources.forEach((r) => doc.push(bullet([link(r.label, r.url)])));
}

// 6. Quick reference
doc.push(H1('6. Quick-reference tables'));
doc.push(H2('Key terms'));
doc.push(table(['Term', 'Meaning'], [
  ['Reproduction', 'Re-running the original analysis on the original data. It tests whether the reported result follows from the data.'],
  ['Replication', 'Repeating the study with new data. It tests whether the finding holds again.'],
  ['Close (direct, literal) replication', 'As similar to the original as possible. It tests the credibility of the original finding.'],
  ['Conceptual (constructive) replication', 'Tests the same claim with deliberately different methods, samples or settings. It tests generalisability.'],
  ['Replication-extension', 'A close replication plus added conditions or measures that extend the original.'],
  ['Replication value', 'How much a replication could add: the value of knowing the claim’s truth combined with how uncertain the current evidence is (Isager et al.).'],
  ['SESOI', 'Smallest effect size of interest: the smallest effect you would consider meaningful. It is needed for equivalence tests.'],
  ['Equivalence test (TOST)', 'Tests whether an effect is small enough to be considered negligible, using two one-sided tests.'],
  ['Small telescopes', 'Tests whether the replication rules out an effect the original study could have reliably detected. A common rule of thumb is a sample about 2.5 times the original.'],
  ['Preregistration / Registered Report', 'Fixing your hypotheses and analysis plan before seeing the data. A Registered Report is peer-reviewed and accepted in principle before data collection.']
], [3000, CONTENT_W - 3000]));
doc.push(spacer());
doc.push(H2('Six replication goals (Anderson & Maxwell, 2016)'));
doc.push(P('Decide your goal in Stage 2. It determines your sample size in Stage 6 and your analysis in Stage 9.'));
doc.push(table(['Goal', 'Analysis', 'Success looks like'], [
  ['1. Show the effect exists', 'Repeat the original analysis', 'Significant effect in the same direction'],
  ['2. Show the effect is absent or negligible', 'Equivalence test (TOST, 90% CI) or Bayes factor', 'CI lies entirely inside a region of equivalence set in advance'],
  ['3. Estimate the effect size precisely', 'Plan for precision (AIPE); report a CI around the effect', 'A CI narrow enough to be informative'],
  ['4. Combine with the original', 'Small meta-analysis of original + replication', 'A pooled estimate and CI (pooling does not fix publication bias)'],
  ['5. Show the results are clearly inconsistent', 'CI for the difference between the two effect sizes', 'The CI for the difference excludes 0'],
  ['6. Show the results are clearly consistent', 'Equivalence test on the difference in effect sizes', 'The difference is within equivalence bounds']
], [2800, 3400, CONTENT_W - 6200]));
doc.push(P([t(`Source: ${srcLabel(C['anderson2016-02'])}; card anderson2016-02.`, { color: MUTED, size: 17 })]));
doc.push(H2('Sample-size approaches'));
doc.push(table(['Approach', 'When to use it', 'Card'], [
  ['Power for a conservative effect size', 'Goal 1, when the original effect is likely inflated', 'bonett2021-19'],
  ['Small telescopes (≈2.5 × original N)', 'Testing whether the original study could have detected the effect', 'forrt2025-36, brandt2014-12'],
  ['Equivalence with a SESOI', 'Goal 2: showing the effect is negligible', 'forrt2025-37'],
  ['Precision / AIPE', 'Goal 3: estimating the effect size accurately', 'anderson2016-15'],
  ['Bayesian planning', 'When you will quantify evidence with Bayes factors', 'forrt2025-38'],
  ['Multilab / pooled', 'When one site cannot reach the needed sample', 'forrt2025-39']
], [3200, 4000, CONTENT_W - 7200]));
doc.push(spacer());
doc.push(H2('Describing outcomes in balanced language'));
doc.push(table(['Instead of…', 'Consider…'], [
  ['“The replication failed.”', '“The replication did not find evidence for the effect under the conditions tested.”'],
  ['“Non-significant, so there is no effect.”', '“The result is inconclusive: the confidence interval includes both zero and meaningful effects.”'],
  ['“The original authors got it wrong.”', '“Our results diverge from the original; possible reasons include …”'],
  ['“This proves the effect is real.”', '“This adds to the evidence for the effect; one replication is not conclusive.”']
], [CONTENT_W / 2, CONTENT_W / 2]));
doc.push(P([t('Based on forrt2025-125, bonett2021-14, obenauer2024-34 and forrt2025-120.', { color: MUTED, size: 17 })]));

// 7. Checklists and templates
doc.push(H1('7. Checklists and templates'));
doc.push(H2('The FORRT reproduction and replication checklist'));
doc.push(P('The ten-item checklist from the FORRT Handbook (Röseler, Wallrich et al., 2025). Use it as a final check before preregistering and again before submitting.'));
['Justify choice of target study and claims', 'Choose a reproduction/replication type that aligns with your aims', 'Gather and review all relevant materials', 'Reproduce before you replicate, where possible', 'Discuss all updates, changes, and extensions of the original materials (as close as possible, as updated as necessary)', 'Preregister your study and analysis plan', 'Predetermine conditions for success and failure', 'Use balanced language when describing the outcomes', 'Carefully evaluate outcomes and potential reasons for divergences', 'Report your research comprehensively and openly accessible']
  .forEach((x, i) => doc.push(checkbox(`${i + 1}. ${x}`)));
doc.push(P([t(`Source: FORRT Handbook, ${srcLabel(C['forrt2025-133'])}–${C['forrt2025-142'].printed_page}.`, { color: MUTED, size: 17 })]));
doc.push(H2('Emails to the original authors'));
doc.push(P('Contacting the original authors is professional courtesy and often essential for getting materials. These outlines follow the templates in the FORRT Handbook appendix. The coach can draft them for you (“Draft author email” in stages 3 and 10).'));
for (const id of ['forrt2025-143', 'forrt2025-144', 'forrt2025-145']) {
  const c = C[id];
  doc.push(H3(c.title.replace('Email: ', '').replace(/^./, (m) => m.toUpperCase())));
  doc.push(P(c.guidance));
}
doc.push(box([P('Keep emails short, specific and friendly. Name the study and the materials you need, say why the study matters, and thank the authors. A replication is not an accusation.', { spacing: { after: 0 } })], OK_SOFT, 'Tone'));
doc.push(H2('The Replication Recipe (Brandt et al., 2014)'));
doc.push(P('The app contains all 36 questions under “Replication Recipe” in the sidebar. They are grouped into six sections: the nature of the effect, designing the replication study, documenting differences between the original and replication study, analysis and replication evaluation, registering the replication attempt, and reporting the replication. The official template is on OSF.'));
doc.push(bullet([link('Replication Recipe template on OSF', 'https://osf.io/4jd46/')]));

// 8. Resources
doc.push(H1('8. Key resources'));
doc.push(H2('Core readings (the evidence base)'));
sources.forEach((s) => doc.push(bullet([t(s.citation + ' '), link(s.url, s.url)])));
doc.push(H2('Further reading'));
doc.push(P('Selected from the ARIM (Alliance for Research on Replication in Management) “How-to” list. These are not in the coach’s evidence base, but they are recommended reading.'));
[
  ['Simons (2014). The value of direct replication.', 'https://doi.org/10.1177/1745691613514755'],
  ['Nosek, Ebersole, DeHaven & Mellor (2018). The preregistration revolution.', 'https://doi.org/10.1073/pnas.1708274114'],
  ['Köhler & Cortina (2023). Constructive replication, reproducibility, and generalizability.', 'https://doi.org/10.1177/27550311231176016'],
  ['Bettis, Helfat & Shaver (2016). The necessity, logic, and forms of replication.', 'https://doi.org/10.1002/smj.2580'],
  ['Block & Kuckertz (2018). Seven principles of effective replication studies.', 'https://doi.org/10.1007/s11301-018-0149-3'],
  ['Aguinis & Solarino (2019). Transparency and replicability in qualitative research.', 'https://doi.org/10.1002/smj.3015'],
  ['Briker & Gerpott (2023). Publishing Registered Reports in management.', 'https://doi.org/10.1177/10944281231210309'],
  ['Brodeur et al. (2023). Making reproducibility research more systematic.', 'https://doi.org/10.1038/d41586-023-02997-5'],
  ['Hedges & Schauer (2019). More than one replication study is needed for unambiguous tests of replication.', 'https://doi.org/10.3102/1076998619852953'],
  ['ARIM How-to resources (full list)', 'https://www.arimweb.org/resources/how-to']
].forEach(([a, u]) => doc.push(bullet([t(a + ' '), link(u, u)])));
doc.push(H2('Tools, databases and registries'));
doc.push(table(['Resource', 'Use it for'], [
  [new Paragraph({ children: [link('FORRT Replication Database (FReD)', 'https://forrt-replications.shinyapps.io/fred_explorer/')] }), 'Finding existing replications of your target (Stage 1); logging your results (Stage 10)'],
  [new Paragraph({ children: [link('FORRT Replication Hub', 'https://forrt.org/replication-hub')] }), 'The handbook and other replication resources'],
  [new Paragraph({ children: [link('PubPeer', 'https://pubpeer.com/')] }), 'Post-publication discussion of your target study (Stage 3)'],
  [new Paragraph({ children: [link('Open Science Framework (OSF)', 'https://osf.io/')] }), 'Sharing materials, data and code; preregistration'],
  [new Paragraph({ children: [link('AsPredicted', 'https://aspredicted.org/')] }), 'Short-form preregistration (Stage 8)'],
  [new Paragraph({ children: [link('PCI Registered Reports', 'https://rr.peercommunityin.org')] }), 'Peer review of Registered Reports (Stage 8)'],
  [new Paragraph({ children: [link('G*Power', 'https://www.psychologie.hhu.de/arbeitsgruppen/allgemeine-psychologie-und-arbeitspsychologie/gpower')] }), 'Power analysis (Stage 6)'],
  [new Paragraph({ children: [link('TOSTER (R package)', 'https://cran.r-project.org/package=TOSTER')] }), 'Equivalence tests (Stages 6 and 9)'],
  [new Paragraph({ children: [link('MBESS (R package)', 'https://cran.r-project.org/package=MBESS')] }), 'Precision (AIPE) planning and effect-size CIs'],
  [new Paragraph({ children: [link('BITSS ACRE guide', 'https://bitss.github.io/ACRE/')] }), 'Computational reproducibility (Stage 4)'],
  [new Paragraph({ children: [link('Institute for Replication', 'https://i4replication.org/')] }), 'Reproduction and replication projects in the social sciences'],
  [new Paragraph({ children: [link('APA JARS replication reporting table', 'https://apastyle.apa.org/jars/quant-table-6.pdf')] }), 'What to report in a replication paper (Stage 10)'],
  [new Paragraph({ children: [link('Journal of Management Scientific Reports', 'https://journals.sagepub.com/home/MSR')] }), 'A management journal that publishes replications']
], [4200, CONTENT_W - 4200]));

// 9. Privacy
doc.push(H1('9. Research participation and privacy'));
doc.push(P(GENERAL ? 'Replication Navigator is being evaluated for a methods paper. On the start screen you can tick a box to share your anonymous usage data. It is optional, and you can use every feature without it.' : 'We are evaluating Replication Navigator for a methods paper. Taking part is optional, and you can use every feature without agreeing.'));
doc.push(table(['', 'If you agree', 'If you do not agree'], [
  ['What is logged', 'A random ID, messages to and from the coach, checklist ticks, ratings, citations you open or flag, survey answers, and your exported plan', 'Nothing'],
  ['Where your work is saved', 'In your browser', 'In your browser'],
  ['Messages to the coach', 'Processed by Anthropic’s API to generate replies', 'Processed by Anthropic’s API to generate replies'],
  ['An uploaded paper', 'Sent to Anthropic’s API once to extract key details; the PDF is not stored. The extracted summary is kept in your browser.', 'Same']
], [2400, 4200, CONTENT_W - 6600]));
doc.push(spacer());
doc.push(bullet('We never ask for your name or email. Your data are linked only to a random ID created by your browser.'));
doc.push(bullet('Do not type personal or confidential information into worksheets or the coach.'));
doc.push(bullet('You can change your choice at any time in Settings.'));
doc.push(GENERAL ? P([t('Questions or feedback: '), t('[name, email]', { italics: true }), t('.')]) : P([t('Full details are in the participant information sheet. Contact: ', {}), t('[name, email]', { italics: true }), t('. Ethics approval: '), t('[reference]', { italics: true }), t('.')]));

// 10. Troubleshooting
doc.push(H1('10. Troubleshooting and FAQ'));
doc.push(table(['Problem', 'What to do'], [
  ['The coach takes a long time', 'The first reply can take up to a minute while the server wakes up. After that, text starts appearing within a few seconds.'],
  ['A coach reply stops mid-way', 'Click “Continue” under the reply.'],
  ['Uploading the paper fails', 'Check it is a PDF under 15 MB. Scanned papers without selectable text may not work. You can always fill in the details by hand.'],
  ['“Rate limit reached”', 'Wait a few minutes. There is a limit on coach requests per hour for each session.'],
  ['A citation is struck through', 'The coach cited a card that does not exist. Treat that statement with caution and flag it if you can.'],
  ['My work disappeared', 'Check that you are on the same device and browser. If you exported, use Settings → Import plan.'],
  ['I want to continue on another device', 'Settings → Download backup, then on the other device Settings → Import plan.'],
  ['The page looks broken', 'Reload the page. Your work is kept in the browser.']
], [3400, CONTENT_W - 3400]));
doc.push(H2('Frequently asked questions'));
[
  GENERAL ? ['Is it free? Do I need an account?', 'Yes, it is free and open access, with no account. If the shared coach reaches its daily limit, you can add your own Anthropic API key in Settings.'] : ['Can I use the tool after the summit?', 'Yes. The tool will stay available, and your exported plan works as a stand-alone document.'],
  ['Does the coach write my preregistration for me?', 'No. It helps you think, reviews your drafts and can draft sections on request, but you own every decision. Always check its suggestions.'],
  ['Why does the coach sometimes say “the evidence base doesn’t cover this”?', 'Because it is only allowed to give methodological advice from its 322 evidence cards. That is a feature, not a bug. ' + (GENERAL ? 'Ask a supervisor or methods expert.' : 'Ask the experts in the room.') + ''],
  ['Is this only for quantitative studies?', 'The current evidence base is mostly about quantitative replication. Qualitative replication is on the list for future versions (see further reading in section 8).']
].forEach(([q, a]) => { doc.push(P([t(q, { bold: true })], { spacing: { after: 40 } })); doc.push(P(a)); });
doc.push(spacer());
doc.push(box([P('Replication Navigator is open source. Cite it as: Shea, K. (2026). Replication Navigator: an evidence-grounded guide and AI coach for planning replication studies (v0.1). https://github.com/kristinaraevigna-cyber/replication-navigator', { spacing: { after: 0 } })], SOFT, 'How to cite'));

// ---------- document ----------
const document = new Document({
  creator: 'Replication Navigator', features: { updateFields: true }, title: `Replication Navigator – ${DOC_NAME}`,
  styles: {
    default: { document: { run: { font: 'Calibri', size: 21 }, paragraph: { spacing: { line: 276, lineRule: LineRuleType.AUTO } } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Georgia', size: 36, bold: true, color: ACCENT }, paragraph: { spacing: { before: 0, after: 240 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Georgia', size: 28, bold: true, color: '1D2327' }, paragraph: { spacing: { before: 300, after: 140 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, color: ACCENT }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } }
    ]
  },
  numbering: { config: numberingConfigs },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } }, titlePage: true },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [t(`Replication Navigator · ${DOC_NAME}`, { color: MUTED, size: 16 })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [t('Page ', { color: MUTED, size: 16 }), new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 16 })] })] }) },
    children: doc
  }]
});
Packer.toBuffer(document).then((buf) => { fs.writeFileSync(process.argv[2] || 'manual.docx', buf); console.log('written'); });
