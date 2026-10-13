-- Nutrition tracking: meals and per-user targets. Additive only; measurements untouched.

create table if not exists meals (
  id          uuid primary key,              -- made by the app, so a retry never saves twice
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  eaten_on    date not null,                 -- Asia/Kolkata calendar date
  meal        text check (meal in ('breakfast','lunch','dinner','snack')),
  description text not null check (char_length(description) between 1 and 1000),
  kcal        numeric not null check (kcal between 0 and 5000),
  protein_g   numeric not null check (protein_g between 0 and 500),
  carbs_g     numeric not null check (carbs_g between 0 and 1000),
  fat_g       numeric not null check (fat_g between 0 and 500),
  fibre_g     numeric not null check (fibre_g between 0 and 200),
  assumptions text,
  confidence  text check (confidence in ('low','medium','high')),
  advice      text,
  ai          jsonb,                         -- the AI's first answer, kept unchanged
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists meals_user_day on meals (user_id, eaten_on);

alter table meals enable row level security;
drop policy if exists "own rows" on meals;
create policy "own rows" on meals
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists nutrition_settings (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  kcal       int not null default 1950 check (kcal between 800 and 6000),
  tdee       int not null default 2500 check (tdee between 800 and 6000),
  protein_g  int not null default 120  check (protein_g between 20 and 400),
  fibre_g    int not null default 25   check (fibre_g between 5 and 100),
  avoid      text check (char_length(avoid) <= 500),   -- foods that bloat you
  updated_at timestamptz not null default now()
);

alter table nutrition_settings enable row level security;
drop policy if exists "own rows" on nutrition_settings;
create policy "own rows" on nutrition_settings
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
