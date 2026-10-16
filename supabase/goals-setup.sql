-- Editable goals for the Settings page. Additive only; nullable, app falls back to defaults.
alter table nutrition_settings
  add column if not exists eng_date date,
  add column if not exists wed_date date,
  add column if not exists eng_kg numeric check (eng_kg is null or eng_kg between 30 and 250),
  add column if not exists wed_kg numeric check (wed_kg is null or wed_kg between 30 and 250);
