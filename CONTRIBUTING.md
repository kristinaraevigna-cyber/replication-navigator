# Contributing

## Reviewing evidence cards (experts)

1. Open `evaluation/card-review-sheet.csv` in Excel or Google Sheets.
2. For each assigned card, rate:
   - **fidelity:** 2 = faithful, 1 = partly, 0 = misrepresents the source;
   - **usefulness:** 1–3;
   - **stage correct?:** y/n.
   Add comments where needed.
3. Check the quote and page against the source PDF when in doubt.
4. Return the sheet. Cards rated 0, or disputed, are revised or removed in the next release, and changes are recorded in the release notes.

## Adding a source or cards

1. Add the source to `knowledge/sources.json` with a unique `key` (author + year, lower case, e.g. `simons2014`).
2. Add cards to `knowledge/evidence-cards.json` following the schema:
   ```json
   {"id": "simons2014-01", "stage": "aim", "kind": "principle", "title": "…", "guidance": "2–4 sentences, own words",
    "action": "one imperative checklist item", "source": "simons2014", "pdf_page": 3, "printed_page": "77",
    "quote": "8–30 words, verbatim from that page"}
   ```
   Stages: `target, aim, materials, reproduce, measures, sample, differences, prereg, analysis, report, foundations, teaching`. Kinds: `principle, how-to, pitfall, definition, tool, template, checklist`.
3. Run `node scripts/check-knowledge.js`, then `python3 scripts/verify_cards.py --pdf-dir <folder with <key>.pdf files>`.
4. Optionally link new cards from `knowledge/stages.json` (fields, checklist items).
5. Open a pull request. Never commit the PDFs.

**Priority gaps:** qualitative replication (e.g. Aguinis & Solarino 2019; Pratt et al. 2020; Köhler et al. 2025), preregistration (Nosek et al. 2018), direct replication (Simons 2014), student replication projects (Moreau & Wiebels 2023), and computational reproducibility (Brodeur et al. 2023). All of these are on the ARIM how-to list.
