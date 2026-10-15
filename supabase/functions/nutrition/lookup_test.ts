// Run: deno test supabase/functions/nutrition/lookup_test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { eaten, facts, key, kind, lookup, parseRead, rank, search } from "./lookup.ts";

const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const fail = (s: number) => new Response("{}", { status: s });
const LABEL = { kcal: 383, protein_g: 30, carbs_g: 40, fat_g: 11.5, fibre_g: 8 };

// A fake fetch that records calls and answers by host.
function fake(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: string[] = [];
  const f = ((u: string | URL | Request) => {
    const h = new URL(String(u)).hostname;
    calls.push(h);
    const r = routes[h];
    return r ? Promise.resolve(r()) : Promise.reject(new Error("no route " + h));
  }) as typeof fetch;
  return { f, calls };
}

Deno.test("key normalises case, spaces and punctuation", () => {
  assertEquals(key("  PHAB  Protein-Bar! "), "phab protein bar");
  assertEquals(key("Haldiram's Bhujia"), "haldiram s bhujia");
});

Deno.test("kind prefers the brand's own site, then Indian retailers", () => {
  assertEquals(kind("https://www.phab.in/products/bar", "Phab Protein Bar"), "manufacturer");
  assertEquals(kind("https://www.bigbasket.com/pd/1", "Phab Protein Bar"), "retailer");
  assertEquals(kind("https://www.fatsecret.co.in/x", "Phab Protein Bar"), "third_party");
});

Deno.test("rank puts the label first and trims snippets", () => {
  const hits = [
    { title: "a", url: "https://fatsecret.com/a", text: "x".repeat(900) },
    { title: "b", url: "https://phab.in/b", text: "label" },
    { title: "c", url: "https://amazon.in/c", text: "copy" },
  ];
  const r = rank(hits, "Phab Protein Bar");
  assertEquals(r.map((h) => h.title), ["b", "c", "a"]);
  assertEquals(r[2].text.length, 600);
});

Deno.test("facts rejects impossible or inconsistent rows", () => {
  assertEquals(facts(LABEL, 900), LABEL);
  assertEquals(facts({ ...LABEL, fibre_g: undefined }, 900)?.fibre_g, null);
  assertEquals(facts({ ...LABEL, kcal: 950 }, 900), null);       // over 900 per 100 g
  assertEquals(facts({ ...LABEL, kcal: 100 }, 900), null);       // macros say ~383
  assertEquals(facts({ ...LABEL, protein_g: -1 }, 900), null);
  assertEquals(facts({ kcal: 243.2, protein_g: 21, carbs_g: 27.6, fat_g: null }, 3000)?.fat_g, 5.4); // derived
  assertEquals(facts({ kcal: 243.2, protein_g: 21, carbs_g: null, fat_g: null }, 3000), null);      // two missing
  assertEquals(facts({ kcal: "383", protein_g: "30", carbs_g: "40", fat_g: "11.5" }, 900)?.kcal, 383);
});

Deno.test("eaten scales by grams, else by servings", () => {
  const f = { found: true, name: "x", per100: LABEL, serving: null, serving_g: 65, serving_desc: "1 bar", source_url: null, source_kind: null } as const;
  assertEquals(eaten({ ...f }, 50, 1)?.kcal, 191.5);              // 50 g
  assertEquals(eaten({ ...f }, null, 2)?.kcal, 497.9);            // 2 bars of 65 g
  assertEquals(eaten({ ...f, serving: { ...LABEL, kcal: 250 } }, null, 1)?.kcal, 250);
  assertEquals(eaten({ ...f, serving_g: null }, null, 1), null);  // no way to size it
});

Deno.test("parseRead keeps a known url and refuses found=false", () => {
  const hits = [{ title: "t", url: "https://phab.in/b", text: "" }];
  assertEquals(parseRead("Phab Protein Bar", { found: false }, hits), null);
  const r = parseRead("Phab Protein Bar", { found: true, per100: LABEL, serving_g: 65, url: "https://evil.example" }, hits)!;
  assertEquals(r.source_url, "https://phab.in/b");               // invented url replaced
  assertEquals(r.source_kind, "manufacturer");
});

