-- Health tracker: schema, security, heartbeat. Run once.

create table if not exists measurements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null default auth.uid(),
  taken_on    date not null,
  week        numeric,
  source      text default 'manual' check (source in ('manual','scan_image','blood_pdf')),
  lab         text,
  -- body composition
  weight_kg numeric, body_fat_pct numeric, muscle_kg numeric, visceral numeric,
  bmi numeric, bmr int, muscle_quality int, waist_in numeric,
  -- blood
  insulin numeric, glucose numeric, homa_ir numeric, hba1c numeric,
  ldl numeric, non_hdl numeric, hdl numeric, triglycerides numeric, apob numeric,
  lpa numeric, hscrp numeric, vitamin_d numeric, b12 numeric, folate numeric,
  homocysteine numeric, tsh numeric, alt numeric, ast numeric,
  ferritin numeric, haemoglobin numeric, egfr numeric, testosterone numeric,
  -- provenance (used from Phase B onward)
  raw_file    text,
  extracted   jsonb,
  confirmed   boolean default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (user_id, taken_on)
);

alter table measurements enable row level security;

drop policy if exists "own rows" on measurements;
create policy "own rows" on measurements
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- keepalive target: free projects pause after 7 idle days
create table if not exists heartbeat (
  id int primary key default 1,
  pinged_at timestamptz default now()
);
insert into heartbeat (id, pinged_at) values (1, now())
  on conflict (id) do nothing;
alter table heartbeat enable row level security;
