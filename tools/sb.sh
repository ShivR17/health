#!/usr/bin/env bash
# Supabase REST helper. Reads credentials from ~/.config/health/env (never committed).
# Usage: ./sb.sh <METHOD> <path-after-/rest/v1-or-/auth/v1> [json-body]
#   ./sb.sh GET  "rest/v1/measurements?select=*"
#   ./sb.sh POST "rest/v1/measurements" '[{"taken_on":"2026-09-13"}]'
set -euo pipefail

ENV_FILE="$HOME/.config/health/env"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a
: "${SUPABASE_URL:?}" "${SUPABASE_SECRET:?}"

METHOD="${1:?method}"
PATHX="${2:?path}"
BODY="${3-}"

args=(-sS -X "$METHOD" "$SUPABASE_URL/$PATHX"
  -H "apikey: $SUPABASE_SECRET"
  -H "Authorization: Bearer $SUPABASE_SECRET"
  -H "Content-Type: application/json"
  -H "Prefer: return=representation,resolution=merge-duplicates"
  -w '\nHTTP %{http_code}\n')

[ -n "$BODY" ] && args+=(-d "$BODY")

curl "${args[@]}"
