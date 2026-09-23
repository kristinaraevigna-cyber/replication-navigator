# Facilitator guide: OSM Summit session

## Before the day

- [ ] Deploy (see DEPLOY.md). Upgrade to an always-on instance, or plan to wake the app 5 minutes before.
- [ ] Run the offline evaluation (`scripts/eval_coach.mjs`) and read a sample of replies yourself.
- [ ] Choose **8 target studies** (one per team). Good targets:
  - influential in management / organisational research;
  - methods reported in enough detail, ideally with open materials [schwab2023-08];
  - feasible to replicate in principle with student resources [schwab2023-27];
  - a mix of experimental and survey designs.
  Put each team's target (full reference + DOI + PDF) in a shared folder.
- [ ] Print or share: the access code, the team/participant code scheme (T1-P1 … T8-P5), and a QR code to the app URL.
- [ ] Brief the experts: their role at check-points 1, 6 and 9, and the rubric (`evaluation/expert-rubric.md`).
- [ ] Get ethics approval and finalise the information sheet.

## During the session

1. **Introduction (10 minutes).** Why replication; what the tool does; the information sheet; consent.
2. **Demo (10 minutes).** Open stage 1. Click *Explain this stage*. Click a citation chip to show the card and its verbatim quote. Show the flag button: "If a citation doesn't support what the coach says, flag it. That's data for us."
3. **Team work (75 minutes).** Suggested pacing: stages 1–3 in 25 minutes, stages 4–7 in 25 minutes, stages 8–9 in 25 minutes. One person drives, and the others read the cards and challenge the choices. Experts sign off check-points 1, 6 and 9.
4. **Export (5 minutes).** Every team clicks **Export plan** and uploads the .md file to the shared folder.
5. **Survey (10 minutes).** Sidebar → Feedback survey.
6. **Plenary (5 minutes).**

## Troubleshooting

- **"Please enter the workshop access code".** Settings → Workshop access code.
- **Coach slow the first time.** Cold start. Wait about a minute.
- **Rate limit.** Default 60 requests per hour per session. Raise `RATE_PER_HOUR` in Render if needed.
- **Lost work.** Work is saved in the browser. Clearing the browser or switching device loses it. Export regularly; plans can be re-imported via Settings → Import.
