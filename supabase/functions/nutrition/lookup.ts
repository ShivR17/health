// Web-grounded label lookup for packaged and branded foods.
//
// Order: cache (30 days) → Tavily basic search → Exa search → a small AI call
// that reads only the best snippets. Home-cooked dishes never come here: the
// AI estimate is good enough for dal and roti, and a search per meal would
// burn the free credits and add seconds.
//
// Every step has a timeout and every failure returns null, so the meal
// estimate the user already has is never lost.

export type Facts = { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number };
export type Hit = { title: string; url: string; text: string };
export type Found = {
  found: boolean;
  name: string;
  per100: Facts | null;
  serving: Facts | null;
  serving_g: number | null;
  serving_desc: string | null;
  source_url: string | null;
  source_kind: "manufacturer" | "retailer" | "third_party" | null;
};
export type Env = { tavily?: string; exa?: string };
type Fetch = typeof fetch;

export const FIELDS = ["kcal", "protein_g", "carbs_g", "fat_g", "fibre_g"] as const;
export const SEARCH_MS = 6_000, READ_MS = 8_000;
export const FRESH_DAYS = 30, MISS_DAYS = 7;

// Same product, same key: "PHAB  Protein-Bar!" → "phab protein bar".
export const key = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ").slice(0, 200);

// Indian grocery sites copy the printed label; nutrition sites estimate.
const RETAIL = ["bigbasket.com", "amazon.in", "blinkit.com", "zeptonow.com", "jiomart.com", "swiggy.com", "flipkart.com", "dmart.in"];
const THIRD = ["fatsecret", "nutritionix", "healthifyme", "myfitnesspal", "eatthismuch", "calorieking", "nutritionvalue"];

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

export function kind(url: string, product: string): Found["source_kind"] {
  const h = host(url);
  const brand = key(product).split(" ")[0] ?? "";
  if (brand.length >= 3 && h.replace(/[^a-z0-9]/g, "").includes(brand)) return "manufacturer";
  if (RETAIL.some((d) => h.endsWith(d))) return "retailer";
  return "third_party";
}

// Manufacturer first, then retailers, then the rest; keep it short for the AI.
export function rank(hits: Hit[], product: string, n = 4, chars = 600): Hit[] {
  const score = (h: Hit) => ({ manufacturer: 0, retailer: 1, third_party: 2 })[kind(h.url, product)!] +
    (THIRD.some((t) => host(h.url).includes(t)) ? 1 : 0);
  return hits.filter((h) => h.url && h.text)
    .map((h, i) => ({ h, s: score(h) * 100 + i }))
    .sort((a, b) => a.s - b.s).slice(0, n)
    .map(({ h }) => ({ title: h.title.slice(0, 120), url: h.url, text: h.text.replace(/\s+/g, " ").slice(0, chars) }));
}

