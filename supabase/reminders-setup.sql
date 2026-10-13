-- Meal reminders: phone subscriptions and two daily jobs. Additive only.

create table if not exists push_subs (
  endpoint   text primary key check (char_length(endpoint) <= 1000),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  p256dh     text not null check (char_length(p256dh) <= 200),
  auth       text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user on push_subs (user_id);

alter table push_subs enable row level security;
create policy "own rows" on push_subs
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Server-only keys: RLS on with no policies, so only the service role reads it.
-- The remind function fills the VAPID pair on first use; cron_key is random.
create table if not exists push_keys (
  id       int primary key check (id = 1),
  public   text,
  private  text,
  cron_key text not null default encode(extensions.gen_random_bytes(32), 'hex')
);
alter table push_keys enable row level security;
revoke all on push_keys from anon, authenticated;
insert into push_keys (id) values (1) on conflict do nothing;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 14:00 IST = 08:30 UTC (breakfast, lunch); 21:00 IST = 15:30 UTC (dinner, snack).
select cron.schedule('remind-day', '30 8 * * *', $$
  select net.http_post(
    url := 'https://kbevrnrmlwaipdrmpwwu.supabase.co/functions/v1/remind',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('slot', 'day',
      'key', (select cron_key from public.push_keys where id = 1)))
$$);
select cron.schedule('remind-night', '30 15 * * *', $$
  select net.http_post(
    url := 'https://kbevrnrmlwaipdrmpwwu.supabase.co/functions/v1/remind',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('slot', 'night',
      'key', (select cron_key from public.push_keys where id = 1)))
$$);
