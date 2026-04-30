# Expense Agent

Expense Agent turns credit card app screenshots into a reviewed expense log.

Live app: [expenseagent.aviralagarwal.com](https://expenseagent.aviralagarwal.com)

![Expense Agent screenshot](static/expense-agent-screenshot.png)

## Overview

Most expense tools force one of two extremes: fully manual entry, or full automatic import across every account. Expense Agent is built for the middle ground.

The app lets a user intentionally upload batches of screenshots from credit card apps, extract the visible transactions, compare them against prior history, and confirm what should actually be saved. The result is one reviewed ledger across multiple cards without direct bank integrations.

## What It Does

- Google sign-in through Supabase
- User-supplied Anthropic, OpenAI, or Gemini API key
- Saved credit card labels with optional identifying digits
- Screenshot upload and provider-selectable vision extraction
- Exact and fuzzy duplicate detection
- Confirmation step before insertion
- Unified transaction history across cards
- Summary, transaction, and batch history views
- Per-transaction notes for user context
- CSV export for transactions and batches
- Browser PDF/print and PPTX summary export from the history page

## Typical Flow

1. Sign in with Google.
2. Save an Anthropic, OpenAI, or Gemini API key.
3. Save at least one credit card label.
4. Upload one or more screenshots from a credit card app.
5. Review new transactions, skipped duplicates, and possible duplicates.
6. Confirm the rows that should be written to history.
7. Review everything later in the history views.

Each upload is tied to one selected credit card, but all confirmed rows are written into the same per-user ledger.

## Architecture

Expense Agent is a small server-rendered web app with a deliberately simple stack.

- Backend: Python + Flask
- Frontend: HTML, CSS, and vanilla JavaScript
- AI extraction: provider-selectable vision LLMs
- Auth and data storage: Supabase
- Deployment: Docker, designed for Google Cloud Run

The app entry point is `app.py`, with backend domain logic split into the `expense_agent/` package. Templates live in `templates/`, and page assets live in `static/css/` and `static/js/`. There is no frontend build step, bundler, or client framework.

Configured extraction providers are Anthropic, OpenAI, and Gemini. API keys are supplied by each user and are checked for plausible provider-specific formats before storage; Gemini accepts both Google AI Studio-style `AIza...` keys and Google Cloud-style `AQ....` keys.

## Data Model

The runtime uses two main persistence concepts:

- `user_settings`: stores the user's API keys, active provider, profile data, and saved credit cards in a serialized settings blob
- `transactions`: stores confirmed expense rows, including vendor, card label, amount, date, status, optional `memo`, and optional `batch_id`

Batch history is derived from groups of transactions that share a `batch_id`. There is no separate batches table.

## Local Development

### Requirements

- Python 3.11
- A Supabase project with Google auth enabled
- An Anthropic, OpenAI, or Gemini account for screenshot extraction

### Setup

```bash
pip install -r requirements.txt
python app.py
```

Then create a local `.env` from `.env.example` and set:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `APP_URL`

For local development, this is sufficient:

```text
APP_URL=http://127.0.0.1:5000
```

In Supabase Auth, allow this callback URL:

```text
http://127.0.0.1:5000/auth/callback
```

## Tests

The repo includes a lightweight smoke suite for the most refactor-sensitive backend routes.
It also includes focused validation tests for provider API key format checks.

Run it with:

```bash
python -m unittest discover -s tests -v
```

Useful validation commands:

```bash
python -m compileall -q app.py expense_agent tests
node --check static/js/index.js
node --check static/js/history.js
node --check static/js/settings.js
node --check static/js/profile_settings.js
```

## Deployment Notes

The repository includes a `Dockerfile` and a helper script, `scripts/generate_cloudrun_env.py`, for generating a Cloud Run env-vars YAML from a local `.env` file.

Production expects:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `APP_URL`

`APP_URL` should match the public origin used for Google OAuth callbacks.

## License

MIT. See [LICENSE](LICENSE).
