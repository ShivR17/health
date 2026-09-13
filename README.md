# Health tracker

Live: https://shivr17.github.io/health/

Single-file app. `index.html` is the whole thing. No build step.

| Layer | Where |
|---|---|
| App code | this repo, served by GitHub Pages |
| Data | Supabase Postgres, row-level security scoped to one user |
| Secret key | `~/.config/health/env` on Shivam's Mac only. Never here. |
| Keepalive | `.github/workflows/keepalive.yml`, every 3 days |

## tools/

Run from the repo root. All read credentials from `~/.config/health/env`.

- `tools/sb.sh <METHOD> <path> [json]` — Supabase REST calls
- `tools/backfill.py` — load baseline scans and blood panels (idempotent)
- `tools/set-gh-secrets.sh` — copy local credentials into GitHub Actions secrets

`supabase-setup.sql` created the schema. Already applied.
