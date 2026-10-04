// Builds the team's full replication plan as a formatted Word document.
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, Footer, PageNumber, LineRuleType
} from 'docx';
import { stages, recipe, sources, cardById } from './knowledge.js';

const ACCENT = '245C73', MUTED = '5D6870';
const PAGE_W = 11906, MARGIN = 1134, CONTENT_W = PAGE_W - 2 * MARGIN;
const t = (text, o = {}) => new TextRun({ text, ...o });
const para = (runs, o = {}) => new Paragraph({ children: runs, spacing: { after: 100 }, ...o });
const clean = (v) => (Array.isArray(v) ? v.join('; ') : typeof v === 'string' ? v : '').trim().slice(0, 8000);
const textParas = (text) => text.split(/\n+/).map((l) => para([t(l)]));
const visible = (item, profile) => !item.when || Object.entries(item.when).every(([k, v]) => !profile?.[k] || profile[k] === v);

function box(children) {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: [CONTENT_W],
    rows: [new TableRow({ cantSplit: true, children: [new TableCell({
      width: { size: CONTENT_W, type: WidthType.DXA }, shading: { fill: 'E2EEF2', type: ShadingType.CLEAR, color: 'auto' },
      borders: { top: none, bottom: none, right: none, left: { style: BorderStyle.SINGLE, size: 24, color: ACCENT } },
      margins: { top: 140, bottom: 140, left: 220, right: 220 }, children
    })] })]
  });
}

