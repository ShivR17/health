# Label lookup for packaged foods

Flow, inside the `nutrition` function:

1. The AI estimates the meal as before (Gemini and Groq race; fallbacks unchanged).
   It also lists branded or packaged items in `packaged`, with the name spelled correctly.
2. For each such item (at most 3, in parallel, 15 s budget):
   cache (30 days; 7 days for "not found") → Tavily basic search (6 s) →
   Exa search (6 s) on error, timeout, no credits or no results →
   a small AI read of the 4 best snippets (Groq `gpt-oss-120b`, low effort; Gemini if Groq fails).
   Manufacturer sites rank first, then Indian retailers, then nutrition sites.
3. If a label is found, its numbers replace the AI guess for that item, the meal
   totals are adjusted, and the source is added to the assumptions line.
   If anything fails, the original estimate is returned unchanged.

Home-cooked food is never searched.

## Secrets (Supabase → Edge Functions → Secrets)

| Name | Where to get it | Free tier |
|---|---|---|
| `TAVILY_API_KEY` | app.tavily.com | 1,000 credits a month; basic search = 1 credit |
| `EXA_API_KEY` | dashboard.exa.ai | free starter credits |

Either one alone works. With neither, the lookup is skipped.
`GEMINI_API_KEY` and `GROQ_API_KEY` are already set.

## Deploy

1. Run `supabase/food-cache-setup.sql` (creates `food_cache`).
2. Add the secrets above.
3. Deploy the `nutrition` function with `index.ts` and `lookup.ts` (`verify_jwt` on).

## Tests

    deno test supabase/functions/nutrition/lookup_test.ts
