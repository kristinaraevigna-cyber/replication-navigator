# Pilot evaluation protocol: OSM Summit

*Draft v0.1. Adapt it, and check with your institution's ethics committee (University of Bologna) before collecting data. Consider preregistering this protocol on OSF.*

## Research questions

- **RQ1 (grounding).** How often does the coach's advice cite existing evidence cards, and how often do the cited cards actually support the claim?
- **RQ2 (usability).** How usable do doctoral students and experts find the tool (SUS)?
- **RQ3 (perceived value).** Do participants report more understanding of the replication process, and more trust in the advice, because of the citations?
- **RQ4 (output quality).** How complete and rigorous are the replication plans produced during the session, as rated by experts?

## Design

A single-session, mixed-methods usability and feasibility pilot. There is no control group. (A later study could compare it with the unguided FORRT checklist.)

**Participants.** About 40 summit attendees (doctoral students, early-career researchers) plus experts (faculty with replication or methods expertise).

**Teams.** 8 teams of about 5 participants. Each team gets one pre-selected target study (see the facilitator guide), so the time goes into the process rather than the search. One expert is assigned per 1–2 teams.

## Procedure (about 120 minutes)

| time | activity |
|---|---|
| 0–10 | Introduction; information sheet; participants scan their team's QR link (fills in access code and team), answer the four start questions and choose whether to consent |
| 10–20 | Demo of one stage and of how to check a citation |
| 20–95 | Teams work through stages 1–9 on their target study; experts visit at check-points 1, 6 and 9 |
| 95–105 | Each team exports its plan and submits it (the export is logged automatically if they consented) |
| 105–115 | In-app feedback survey (SUS plus custom items) |
| 115–120 | Short plenary: what worked and what didn't |

## Measures

| construct | measure | source |
|---|---|---|
| Usability | System Usability Scale (10 items, 0–100) | in-app survey |
| Perceived accuracy, trust, rigour, learning, recommendation | 5 custom Likert items (c1–c5) | in-app survey |
| Background | role, prior replication experience | in-app survey |
| Grounding (automatic) | % replies with ≥1 valid citation; non-existent ids per reply | logs |
| Grounding (human) | expert rating of whether each cited card supports the claim (2/1/0) on a random sample of ≥100 (reply, card) pairs, with two raters; report Cohen's κ | `citation_audit_sample.csv` |
| Engagement | coach turns per stage and mode; citation opens; flags; 👍/👎 | logs |
| Process completion | checklist items ticked per stage | logs |
| Output quality | expert rubric score of the exported plans | `expert-rubric.md` |
| Qualitative | open survey answers; plenary notes; expert observations | survey and notes |

## Offline evaluation (before the summit)

Run `scripts/eval_coach.mjs` with 3 repeats over `test-questions.json` and report:

- the rate of non-existent citations,
- the expected-card hit rate,
- the proportion of out-of-scope questions correctly declined,
- whether the coach avoided made-up numbers (q18) and resisted instruction override (q20), rated by a human.

Separately, experts review the 322 cards using `card-review-sheet.csv`. Split the cards between reviewers, with a 20% overlap for agreement.

## Analysis

The analysis is descriptive: means, SDs and 95% CIs for SUS and the custom items, proportions with 95% CIs for the grounding rates, and inter-rater agreement for the human ratings. Open answers get a short thematic analysis. SUS can be compared with published benchmarks (a common reference point is about 68). No confirmatory hypothesis tests.

## Ethics and data protection (GDPR)

- Participation in the research part is optional. The tool works fully without consent, and without consent nothing is logged.
- Only a random browser ID and a team code are collected. Participants are told not to enter their name or personal data in worksheets or chats.
- Logs are stored on the deployment's database (Render, region chosen at setup). They are exported after the pilot, stored at the University, and deleted from the hosting service.
- Messages to the coach are processed by Anthropic's API. State this in the information sheet, and check your institution's rules for third-party processors.
- Data retention: define this, e.g. 5 years for pseudonymised data. Plan to share it openly only after checking the free-text for identifying content.
