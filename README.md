# Expense Agent

Expense Agent is a Flask web app that turns credit card screenshots into a reviewed expense log.
Users upload screenshots from apps like Amex, Chase, or Capital One, Claude extracts the expense
transactions, the backend checks them against prior history, and the user confirms what should be saved.

## What it does

- Supports account-based usage with Supabase Auth
- Stores a separate transaction history for each user
- Uses each user's own Anthropic API key for screenshot extraction
- Detects exact duplicates and nearby-date possible duplicates
- Keeps pending and settled transactions visible during review
- Shows saved history grouped by month

## Product flow

1. Create an account and verify the email address
2. Add an Anthropic API key in Settings
3. Upload card screenshots
4. Review new transactions, skipped duplicates, and possible duplicates
5. Confirm what should be written to the log
6. Inspect saved history on the History page

## Stack

- Backend: Python, Flask
- Frontend: server-rendered HTML, CSS, vanilla JavaScript
- AI extraction: Anthropic Claude Vision
- Auth and database: Supabase Auth + Postgres
- Deployment target: Google Cloud Run

## Local development

### Requirements

- Python 3.11+
- A Supabase project with the expected tables
- An Anthropic API key for local fallback testing, if needed

### Environment variables

Copy `.env.example` to `.env` and fill in:

```env
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
ANTHROPIC_API_KEY=...
```

Notes:

- `ANTHROPIC_API_KEY` is only a local development fallback
- in the product flow, users normally supply their own Anthropic API key
- `SUPABASE_ANON_KEY` is not required by the current server-rendered frontend

### Run

```bash
pip install -r requirements.txt
python app.py
```

Then open `http://localhost:5000`.

## Project status

This project is actively being refined. The current implementation is focused on:

- clean screenshot-to-log review flow
- user-specific transaction storage
- duplicate handling
- simple mobile-friendly UI

Planned improvements include deletion from history, CSV export, and more production polish.
