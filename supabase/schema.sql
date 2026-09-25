-- Compline database schema. Run once in the Supabase SQL editor.
--
-- The Flask server talks to these tables with the service-role key, which
-- bypasses row-level security. RLS is enabled with no policies so the public
-- (anon) key can never read or write them directly.

create extension if not exists pgcrypto;

-- Confirmed charges. An upload is the set of rows that share a batch_id.
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  vendor      text not null,
  card        text,
  date        date,
  amount      numeric(12, 2) not null,
  status      text not null default 'settled',   -- 'settled' or 'pending'
  memo        text,
  batch_id    uuid,
  created_at  timestamptz not null default now()
);

create index if not exists transactions_user_date_idx on public.transactions (user_id, date desc);
create index if not exists transactions_user_batch_idx on public.transactions (user_id, batch_id);

-- One row per user. The column name is historical: it holds a JSON settings
-- blob (profile, saved cards, and daily screenshot usage), never an API key.
create table if not exists public.user_settings (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  anthropic_api_key  text
);

alter table public.transactions enable row level security;
alter table public.user_settings enable row level security;
