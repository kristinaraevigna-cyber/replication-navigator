// Extracts key facts from the paper a team is replicating (uploaded PDF) so the app can pre-fill
// worksheets and the coach can tailor its advice. The PDF is sent to the model once and not stored.

export const PAPER_PROMPT = `You are helping a researcher plan a replication. Read the attached paper and extract ONLY facts that are stated in it. Do not evaluate the paper, do not give advice, and do not guess. Use null when something is not reported. Add the page number in brackets after a value when you can, e.g. "N = 42 (p. 3)".

If the paper reports several studies, focus on the one most likely to be replicated (usually the main or first study) and say which one in "study_label"; list the others briefly in "other_studies".

Return ONLY a JSON object, no other text, with exactly these keys:
{
  "citation": "APA-style reference with DOI if shown",
  "study_label": "e.g. 'Study 1'",
  "main_claim": "the central finding in one plain sentence",
  "design": "e.g. 'between-subjects experiment, 2 conditions: expansive vs contractive pose'",
  "manipulation": "what was manipulated and how, or null",
  "participants": { "n": "total N analysed (and recruited if different)", "population": "e.g. university students", "country": "...", "setting": "lab / online / field", "mode": "paper-and-pencil / computer / other", "payment": "or null" },
  "effect": { "statistic": "the key test statistic as reported, e.g. 't(40) = 2.1, p = .04'", "effect_size": "e.g. 'd = 0.60' or null", "ci": "confidence interval of the effect or null" },
  "measures": [ { "construct": "...", "instrument": "name / description", "items": "number of items or null", "reliability": "e.g. 'α = .82' or null" } ],
  "analysis": "the main analysis as described",
  "exclusions": "exclusion rules reported, or null",
  "materials_availability": "what the paper says about materials / stimuli being available, or null",
  "data_availability": "what the paper says about data / code availability, or null",
  "preregistered": "yes (with link) / no / not stated",
  "other_studies": "brief list or null"
}`;

export function parseJsonLoose(text) {
  const s = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON in model output');
  return JSON.parse(s.slice(start, end + 1));
}
