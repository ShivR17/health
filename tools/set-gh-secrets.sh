#!/usr/bin/env bash
# Copy the local Supabase credentials into the repo's GitHub Actions secrets,
# so the keepalive workflow can reach the database. gh encrypts them locally
# before upload; the values are never printed and never enter a commit.
set -euo pipefail

REPO="ShivR17/health"
ENV_FILE="$HOME/.config/health/env"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a
: "${SUPABASE_URL:?}" "${SUPABASE_SECRET:?}"

printf '%s' "$SUPABASE_URL"    | gh secret set SUPABASE_URL    --repo "$REPO"
printf '%s' "$SUPABASE_SECRET" | gh secret set SUPABASE_SECRET --repo "$REPO"

echo "secrets set:"
gh secret list --repo "$REPO"