export async function buildPlan({ worksheets = {}, ratings = {}, checklist = {}, recipe: answers = {}, profile = {}, paper = null, participant = '' }) {
  const body = [];
  const claim = clean(worksheets?.target?.claim);
  const cited = new Set();

  body.push(para([t('REPLICATION PLAN', { bold: true, color: ACCENT, size: 18, characterSpacing: 30 })], { spacing: { after: 80 } }));
  body.push(new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 160 }, children: [t(claim ? claim.split('\n')[0].slice(0, 180) : 'Replication plan')] }));
  body.push(para([t('Target study: ', { bold: true }), t(clean(worksheets?.target?.citation) || '—')]));
  body.push(para([t('Team / participant: ', { bold: true }), t(participant || '—'), t('    Date: ', { bold: true }), t(new Date().toISOString().slice(0, 10))]));

  // Progress summary table
  const rows = stages.map((s) => {
    const items = s.checklist.map((c, i) => ({ c, i })).filter(({ c }) => visible(c, profile));
    const done = items.filter(({ i }) => checklist?.[s.id]?.[i]).length;
    const filled = s.fields.filter((f) => clean(worksheets?.[s.id]?.[f.id])).length;
    return [`${s.n}. ${s.title}`, `${filled} of ${s.fields.length}`, `${done} of ${items.length}`];
  });
  const widths = [CONTENT_W - 2 * 2000, 2000, 2000];
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'DEDBD2' };
  const cell = (txt, i, head) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, borders: { top: border, bottom: border, left: border, right: border }, shading: head ? { fill: ACCENT, type: ShadingType.CLEAR, color: 'auto' } : undefined, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [new Paragraph({ children: [t(txt, head ? { bold: true, color: 'FFFFFF', size: 20 } : { size: 20 })] })] });
  body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t('Overview')] }));
  body.push(new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths, rows: [
    new TableRow({ tableHeader: true, children: ['Stage', 'Fields answered', 'Checklist done'].map((h, i) => cell(h, i, true)) }),
    ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((x, i) => cell(x, i, false)) }))] }));

  if (paper) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t('Target paper summary (auto-extracted)')] }));
    body.push(para([t('Extracted automatically from the uploaded paper. Check every detail against the paper.', { italics: true, color: MUTED, size: 18 })]));
    const add = (label, v) => { const x = typeof v === 'object' && v ? Object.values(v).filter(Boolean).join(', ') : clean(String(v ?? '')); if (x) body.push(para([t(label + ': ', { bold: true }), t(x)])); };
    add('Study', paper.study_label); add('Main claim', paper.main_claim); add('Design', paper.design);
    add('Participants', paper.participants); add('Effect', paper.effect); add('Analysis', paper.analysis);
    if (Array.isArray(paper.measures)) paper.measures.forEach((m) => add('Measure', m));
    add('Materials', paper.materials_availability); add('Data', paper.data_availability);
  }

  for (const s of stages) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t(`${s.n}. ${s.title}`)] }));
    const skipped = s.optional_when && Object.entries(s.optional_when).every(([k, v]) => profile?.[k] === v);
    if (skipped) body.push(para([t('Marked as not applicable based on your screener answers.', { italics: true, color: MUTED })]));
    for (const f of s.fields) {
      if (!visible(f, profile)) continue;
      const v = clean(worksheets?.[s.id]?.[f.id]);
      const r = ratings?.[s.id]?.[f.id];
      body.push(para([t(f.label, { bold: true }), ...(r ? [t(`   (rated ${r}/5)`, { color: MUTED })] : [])], { spacing: { before: 140, after: 60 }, keepNext: true }));
      if (v) body.push(...textParas(v)); else body.push(para([t('Not yet completed', { italics: true, color: MUTED })]));
    }
    body.push(para([t('Checklist', { bold: true, color: ACCENT })], { spacing: { before: 200, after: 60 }, keepNext: true }));
    s.checklist.forEach((c, i) => {
      if (!visible(c, profile)) return;
      const done = checklist?.[s.id]?.[i];
      c.cards.forEach((id) => cited.add(id));
      body.push(para([t(done ? '☑  ' : '☐  ', { size: 24 }), t(c.text), t(`  (${c.cards.join(', ')})`, { color: MUTED, size: 16 })], { spacing: { after: 60 } }));
    });
  }

  const recipeAnswered = recipe.filter((q) => clean(answers[q.n] ?? answers[String(q.n)]));
  if (recipeAnswered.length) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t('Replication Recipe answers')] }));
    for (const q of recipeAnswered) {
      body.push(para([t(`${q.n}. ${q.text}`, { bold: true })], { spacing: { before: 120, after: 40 }, keepNext: true }));
      body.push(...textParas(clean(answers[q.n] ?? answers[String(q.n)])));
    }
  }

  body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t('Next steps')] }));
  [
    'Discuss this plan with your supervisor or an expert, especially stages 1, 6 and 9.',
    'Download the draft preregistration (Replication Navigator → Preregistration), complete the highlighted gaps and register it on OSF.',
    'Contact the original authors if you have not yet done so.',
    'After data collection, return to Stage 10 to interpret and report your results, and log them in FReD.'
  ].forEach((x, i) => body.push(para([t(`${i + 1}. ${x}`)])));

  body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t('Evidence cards referenced')] }));
  body.push(para([t('Look these up under “Evidence base” in Replication Navigator to see the guidance and the exact quote.', { italics: true, color: MUTED, size: 18 })]));
  const srcShort = Object.fromEntries(sources.map((x) => [x.key, x.short]));
  [...cited].sort().forEach((id) => { const c = cardById.get(id); if (c) body.push(para([t(`${id}: `, { bold: true, size: 18 }), t(`${c.title} (${srcShort[c.source]}, ${c.printed_page ? 'p. ' + c.printed_page : 'PDF p. ' + c.pdf_page})`, { size: 18 })], { spacing: { after: 30 } })); });
  body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [t('Sources')] }));
  sources.forEach((x) => body.push(para([t(`${x.citation} ${x.url}`, { size: 18 })], { spacing: { after: 40 } })));

  const doc = new Document({
    creator: 'Replication Navigator', title: 'Replication plan',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { line: 276, lineRule: LineRuleType.AUTO } } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: 'Georgia', size: 40, bold: true, color: '1D2327' } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Georgia', size: 30, bold: true, color: ACCENT }, paragraph: { spacing: { before: 400, after: 120 }, keepNext: true, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true }, paragraph: { spacing: { before: 240, after: 80 }, keepNext: true, outlineLevel: 1 } }
      ]
    },
    sections: [{
      properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [t('Replication plan · Replication Navigator · page ', { color: MUTED, size: 16 }), new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 16 })] })] }) },
      children: body
    }]
  });
  return Packer.toBuffer(doc);
}
