# Deploying with GitHub + Render

No coding is needed. It takes about 20 minutes.

## 1. Put the code on GitHub

1. Create a free account at <https://github.com> if you don't have one.
2. Click **New repository** and name it `replication-navigator`. Choose **Public** (needed for a citable, open methods tool) and **don't** add a README.
3. Upload the files:
   - **Easiest:** on the empty repo page, click **uploading an existing file** and drag in everything from this folder *except* `node_modules` and `data` (if present).
   - **Or with the terminal**, from inside this folder:
     ```bash
     git init && git add . && git commit -m "Replication Navigator v0.1"
     git branch -M main
     git remote add origin https://github.com/<your-username>/replication-navigator.git
     git push -u origin main
     ```
4. Edit `CITATION.cff` and replace `<your-username>` in the repository URL.

## 2. Get an Anthropic API key

1. Go to <https://console.anthropic.com>, create an account, add billing and set a **monthly spend limit**.
2. Under **API keys**, create a key and copy it (it starts with `sk-ant-`).

**Rough cost for the pilot:** the evidence base is about 43k tokens per request, but it is cached, so repeat requests are cheap. With 40 people each making about 30 requests, expect somewhere in the tens of US dollars. Check current prices on Anthropic's pricing page, and set a spend limit anyway.

## 3. Deploy on Render

1. Create an account at <https://render.com> and sign in with GitHub.
2. Click **New → Blueprint** and select your `replication-navigator` repo. Render reads `render.yaml`.
3. When asked, fill in:
   - `ANTHROPIC_API_KEY`: your key
   - `ACCESS_CODE`: a short code for the summit, e.g. `OSM2026`
4. Click **Apply**. After a few minutes, your app is live at `https://replication-navigator-xxxx.onrender.com`.
5. In the Render dashboard, open the service's **Environment** tab and copy the generated `ADMIN_TOKEN`. You'll need it to download the research logs.

### Before the summit

- **Cold starts.** On the free plan the app sleeps after 15 minutes idle and takes about a minute to wake up. Either upgrade the web service to a paid always-on instance for the summit period, or open the app yourself 5 minutes before the session.
- **Database expiry.** Render's free Postgres **expires 30 days after creation**. Create the Blueprint within 30 days of the summit, or choose a paid database plan, and export the logs straight after the pilot (step 4).
- **Check the model id.** `ANTHROPIC_MODEL` defaults to `claude-sonnet-4-5`. Check <https://docs.claude.com/en/docs/about-claude/models> and update it in Render's Environment tab if needed.
- **Run the offline evaluation** against the live app:
  ```bash
  BASE_URL=https://<your-app>.onrender.com ACCESS_CODE=OSM2026 node scripts/eval_coach.mjs 3
  ```

## 4. Download the research logs

```bash
curl -H "x-admin-token: <ADMIN_TOKEN>" https://<your-app>.onrender.com/api/admin/export > events.jsonl
python3 scripts/analyse_logs.py events.jsonl --out analysis
```

## 5. Updating

Every push to `main` on GitHub redeploys automatically. To change the evidence base, edit `knowledge/*.json`, then run `node scripts/check-knowledge.js` and `python3 scripts/verify_cards.py --pdf-dir <pdfs>`. After a release, tag it (e.g. `v0.2`) and archive it on Zenodo for a DOI.
