# Expense Agent

Expense Agent turns credit card app screenshots into a reviewed expense log.

Live app: [expenseagent.aviralagarwal.com](https://expenseagent.aviralagarwal.com)

![Expense Agent screenshot](static/expense-agent-screenshot.png)

## Overview

Many personal expense tools sit at one of two extremes. They either require fully manual entry, or they pull in every account and every transaction whether you want them or not.

Expense Agent is designed for the middle ground. It lets a user capture transactions intentionally, in batches, from screenshots they choose to upload. The app extracts the transactions, compares them against previously logged history, separates clear duplicates from likely new items, and asks for confirmation before anything is saved.

The result is a single ledger across multiple cards without needing direct bank integrations.

## Use Case

This app is useful for someone who:

- wants one place to review spending across multiple credit cards
- does not want to type every charge manually
- does not want a full automatic import pipeline
- prefers to verify expenses before they are added to history

The workflow is deliberately selective. A user uploads screenshots only when they want to capture a batch of spending.

## How It Works

1. Sign in with Google.
2. Save an Anthropic API key and at least one card label.
3. Upload one or more screenshots from a credit card app.
4. The app extracts transactions from the screenshots with Claude Vision.
5. The extracted transactions are compared against the user's existing history.
6. The app returns three groups:
   - new transactions
   - skipped transactions that appear to be exact duplicates
   - possible duplicates that need a manual decision
7. The user confirms what should be added.
8. Confirmed rows are written to a single per-user transaction history.

Each upload is associated with one selected saved card, but all confirmed transactions flow into the same ledger.

## Core Functionality

- Google OAuth authentication through Supabase
- Bring-your-own Anthropic API key
- Saved card labels with optional identifying digits
- Screenshot upload and transaction extraction
- Duplicate detection against prior history
- Review step before insertion
- Unified transaction history across cards
- Summary, transaction, and batch views
- CSV export for transactions and batches
- PDF and PPTX-style summary export from the history page

## Technical Architecture

Expense Agent is a small server-rendered web application with a simple deployment shape.

- Backend: Python + Flask
- Frontend: HTML, CSS, and vanilla JavaScript
- AI extraction: Anthropic Claude Vision
- Auth and database: Supabase
- Deployment: Docker, designed for Google Cloud Run

The backend lives primarily in a single `app.py` file and handles:

- OAuth start and callback flow
- user settings and saved card management
- screenshot ingestion
- Anthropic API calls
- duplicate classification
- transaction persistence and editing APIs

The frontend is intentionally lightweight. Most pages are server-rendered templates, and the history experience is driven by a single client-side script with no build step.

## Data Model

The app relies on two main persistence concepts:

- `user_settings`: stores the user's Anthropic API key, profile information, and saved cards
- `transactions`: stores confirmed expense rows, including vendor, card label, amount, date, status, and optional batch id

Batch history is derived from groups of transactions that share a `batch_id`. There is no separate batches table.

## Local Development

### Requirements

- Python 3.11
- A Supabase project with Google auth enabled
- An Anthropic account for screenshot extraction

### Setup

```bash
pip install -r requirements.txt
python app.py
```

Then create a local `.env` from `.env.example` and set:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `APP_URL`

For local development, `APP_URL=http://127.0.0.1:5000` is sufficient.

In Supabase Auth, allow the following callback URL:

```text
http://127.0.0.1:5000/auth/callback
```

## Deployment Notes

The repository includes a `Dockerfile` and a helper script, `scripts/generate_cloudrun_env.py`, for generating a Cloud Run env-vars YAML from a local `.env` file.

In production, the app expects:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `APP_URL`

`APP_URL` should match the public origin used for Google OAuth callbacks.

## License

MIT. See [LICENSE](LICENSE).
