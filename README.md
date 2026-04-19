# Expense Agent

Turn screenshots of your credit card app into a reviewed, deduplicated expense log in ~30 seconds per batch.

## What it is

Expense Agent is a small web app for people who do not want to type every
transaction into a spreadsheet and do not want a firehose import from every
account they own. You sign in with Google, screenshot the transaction list in a
card app, pick which saved card the batch belongs to, and upload. The app
reads the charges with **Claude Vision**, compares them to your history, and
asks you to sign off before anything is saved.

The result is a ledger you chose to capture, on purpose, with duplicates
called out instead of silently doubled.

Each upload is labeled with the card it came from, yet **every** card you use
still writes into the **same** History — one ledger, summaries, and exports
across your whole wallet.

## Why it exists

Most tools either import nothing (manual entry) or everything (noisy feeds you
still reconcile). This project sits in between:

- You decide **when** to capture expenses.
- You decide **which card** each batch represents.
- **Card apps don’t talk to each other** — without a consolidation layer, your picture of spend depends on whichever issuer’s UI you opened last.
- You **confirm** lines before they land in history.
- The model only handles the tedious part: reading the screen and flagging likely duplicates.

## What a typical session looks like

1. Sign in with Google (from the landing page or the register-oriented entry point).
2. Save your display name, at least one card, and your **Anthropic API key** (bring-your-own; usage bills to your account).
3. Open the workspace, pick a card, attach one or more screenshots, and run **Analyze**.
4. Review three lists: **New**, **Skipped** (exact duplicates), and **Needs review** (fuzzy matches). Confirm what to keep.
5. Open **History** for a **Summary** dashboard, the full **Transactions** ledger, or a **Batches** view tied to each analyze session — CSV on **Transactions** and **Batches**, PDF/PPTX-style exports on **Summary**.

## Tech, at a glance

- **Backend:** Python, Flask  
- **Frontend:** Server-rendered HTML and vanilla JavaScript (no build step)  
- **AI:** Anthropic Claude Vision  
- **Auth & data:** Supabase (Google sign-in + Postgres)  
- **Deploy:** Docker-friendly; intended for **Google Cloud Run** (see `Dockerfile`)

## Running it locally

```bash
pip install -r requirements.txt
python app.py
```

Then open [http://127.0.0.1:5000](http://127.0.0.1:5000). Create a Supabase project with Google auth enabled, copy **`.env.example`** to **`.env`**, and fill in **`SUPABASE_URL`**, **`SUPABASE_SERVICE_KEY`**, and **`APP_URL`** (localhost is fine for local dev). Add **`{APP_URL}/auth/callback`** to your Supabase OAuth redirect allow list.

## Status

Personal portfolio piece: core flow (screenshots → extraction → dedupe → history)
is implemented end to end, including batch grouping and exports on History. The
repo is meant for recruiters and peers — a public **Try it** URL, README
screenshots, and small polish (favicon, social meta) are the main items left
before calling it “launched.”

## License

MIT — see [`LICENSE`](LICENSE).

## Author

Aviral Agarwal
