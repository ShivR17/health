#!/usr/bin/env bash
# Push the Gemini key from this Mac into Supabase Edge Function secrets, so the
# deployed extract function can call Gemini. The key never reaches the browser
# and is never committed. Values are not printed.
set -euo pipefail

PROJECT_REF="kbevrnrmlwaipdrmpwwu"
ENV_FILE="$HOME/.config/health/env"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a
: "${GEMINI_API_KEY:?GEMINI_API_KEY not set in $ENV_FILE}"

supabase secrets set "GEMINI_API_KEY=$GEMINI_API_KEY" --project-ref "$PROJECT_REF"

echo
echo "secrets now set:"
supabase secrets list --project-ref "$PROJECT_REF"
