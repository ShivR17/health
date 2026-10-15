# Health tracker

Personal health plan as an installable PWA. Live: https://shivr17.github.io/health/

Single file app (`index.html`), vanilla JS, no build step. Backend is Supabase. Everything runs on free tiers.

## Features
- **Today**: phase plan, IST date and week, food card (calories vs target, protein and fibre bars), meal list, meal input box, meal reminders switch.
- **Plan**: daily targets (1,950 kcal, TDEE about 2,500, 120 g protein, 25 g fibre), editable, plus training notes.
- **Log**: body measurements, blood panels, InBody scan reader, per-day meal log.
- **Data**: body charts and a 7 or 30 day nutrition chart.
- **Food estimates**: an AI model reads meal text for kcal, macros, fibre, and a tip. The app shows each estimate for checking before saving. Daily totals are computed in the app, never by the AI.
- **Reminders**: Web Push at 14:00 IST (breakfast, lunch) and 21:00 IST (dinner, snack) if nothing is logged. Fasting days are skipped.

## Architecture

```
index.html              the whole app
sw.js                   service worker: caches the shell, cache-first, refreshes in background
manifest.webmanifest    install metadata
icons/                  built by tools/make-icons.py from icons/source.webp
supabase-setup.sql      base tables (measurements)
supabase/
  nutrition-setup.sql   meals, nutrition_settings
  reminders-setup.sql   push_subs, push_keys, two pg_cron jobs
  food-cache-setup.sql  food_cache
  functions/
    extract/            reads InBody scans and blood reports (Gemini)
    nutrition/          meal text to nutrition values; lookup.ts (see LOOKUP.md)
    remind/             Web Push reminders; VAPID keys stay server-side
tools/                  helper scripts, run from the repo root
.github/workflows/keepalive.yml   keepalive, every 3 days
```

Supabase Postgres uses row-level security and email and password auth. Edge Functions run on Deno. Branded foods check the cache (30 days), then Tavily, then Exa, then a small AI read.

## Setup and deploy

1. Run the SQL in Supabase: `supabase-setup.sql` (already applied), then `supabase/nutrition-setup.sql`, `supabase/reminders-setup.sql`, `supabase/food-cache-setup.sql`.
2. Deploy the functions:
   - `nutrition` and `extract`: `verify_jwt` on.
   - `remind`: `verify_jwt` off. It checks its own cron key.
3. Set the secrets (see below).
4. Push to `main`. GitHub Pages serves the app.

Helper scripts (read `~/.config/health/env`):

- `tools/sb.sh <METHOD> <path> [json]`: Supabase REST calls.
- `tools/backfill.py`: loads baseline scans and blood panels (idempotent).
- `tools/set-gh-secrets.sh`: copies local credentials into GitHub Actions secrets.
- `tools/set-supabase-secrets.sh`: sets Edge Function secrets.
- `tools/make-icons.py`: rebuilds the icons.
- `tools/gemini-probe.py`: checks which Gemini models the key can reach.
- `tools/test-extract.py`: end-to-end test of `extract`.

The secret key lives only in `~/.config/health/env` on the owner's Mac. It is never committed.

## Secrets

| Name | Required | Used by |
|---|---|---|
| `GEMINI_API_KEY` | yes | `extract`, `nutrition` |
| `GROQ_API_KEY` | no | `nutrition` (races Gemini) |
| `TAVILY_API_KEY` | no | `nutrition` lookup |
| `EXA_API_KEY` | no | `nutrition` lookup |

All are free tiers.

## Tests

```
deno test supabase/functions/nutrition/lookup_test.ts
```