// Tavily first; Exa on any error, timeout, no credits (432/433/402) or no results.
export async function search(product: string, env: Env, f: Fetch = fetch): Promise<{ via: string; hits: Hit[] } | null> {
  const q = `${product} nutrition facts per 100g label India`;
  if (env.tavily) {
    try {
      const r = await f("https://api.tavily.com/search", {
        method: "POST", signal: AbortSignal.timeout(SEARCH_MS),
        headers: { Authorization: `Bearer ${env.tavily}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, search_depth: "basic", max_results: 5, chunks_per_source: 3 }),
      });
      if (r.ok) {
        const b = await r.json();
        const hits = (b.results ?? []).map((x: any) => ({ title: String(x.title ?? ""), url: String(x.url ?? ""), text: String(x.content ?? "") }));
        if (hits.length) return { via: "tavily", hits };
      } else console.error("tavily", r.status);
    } catch (e) { console.error("tavily", String(e).slice(0, 120)); }
  }
  if (env.exa) {
    try {
      const r = await f("https://api.exa.ai/search", {
        method: "POST", signal: AbortSignal.timeout(SEARCH_MS),
        headers: { "x-api-key": env.exa, "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, type: "fast", numResults: 5, contents: { text: { maxCharacters: 1500 } } }),
      });
      if (r.ok) {
        const b = await r.json();
        const hits = (b.results ?? []).map((x: any) => ({ title: String(x.title ?? ""), url: String(x.url ?? ""), text: String(x.text ?? "") }));
        if (hits.length) return { via: "exa", hits };
      } else console.error("exa", r.status);
    } catch (e) { console.error("exa", String(e).slice(0, 120)); }
  }
  return null;
}

const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(+v) ? +v : NaN);

// A label row is believable when every number is present and kcal roughly
// matches the macros (labels round, and fibre may count at 2 kcal/g).
export function facts(v: any, max: number): Facts | null {
  if (!v || typeof v !== "object") return null;
  const o: any = {};
  for (const k of FIELDS) {
    const x = num(v[k]);
    if (k === "fibre_g" && isNaN(x)) { o[k] = 0; continue; }
    if (isNaN(x) || x < 0) return null;
    o[k] = Math.round(x * 10) / 10;
  }
  if (o.kcal > max || o.protein_g + o.carbs_g + o.fat_g > (max / 900) * 100 + 1) return null;
  const m = 4 * o.protein_g + 4 * o.carbs_g + 9 * o.fat_g;
  if (o.kcal > 40 && Math.abs(m - o.kcal) / o.kcal > 0.3) return null;
  return o;
}

export const READ_PROMPT = `Read these search snippets and give the nutrition label of the product.
Use the manufacturer's own label when a snippet has it; else a retailer copy of the label; else the best other source.
If the snippets do not give numbers for this exact product, found=false. Never guess.
JSON only: {"found":bool,"per100":{"kcal":n,"protein_g":n,"carbs_g":n,"fat_g":n,"fibre_g":n}|null,
"serving_g":n|null,"serving_desc":str|null,"serving":{same fields}|null,"url":str|null}`;

// Turn the AI's reading into checked numbers; null when nothing believable.
export function parseRead(product: string, j: any, hits: Hit[]): Found | null {
  if (!j || j.found !== true) return null;
  const per100 = facts(j.per100, 900);
  const sg = num(j.serving_g);
  const serving_g = sg > 0 && sg <= 2000 ? Math.round(sg) : null;
  const serving = facts(j.serving, 3000);
  if (!per100 && !serving) return null;
  const url = hits.some((h) => h.url === j.url) ? String(j.url) : hits[0]?.url ?? null;
  return {
    found: true, name: product, per100, serving, serving_g,
    serving_desc: j.serving_desc ? String(j.serving_desc).slice(0, 80) : null,
    source_url: url, source_kind: url ? kind(url, product) : null,
  };
}

// Numbers for what was eaten: grams if given, else units × label serving.
export function eaten(f: Found, amount_g: number | null, units: number): Facts | null {
  const u = units > 0 && units <= 20 ? units : 1;
  const scale = (x: Facts, k: number) =>
    Object.fromEntries(FIELDS.map((n) => [n, Math.round(x[n] * k * 10) / 10])) as Facts;
  if (amount_g && amount_g > 0 && f.per100) return scale(f.per100, amount_g / 100);
  if (f.serving) return scale(f.serving, u);
  if (f.per100 && f.serving_g) return scale(f.per100, (f.serving_g / 100) * u);
  return null;
}

// Cache in Postgres through the REST API with the service role (no extra import).
export function cache(url: string, service: string, f: Fetch = fetch) {
  const h = { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };
  const ago = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
  return {
    async get(k: string): Promise<Found | null | undefined> {
      try {
        const r = await f(`${url}/rest/v1/food_cache?key=eq.${encodeURIComponent(k)}&select=*`, {
          headers: h, signal: AbortSignal.timeout(3_000),
        });
        const row = r.ok ? (await r.json())[0] : null;
        if (!row) return undefined;
        const fresh = row.fetched_at >= ago(row.found ? FRESH_DAYS : MISS_DAYS);
        if (!fresh) return undefined;
        return row.found ? {
          found: true, name: row.name, per100: row.per100, serving: row.serving, serving_g: row.serving_g,
          serving_desc: row.serving_desc, source_url: row.source_url, source_kind: row.source_kind,
        } : null;
      } catch { return undefined; }
    },
    async put(k: string, name: string, v: Found | null, via: string) {
      try {
        await f(`${url}/rest/v1/food_cache?on_conflict=key`, {
          method: "POST", signal: AbortSignal.timeout(3_000),
          headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({
            key: k, name, found: !!v, per100: v?.per100 ?? null, serving: v?.serving ?? null,
            serving_g: v?.serving_g ?? null, serving_desc: v?.serving_desc ?? null,
            source_url: v?.source_url ?? null, source_kind: v?.source_kind ?? null, via,
            fetched_at: new Date().toISOString(),
          }),
        });
      } catch { /* cache is best effort */ }
    },
  };
}

// One product end to end. read() is the small AI call; undefined = cache miss.
export async function lookup(
  product: string, env: Env, store: ReturnType<typeof cache> | null,
  read: (prompt: string) => Promise<any>, f: Fetch = fetch,
): Promise<{ found: Found | null; from: "cache" | "tavily" | "exa" | "none" }> {
  const k = key(product);
  if (!k) return { found: null, from: "none" };
  const hit = store ? await store.get(k) : undefined;
  if (hit !== undefined) return { found: hit, from: "cache" };
  const s = await search(product, env, f);
  if (!s) return { found: null, from: "none" };           // search down: do not cache
  const top = rank(s.hits, product);
  let found: Found | null = null;
  try {
    const snippets = top.map((h, i) => `[${i + 1}] ${h.url}\n${h.title}\n${h.text}`).join("\n\n");
    found = parseRead(product, await read(`${READ_PROMPT}\n\nProduct: ${product}\n\n${snippets}`), top);
  } catch (e) {
    console.error("read", String(e).slice(0, 120));
    return { found: null, from: s.via as "tavily" | "exa" };  // AI down: do not cache
  }
  if (store) await store.put(k, product, found, s.via);
  return { found, from: s.via as "tavily" | "exa" };
}
