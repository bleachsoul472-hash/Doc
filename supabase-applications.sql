-- Run this SQL once in Supabase SQL Editor.
create table if not exists public.ms3dh_applications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  discord_id text not null,
  age integer not null,
  experience text not null,
  reason text not null,
  availability text not null,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists ms3dh_applications_created_at_idx on public.ms3dh_applications (created_at desc);
create table if not exists public.ms3dh_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.ms3dh_applications enable row level security;
alter table public.ms3dh_settings enable row level security;
-- Do not create public policies. Access is through the Netlify Function using the server-side service role key.

-- Support requests submitted through the website and replies sent by staff.
create table if not exists public.ms3dh_support_tickets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  discord_id text not null,
  category text not null,
  message text not null,
  status text not null default 'open' check (status in ('open','replied')),
  reply text,
  created_at timestamptz not null default now(),
  replied_at timestamptz
);
create index if not exists ms3dh_support_tickets_created_at_idx on public.ms3dh_support_tickets (created_at desc);
alter table public.ms3dh_support_tickets enable row level security;
-- No public policies: all reads/writes use the server-side Netlify function.

-- Add application type to existing installations safely.
alter table public.ms3dh_applications add column if not exists type text not null default 'moderation';
