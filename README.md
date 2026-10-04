# Replication Navigator

**An evidence-grounded, step-by-step guide and AI coach for planning rigorous replication studies.**

Replication Navigator takes doctoral students and early-career researchers through ten stages of a replication or reproduction study, from choosing a target to publishing the results. Each stage has:

- a **worksheet** that builds up the student's replication plan,
- a **checklist** in which every item is tied to published guidance,
- curated **resources and templates** (for example, emails to original authors),
- an **AI coach** that may only use a curated evidence base and cites the card behind every recommendation.

The tool was built for the pilot at the Open Science Management (OSM) summit (40 participants plus expert reviewers). It is designed so the pilot can be written up as a methods paper.

---

## Why "evidence cards"?

General-purpose chatbots answer from everything they were trained on, so their methodological advice can't be traced to a source. Replication Navigator restricts the coach to **322 evidence cards** taken from nine key sources on replication. Each card contains:

| field | purpose |
|---|---|
| `guidance` | a paraphrase of one piece of advice, in plain language |
| `action` | a concrete checklist item |
| `quote` | a **verbatim** excerpt of 8–30 words from the source |
| `source`, `pdf_page`, `printed_page` | where to check it |
| `stage`, `kind` | where in the process the card applies, and what kind of card it is (principle, how-to, pitfall, definition, tool, template, checklist) |

Grounding is enforced and checked at three levels:

1. **Build time.** `scripts/verify_cards.py` checks that every quote occurs on its stated page of the source PDF. In v0.1, all 322 of 322 pass.
2. **Answer time.** The server extracts every `[card-id]` the model cites and flags any id that doesn't exist. The UI strikes these through, and they are logged.
3. **Use time.** Participants can open any citation, read the card and its quote, and **flag** a citation that doesn't support the coach's claim.

See [`docs/METHOD.md`](docs/METHOD.md) for the design rationale.

## Evidence base (v0.1)

| key | source |
|---|---|
| `forrt2025` | Röseler, Wallrich et al. (2025). *Handbook for Reproduction and Replication Studies* v1.0. FORRT. |
| `brandt2014` | Brandt et al. (2014). The Replication Recipe. *JESP*, 50, 217–224. |
| `bonett2021` | Bonett (2021). Design and analysis of replication studies. *ORM*, 24(3). |
| `anderson2016` | Anderson & Maxwell (2016). There's more than one way to conduct a replication study. *Psych. Methods*, 21(1). |
| `irvine2021` | Irvine (2021). The role of replication studies in theory building. *PPS*, 16(4). |
| `flake2023` | Flake, Davidson, Wong & Pek (2022). Construct validity and the validity of replication studies. *Am. Psychologist*, 77(4). |
| `isager2021` | Isager et al. (2023). Deciding what to replicate. *Psych. Methods*, 28(2). |
| `obenauer2024` | Obenauer (2024). Designing, executing, and publishing replication research. *JOMSR*. |
| `schwab2023` | Schwab et al. (2023). How replication studies can improve doctoral student education. *JOMSR*, 1(1). |

Further reading is linked from the [ARIM how-to page](https://www.arimweb.org/resources/how-to).

> **Copyright note.** The repository holds no source PDFs. Cards contain the authors' own paraphrases plus short attributed quotations (≤30 words) for scholarly verification. The Replication Recipe questions (Brandt et al., 2014) are included with attribution as a fill-in template, and the official template is on [OSF](https://osf.io/4jd46/).

## The ten stages

1. Choose & justify the target
2. Define aim & replication type
3. Gather materials & contact authors
4. Reproduce before you replicate
5. Check measurement & construct validity
6. Plan design & sample size
7. Document differences from the original
8. Preregister
9. Analysis & success criteria
10. Interpret, report & publish

Stages 1, 6 and 9 are **expert check-points**. Beyond the stages there is the full 36-question **Replication Recipe**, a **draft preregistration export** (a Word document in the Replication Recipe format, filled from the team's Recipe answers and, where those are blank, from their stage worksheets, with remaining gaps highlighted), a searchable **Evidence base**, an in-app **feedback survey** (SUS plus items on the coach), and **export** of the finished plan as Markdown and JSON.

## Running locally

```bash
npm install
cp .env.example .env         # add your ANTHROPIC_API_KEY
node --env-file=.env server/index.js
# open http://localhost:3000
```

Node 20 or later. There's no build step: the front end is plain HTML, CSS and JS in `public/`.

## Deploying (GitHub + Render)

See [`docs/DEPLOY.md`](docs/DEPLOY.md). In short: push this repo to GitHub, then on Render choose **New → Blueprint** and select the repo. `render.yaml` sets up the web service and a Postgres database for research logs. Then set `ANTHROPIC_API_KEY` and `ACCESS_CODE`.

## Configuration

| variable | default | meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | server key used by participants who enter the access code |
| `ACCESS_CODE` | — | workshop code; if empty, anyone can use the server key |
| `ALLOW_BYO_KEY` | `true` | lets visitors use their own Anthropic key (kept only in their browser tab) |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` | model id; check the Anthropic docs for current models |
| `MAX_TOKENS` | `1200` | maximum length of each coach reply |
| `RATE_PER_HOUR` | `60` | coach requests per session per hour (server key only) |
| `DATABASE_URL` | — | Postgres for research logs; if not set, logs go to `data/events.jsonl` |
| `ADMIN_TOKEN` | — | required to download the logs from `/api/admin/export` |

## Research use

- Participants choose whether to take part when they start. Without consent, nothing is logged.
- Logged events: coach turns (with citation validity), stage views, checklist ticks, reply ratings, citation opens and flags, survey answers, exported plans.
- Download the logs with `curl -H "x-admin-token: $ADMIN_TOKEN" https://<your-app>/api/admin/export > events.jsonl`, then run `python3 scripts/analyse_logs.py events.jsonl`.
- Protocol, rubric and consent materials are in [`evaluation/`](evaluation/).

## Contributing and reviewing cards

Expert review of the evidence cards is welcome and planned. See [`CONTRIBUTING.md`](CONTRIBUTING.md) and `evaluation/card-review-sheet.csv`.

## Citation

See [`CITATION.cff`](CITATION.cff). After the first GitHub release, archive it on Zenodo to get a DOI.

## License

Code: MIT. Evidence cards (paraphrased guidance, actions, structure): CC BY 4.0. Quoted excerpts remain the copyright of their authors and publishers and are included as short scholarly quotations.
