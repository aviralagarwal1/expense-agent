# Expense Agent

Turn screenshots of your credit card app into a reviewed, deduplicated expense
log — in about 30 seconds per batch.

## What it is

Expense Agent is a small web app for people who don't want to type transactions
into a spreadsheet and don't want a firehose import from every account they
own. You sign in with Google, screenshot the transaction list in any credit
card app, pick which card the batch is for, and upload. The app extracts every
charge, cross-checks it against your history, and asks you to sign off on what
to save.

The result is a clean, reviewed log that you actually trust.

## Why it exists

Most expense tools either import nothing (you type it in) or everything (noisy
Plaid feeds you still have to clean up). Expense Agent sits in between:

- **You** decide when to capture expenses.
- **You** decide which card each upload is for.
- **You** confirm every line before it lands in history.
- The AI only handles the tedious part — reading charges off the screen and
  flagging duplicates.

## What a typical session looks like

1. Sign in with Google.
2. Save your display name, at least one card, and your Anthropic API key.
3. Pick a saved card and drop in one or more screenshots.
4. The app shows three lists:
   - **New** — charges not in your history. Stage them.
   - **Skipped** — exact matches already in your history. Hidden by default.
   - **Needs review** — same vendor, card, and amount within a day of an
     existing entry. You decide whether it's a real second charge or a
     duplicate.
5. Confirm. Approved rows are saved to your history.
6. The History page shows everything grouped by month, with spend trends and a
   per-card breakdown.

## Why bring-your-own API key

Every user connects their own Anthropic key in Settings. That means:

- Usage bills directly to your Anthropic account.
- Your data doesn't pass through a shared key or a shared budget.
- The app scales to any number of users without a central cost center.

## Tech, at a glance

- Python + Flask backend
- Server-rendered HTML + vanilla JavaScript (no build step)
- Anthropic Claude Vision for extraction
- Supabase for Google auth and per-user data
- Deployed as a container (Google Cloud Run-ready)

## Running it locally

```bash
pip install -r requirements.txt
python app.py
```

Then open `http://localhost:5000`. You'll need a Supabase project with Google
auth enabled and a few environment variables filled in — see `.env.example`.
Once the server is up, sign in with Google, save an Anthropic API key in
Settings, save at least one card, and you're ready to upload.

## Status

Actively being refined. The core flow — screenshots → extraction →
deduplication → reviewed history — is fully working. Next up: a History screen
refresh and CSV export.

## Author

Aviral Agarwal
