-- NOX: run once in Supabase Dashboard > SQL Editor
create table if not exists public.nox_site_content (
  id integer primary key check (id = 1),
  content jsonb not null default jsonb_build_object(
    'about', jsonb_build_object('ar', '', 'en', ''),
    'rules', jsonb_build_object('ar', '[]'::jsonb, 'en', '[]'::jsonb),
    'links', '[]'::jsonb,
    'channels', '[]'::jsonb,
    'news', '[]'::jsonb,
    'staff', '[]'::jsonb
  ),
  updated_at timestamptz not null default now()
);

create table if not exists public.nox_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.nox_site_content enable row level security;
alter table public.nox_admins enable row level security;

drop policy if exists "NOX admins can read own admin record" on public.nox_admins;
create policy "NOX admins can read own admin record" on public.nox_admins
for select to authenticated using (user_id = auth.uid());

drop policy if exists "Public can read NOX content" on public.nox_site_content;
create policy "Public can read NOX content" on public.nox_site_content
for select to anon, authenticated using (true);

drop policy if exists "NOX admins can insert content" on public.nox_site_content;
create policy "NOX admins can insert content" on public.nox_site_content
for insert to authenticated with check (
  exists (select 1 from public.nox_admins a where a.user_id = auth.uid())
);

drop policy if exists "NOX admins can update content" on public.nox_site_content;
create policy "NOX admins can update content" on public.nox_site_content
for update to authenticated using (
  exists (select 1 from public.nox_admins a where a.user_id = auth.uid())
) with check (
  exists (select 1 from public.nox_admins a where a.user_id = auth.uid())
);

-- Create the storage bucket for uploaded site images.
insert into storage.buckets (id, name, public)
values ('nox-assets', 'nox-assets', true)
on conflict (id) do nothing;

drop policy if exists "Public can view NOX assets" on storage.objects;
create policy "Public can view NOX assets" on storage.objects
for select to anon, authenticated using (bucket_id = 'nox-assets');

drop policy if exists "NOX admins can upload assets" on storage.objects;
create policy "NOX admins can upload assets" on storage.objects
for insert to authenticated with check (
  bucket_id = 'nox-assets' and exists (
    select 1 from public.nox_admins a where a.user_id = auth.uid()
  )
);

drop policy if exists "NOX admins can update assets" on storage.objects;
create policy "NOX admins can update assets" on storage.objects
for update to authenticated using (
  bucket_id = 'nox-assets' and exists (
    select 1 from public.nox_admins a where a.user_id = auth.uid()
  )
) with check (
  bucket_id = 'nox-assets' and exists (
    select 1 from public.nox_admins a where a.user_id = auth.uid()
  )
);

-- After creating your admin account in Supabase Authentication > Users,
-- copy its UUID and run this separately:
-- insert into public.nox_admins(user_id) values ('YOUR-AUTH-USER-UUID');

-- Ensure the public content row exists for the Netlify functions.
insert into public.nox_site_content (id, content)
values (1, jsonb_build_object(
  'about', jsonb_build_object('ar', '', 'en', ''),
  'rules', jsonb_build_object('ar', '[]'::jsonb, 'en', '[]'::jsonb),
  'links', '[]'::jsonb,
  'channels', '[]'::jsonb,
  'news', '[]'::jsonb,
  'staff', '[]'::jsonb
))
on conflict (id) do nothing;
