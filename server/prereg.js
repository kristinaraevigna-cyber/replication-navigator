// Builds a draft preregistration (.docx) following the Replication Recipe (Brandt et al., 2014)
// from a team's Replication Recipe answers, falling back to their stage worksheets.
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, Footer, PageNumber, LineRuleType, ExternalHyperlink
} from 'docx';
import { stages, recipe } from './knowledge.js';

const ACCENT = '245C73', MUTED = '5D6870';
const PAGE_W = 11906, MARGIN = 1134, CONTENT_W = PAGE_W - 2 * MARGIN;

// Recipe question -> worksheet fields used as a fallback when the Recipe answer is empty.
const FALLBACK = {
  1: ['target.claim'],
  2: ['target.value', 'target.decision'],
  3: ['sample.orig'], 4: ['sample.orig'], 5: ['sample.orig'],
  10: ['materials.inventory', 'materials.missing', 'materials.contact'],
  11: ['differences.updates', 'measures.adaptation'],
  15: ['sample.n'],
  16: ['sample.approach', 'sample.sesoi', 'sample.n'],
  17: ['differences.table'], 18: ['differences.table'], 19: ['differences.table'], 20: ['differences.table'],
  21: ['differences.table'], 22: ['differences.table'], 23: ['differences.table', 'differences.samplecomp'],
  24: ['differences.influential'],
  25: ['measures.checks'],
  26: ['prereg.exclusions'],
  27: ['analysis.primary', 'analysis.comparison', 'analysis.secondary'],
  28: ['analysis.criteria'],
  29: ['prereg.link', 'prereg.route']
};

const EXTRA = [
  ['Purpose and type of replication', ['aim.purpose', 'aim.kind', 'aim.closeness', 'aim.goal', 'aim.theory']],
  ['Hypotheses', ['prereg.hypotheses']],
  ['Target study', ['target.citation', 'target.existing']],
  ['Reproduction of the original result', ['reproduce.availability', 'reproduce.claimrep', 'reproduce.result', 'reproduce.environment']],
  ['Measures and validity checks', ['measures.measures', 'measures.validity', 'measures.checks']],
  ['Contingency plans', ['prereg.contingencies']]
];

const fieldMeta = new Map();
for (const s of stages) for (const f of s.fields) fieldMeta.set(`${s.id}.${f.id}`, { stage: s, field: f });

const clean = (v) => {
  if (Array.isArray(v)) v = v.join('; ');
  return typeof v === 'string' ? v.trim().slice(0, 6000) : '';
};
function lookup(worksheets, key) {
  const [sid, fid] = key.split('.');
  const v = clean(worksheets?.[sid]?.[fid]);
  if (!v) return null;
  const m = fieldMeta.get(key);
  return { key, value: v, label: m ? `Stage ${m.stage.n}: ${m.field.label}` : key };
}

const t = (text, o = {}) => new TextRun({ text, ...o });
const para = (runs, o = {}) => new Paragraph({ children: runs, spacing: { after: 100 }, ...o });
const textParas = (text, o = {}) => text.split(/\n+/).map((line) => para([t(line, o)]));
const link = (text, url) => new ExternalHyperlink({ link: url, children: [t(text, { style: 'Hyperlink' })] });

function answerBlock(n, q, recipeAns, worksheets, shownAt) {
  const out = [new Paragraph({ keepNext: true, spacing: { before: 200, after: 80 }, children: [t(`${n}. `, { bold: true, color: ACCENT }), t(q.text, { bold: true })] })];
  if (recipeAns) {
    out.push(...textParas(recipeAns));
    return { blocks: out, status: 'recipe' };
  }
  const found = (FALLBACK[n] || []).map((k) => lookup(worksheets, k)).filter(Boolean);
  const seen = new Set();
  const uniq = found.filter((f) => !seen.has(f.key) && seen.add(f.key));
  if (uniq.length && uniq.every((f) => shownAt.has(f.key))) {
    const first = shownAt.get(uniq[0].key);
    out.push(para([t(`Drafted from the same worksheet answer as question ${first}. Keep only the part that answers this question.`, { italics: true, color: MUTED, size: 18 })]));
    out.push(para([t(`[See question ${first}]`, { bold: true, highlight: 'lightGray' })]));
    return { blocks: out, status: 'drafted' };
  }
  if (uniq.length) {
    uniq.forEach((f) => { if (!shownAt.has(f.key)) shownAt.set(f.key, n); });
    out.push(para([t('Drafted from your worksheet. Check and edit this answer for this question.', { italics: true, color: MUTED, size: 18 })]));
    for (const f of uniq) {
      if (uniq.length > 1) out.push(para([t(f.label, { italics: true, color: MUTED, size: 18 })], { spacing: { after: 40 } }));
      out.push(...textParas(f.value));
    }
    return { blocks: out, status: 'drafted' };
  }
  out.push(para([t('[To complete]', { bold: true, highlight: 'yellow' })]));
  return { blocks: out, status: 'missing' };
}

