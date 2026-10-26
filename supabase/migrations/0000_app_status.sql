-- Phase 0: one public, read-only row. The daily GitHub job reads it so the free project never pauses
-- (Supabase pauses free projects after 7 days without activity).
create table if not exists public.app_status (
    id int primary key default 1 check (id = 1)
    , created_at timestamptz not null default now()
);

insert into public.app_status (id) values (1) on conflict do nothing;

alter table public.app_status enable row level security;

-- Anyone may read it; nobody can write it through the API (no insert/update/delete policies).
drop policy if exists "app_status is public" on public.app_status;
create policy "app_status is public" on public.app_status for select using (true);
