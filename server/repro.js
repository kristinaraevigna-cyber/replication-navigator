// Reproduction code: read the original paper (one or several studies) and draft analysis scripts
// that a person checks and runs. The model never sees data; it writes code against the variables
// and models the paper reports, with explicit TODOs where the paper is silent.

export const LANGS = { r: 'R', python: 'Python (pandas/statsmodels)', stata: 'Stata', spss: 'SPSS syntax' };

export const reproPrompt = (lang) => `You are helping a researcher REPRODUCE the analyses of the attached paper: re-run the paper's own analyses on the paper's own data (which the researcher will obtain separately). Read the paper and write ${LANGS[lang]} code that a person will check line by line and run.

Rules:
1. Reproduce what the paper reports, in the paper's order: for EACH study in the paper (Study 1, Study 2 … or "Main study"), the sample construction and exclusions, variable construction (exactly as described: items, reverse coding, scales, transformations, lags, winsorisation), descriptive statistics and correlations if reported, the main models in the order of the paper's tables, and the key robustness checks.
2. Use only what the paper states. Where the paper is silent or ambiguous (e.g. how missing values were handled, which standard errors, exact exclusion thresholds), write a clearly marked "# TODO (paper silent):" or "# ASSUMPTION:" comment and choose the most conventional option. Never invent variable names as if they were certain: declare them at the top in a CONFIG block the researcher edits (file paths, variable names, ids, time variable).
3. Next to each model, write a comment with the target numbers from the paper (coefficient, SE or t, p, N, R²) so the researcher can compare, e.g. "# Target (Table 2, Model 3): b = 0.12 (SE 0.04), N = 2,100".
4. Keep each script self-contained and runnable from top to bottom once CONFIG is filled: load packages, read data, build variables, run models, print a comparison table of obtained vs target values.
5. Plain, well-commented code; no clever abstractions. For SPSS use syntax, not menus. For Stata use do-file syntax.

Return ONLY a JSON object:
{
  "citation": "APA reference",
  "studies": [
    { "label": "Study 1", "data_needed": "what data file(s) and variables the researcher must obtain, in one paragraph", "design": "one sentence: sample, N, main model, DV, IV",
      "script": "the complete ${LANGS[lang]} code for this study as one string",
      "targets": [ { "table": "Table 2, Model 3", "quantity": "b for X on Y", "value": "0.12 (SE 0.04), p < .01, N = 2,100" } ],
      "checks": [ "things the researcher must verify by hand before trusting a match, one per item" ],
      "silences": [ "decisions the paper does not state, one per item" ] }
  ],
  "notes": "two or three sentences: anything about the paper that makes exact reproduction hard (proprietary data, undisclosed cleaning, etc.)"
}`;