Deno.test("search falls back to Exa when Tavily is out of credits", async () => {
  const { f, calls } = fake({
    "api.tavily.com": () => fail(432),
    "api.exa.ai": () => ok({ results: [{ title: "Phab", url: "https://phab.in", text: "383 kcal" }] }),
  });
  const r = await search("Phab Protein Bar", { tavily: "t", exa: "e" }, f);
  assertEquals(r?.via, "exa");
  assertEquals(calls, ["api.tavily.com", "api.exa.ai"]);
});

Deno.test("search falls back on a network error and on empty results", async () => {
  const a = fake({ "api.exa.ai": () => ok({ results: [{ title: "t", url: "https://x.in", text: "y" }] }) });
  assertEquals((await search("x", { tavily: "t", exa: "e" }, a.f))?.via, "exa");
  const b = fake({ "api.tavily.com": () => ok({ results: [] }), "api.exa.ai": () => ok({ results: [] }) });
  assertEquals(await search("x", { tavily: "t", exa: "e" }, b.f), null);
});

Deno.test("search uses Tavily alone when it answers", async () => {
  const { f, calls } = fake({ "api.tavily.com": () => ok({ results: [{ title: "t", url: "https://x.in", content: "y" }] }) });
  assertEquals((await search("x", { tavily: "t", exa: "e" }, f))?.via, "tavily");
  assertEquals(calls, ["api.tavily.com"]);
});

Deno.test("lookup: cache hit skips search and AI", async () => {
  const { f, calls } = fake({});
  let read = 0;
  const store = { get: () => Promise.resolve({ found: true, name: "x", per100: LABEL } as any), put: () => Promise.resolve() };
  const r = await lookup("Phab Protein Bar", { tavily: "t" }, store as any, () => { read++; return Promise.resolve({}); }, f);
  assertEquals(r.from, "cache");
  assertEquals(calls.length + read, 0);
});

Deno.test("lookup: miss searches, reads, and caches the result", async () => {
  const { f } = fake({ "api.tavily.com": () => ok({ results: [{ title: "t", url: "https://phab.in/b", content: "383 kcal" }] }) });
  const saved: unknown[] = [];
  const store = { get: () => Promise.resolve(undefined), put: (...a: unknown[]) => { saved.push(a); return Promise.resolve(); } };
  const r = await lookup("Phab Protein Bar", { tavily: "t" }, store as any,
    (p) => { assert(p.includes("phab.in")); return Promise.resolve({ found: true, per100: LABEL, serving_g: 65, url: "https://phab.in/b" }); }, f);
  assertEquals(r.from, "tavily");
  assertEquals(r.found?.per100?.kcal, 383);
  assertEquals(saved.length, 1);
});

Deno.test("lookup: search or AI down returns null and caches nothing", async () => {
  const saved: unknown[] = [];
  const store = { get: () => Promise.resolve(undefined), put: (...a: unknown[]) => { saved.push(a); return Promise.resolve(); } };
  const down = fake({});
  assertEquals((await lookup("x", { tavily: "t", exa: "e" }, store as any, () => Promise.resolve({}), down.f)).found, null);
  const up = fake({ "api.tavily.com": () => ok({ results: [{ title: "t", url: "https://x.in", content: "y" }] }) });
  assertEquals((await lookup("x", { tavily: "t" }, store as any, () => Promise.reject(new Error("ai")), up.f)).found, null);
  assertEquals(saved.length, 0);
});

Deno.test("search falls back to Exa when Tavily hangs past the timeout", async () => {
  const f = ((u: string, o: RequestInit) => new URL(u).hostname === "api.exa.ai"
    ? Promise.resolve(ok({ results: [{ title: "t", url: "https://x.in", text: "y" }] }))
    : new Promise<Response>((_, no) => o.signal!.addEventListener("abort", () => no(o.signal!.reason)))) as typeof fetch;
  const t = Date.now();
  assertEquals((await search("x", { tavily: "t", exa: "e" }, f))?.via, "exa");
  assert(Date.now() - t < 7_000);
});