export async function buildPrereg({ worksheets = {}, recipe: answers = {}, participant = '' }) {
  const body = [];
  const counts = { recipe: 0, drafted: 0, missing: 0 };
  const sections = [...new Set(recipe.map((q) => q.section))];
  const preSections = sections.filter((s) => !/^Reporting/i.test(s));
  const postSections = sections.filter((s) => /^Reporting/i.test(s));

  const target = clean(worksheets?.target?.citation) || '[Target study: full reference and DOI]';
  const claim = clean(worksheets?.target?.claim);

  body.push(new Paragraph({ spacing: { after: 80 }, children: [t('DRAFT PREREGISTRATION · REPLICATION RECIPE', { bold: true, color: ACCENT, size: 18, characterSpacing: 30 })] }));
  body.push(new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 160 }, children: [t(claim ? `Replication of: ${claim.split('\n')[0].slice(0, 160)}` : 'Replication preregistration')] }));
  body.push(para([t('Target study: ', { bold: true }), t(target)]));
  body.push(para([t('Team / participant: ', { bold: true }), t(participant || '—'), t('    Generated: ', { bold: true }), t(new Date().toISOString().slice(0, 10))]));

  // Questions 1–29 (pre-data)
  const preBlocks = [];
  const shownAt = new Map(); // worksheet field -> question where it was first shown
  for (const sec of preSections) {
    preBlocks.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t(sec)] }));
    for (const q of recipe.filter((x) => x.section === sec)) {
      const { blocks, status } = answerBlock(q.n, q, clean(answers[q.n] ?? answers[String(q.n)]), worksheets, shownAt);
      counts[status]++;
      preBlocks.push(...blocks);
    }
  }

  // Status box
  const total = counts.recipe + counts.drafted + counts.missing;
  const cellBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  body.push(new Table({
    width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: [CONTENT_W],
    rows: [new TableRow({ cantSplit: true, children: [new TableCell({
      width: { size: CONTENT_W, type: WidthType.DXA }, shading: { fill: 'E2EEF2', type: ShadingType.CLEAR, color: 'auto' },
      borders: { top: cellBorder, bottom: cellBorder, right: cellBorder, left: { style: BorderStyle.SINGLE, size: 24, color: ACCENT } },
      margins: { top: 140, bottom: 140, left: 220, right: 220 },
      children: [
        para([t('How complete is this draft?', { bold: true, color: ACCENT })]),
        para([t(`${counts.recipe} of ${total} questions answered in your Replication Recipe; ${counts.drafted} drafted from your stage worksheets (check these); `), t(`${counts.missing} still to complete`, { bold: true, highlight: counts.missing ? 'yellow' : undefined }), t('.')]),
        para([t('This is a draft generated by Replication Navigator. You are responsible for its content. Review every answer with your team and supervisor before registering. To register, copy your answers into the Replication Recipe pre-registration template on OSF Registries, or attach this document to an OSF registration. ')]),
        para([link('osf.io/registries', 'https://osf.io/registries'), t('   ·   Official Replication Recipe template: '), link('osf.io/4jd46', 'https://osf.io/4jd46/')], { spacing: { after: 0 } })
      ]
    })] })]
  }));

  body.push(...preBlocks);

  // Additional details from the worksheets
  const extras = EXTRA.map(([title, keys]) => [title, keys.map((k) => lookup(worksheets, k)).filter(Boolean)]).filter(([, f]) => f.length);
  if (extras.length) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t('Additional preregistration details')] }));
    body.push(para([t('From your stage worksheets. Many registries and journals ask for these too, so keep what is useful.', { italics: true, color: MUTED, size: 18 })]));
    for (const [title, fields] of extras) {
      body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [t(title)] }));
      for (const f of fields) {
        body.push(para([t(f.label.replace(/^Stage \d+: /, ''), { italics: true, color: MUTED, size: 18 })], { spacing: { after: 40 } }));
        body.push(...textParas(f.value));
      }
    }
  }

  // Post-data questions
  if (postSections.length) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t('After data collection (not part of the preregistration)')] }));
    body.push(para([t('Answer these when you report your results. They are listed here so the full Recipe stays in one document.', { italics: true, color: MUTED, size: 18 })]));
    for (const q of recipe.filter((x) => postSections.includes(x.section))) {
      body.push(para([t(`${q.n}. `, { bold: true, color: ACCENT }), t(q.text, { bold: true })], { spacing: { before: 160, after: 60 } }));
      const a = clean(answers[q.n] ?? answers[String(q.n)]);
      body.push(a ? para([t(a)]) : para([t('[After data collection]', { color: MUTED })]));
    }
  }

  body.push(para([t('Template: Brandt, M. J., IJzerman, H., Dijksterhuis, A., et al. (2014). The Replication Recipe: What makes for a convincing replication? Journal of Experimental Social Psychology, 50, 217–224. https://doi.org/10.1016/j.jesp.2013.10.005', { color: MUTED, size: 16 })], { spacing: { before: 400 } }));

  const doc = new Document({
    creator: 'Replication Navigator', title: 'Draft preregistration (Replication Recipe)',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { line: 276, lineRule: LineRuleType.AUTO } } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: 'Georgia', size: 40, bold: true, color: '1D2327' } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Georgia', size: 30, bold: true, color: ACCENT }, paragraph: { spacing: { before: 400, after: 120 }, keepNext: true, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, color: '1D2327' }, paragraph: { spacing: { before: 240, after: 80 }, keepNext: true, outlineLevel: 1 } }
      ]
    },
    sections: [{
      properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [t('Draft preregistration · Replication Navigator · page ', { color: MUTED, size: 16 }), new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 16 })] })] }) },
      children: body
    }]
  });
  return { buffer: await Packer.toBuffer(doc), counts };
}
