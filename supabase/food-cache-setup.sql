-- Web label lookups, shared by all users (a product's label is not personal).
-- Only the nutrition function writes and reads it, with the service role.
create table if not exists food_cache (
  key          text primary key check (char_length(key) between 1 and 200),  -- normalised product name
  name         text not null,
  found        boolean not null,       -- false = searched, no label found (kept 7 days)
  per100       jsonb,                  -- {kcal, protein_g, carbs_g, fat_g, fibre_g} per 100 g
  serving      jsonb,                  -- same, per label serving
  serving_g    numeric,
  serving_desc text,
  source_url   text,
  source_kind  text check (source_kind in ('manufacturer','retailer','third_party')),
  via          text,                   -- tavily or exa
  fetched_at   timestamptz not null default now()   -- reused for 30 days
);
alter table food_cache enable row level security;   -- no policies: users cannot read or write
revoke all on food_cache from anon, authenticated;
