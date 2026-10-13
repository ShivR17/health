// Estimates calories and macros for a typed meal description.
//
// The AI estimates and suggests. It never totals the day: daily sums are
// computed in the app from saved rows. Every estimate is shown for correction
// before anything is written to the database.

// Gemini is often busy (503) or slow, so the first round asks Gemini and Groq
// at the same time and takes whichever valid answer comes first. If both fail,
// the rest are tried one by one. Each call gets at most 15 s and the whole
// request stops trying new models after ~35 s, so the app always hears back.
const GEMINI = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash"];
// Qwen's free tier allows only 1,000 output tokens a minute, so cap it.
const GROQ = [
  { model: "openai/gpt-oss-120b", extra: { reasoning_effort: "medium", include_reasoning: false, max_completion_tokens: 3000 } },
  { model: "qwen/qwen3.8-27b", extra: { reasoning_effort: "medium", reasoning_format: "hidden", max_completion_tokens: 950 } },
];
const PER_CALL = 15_000, BUDGET = 35_000;
const url = (m: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const num = { type: "NUMBER" };
const MEAL = { type: "STRING", nullable: true, enum: ["breakfast", "lunch", "dinner", "snack"] };
const ITEMS = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: { name: { type: "STRING" }, portion: { type: "STRING" }, kcal: num },
    required: ["name", "portion", "kcal"],
  },
};
const PART = {
  meal: MEAL, items: ITEMS,
  kcal: num, protein_g: num, carbs_g: num, fat_g: num, fibre_g: num,
  assumptions: { type: "STRING", description: "key portion and cooking assumptions, one short line" },
  confidence: { type: "STRING", enum: ["low", "medium", "high"] },
};
const NEED = ["items", "kcal", "protein_g", "carbs_g", "fat_g", "fibre_g", "assumptions", "confidence"];
const SCHEMA = {
  type: "OBJECT",
  properties: {
    ...PART,
    meals: {
      type: "ARRAY",
      description: "one entry per eating occasion when the text names more than one; else empty",
      items: {
        type: "OBJECT",
        properties: { description: { type: "STRING" }, ...PART },
        required: ["description", "meal", ...NEED],
      },
    },
    advice: { type: "STRING", description: "at most two sentences" },
  },
  required: [...NEED, "meals", "advice"],
};

const RULES = `You estimate the nutrition of one meal for an adult man in India.

Estimating:
- Use typical Indian portions: 1 roti ~ 30 g atta, 1 katori ~ 150 ml, restaurant
  servings larger than home. Recognise Indian restaurant dishes and branded
  packaged foods; use the brand's label values when you know them.
- When a portion, oil, ghee, butter, cream or sauce is unclear, estimate on the
  HIGH side. Restaurant food: assume generous oil.
- kcal must agree with 4*protein + 4*carbs + 9*fat within about 10%.
- Give the meal type only if the text says it or it is obvious; else null.
- confidence: high = clear items and portions; medium = some guessing; low = vague.

Several meals in one text:
- If the text names more than one eating occasion (for example "breakfast poha,
  lunch dal rice, evening snack Phab bar"), fill "meals" with one entry per
  occasion, in order. "description" is the user's own words for that part only.
  Any snack (morning, evening, tea time) is "snack". Each entry has its own numbers.
  The top-level numbers are then the sum of all entries.
- One occasion only: "meals" is [] and the top-level fields describe it.

Advice (max two sentences, practical, Indian home or restaurant food):
- Base it on the calories left after this meal, staying full within budget,
  and reaching the protein and fibre targets.
- Steer away from foods likely to cause bloating or gas (and any the user lists).
- No greetings, no medical claims, no exact totals for the day.

Reply with JSON only: {"meal": "breakfast"|"lunch"|"dinner"|"snack"|null,
"items": [{"name": str, "portion": str, "kcal": num}], "kcal": num, "protein_g": num,
"carbs_g": num, "fat_g": num, "fibre_g": num, "assumptions": str,
"confidence": "low"|"medium"|"high",
"meals": [{"description": str, "meal": ..., "items": [...], "kcal": num, "protein_g": num,
"carbs_g": num, "fat_g": num, "fibre_g": num, "assumptions": str, "confidence": ...}],
"advice": str}`;

const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : NaN);
const r1 = (v: number) => Math.round(v * 10) / 10;
const role = (req: Request) => {
  try {
    const p = (req.headers.get("authorization") ?? "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p + "=".repeat((4 - p.length % 4) % 4))).role ?? "";
  } catch {
    return "";
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  try {
    // The gateway checks the token's signature; the public anon key also
    // passes that check, so require a signed-in user to protect the quota.
    if (role(req) !== "authenticated") return json({ error: "auth", message: "Sign in first." }, 401);

    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return json({ error: "no_key", message: "Estimation is not configured." }, 500);

    const { text, so_far = {}, targets = {}, avoid = "" } = await req.json().catch(() => ({}));
    const meal = String(text ?? "").trim();
    if (!meal) return json({ error: "empty", message: "Type what you ate first." }, 400);
    if (meal.length > 1000) return json({ error: "too_long", message: "Keep it under 1,000 characters." }, 400);

    const t = {
      kcal: n(targets.kcal) || 1950, protein_g: n(targets.protein_g) || 120,
      fibre_g: n(targets.fibre_g) || 25,
    };
    const s = {
      kcal: n(so_far.kcal) || 0, protein_g: n(so_far.protein_g) || 0, fibre_g: n(so_far.fibre_g) || 0,
    };
    const context =
      `Daily targets: ${t.kcal} kcal, ${t.protein_g} g protein, ${t.fibre_g} g fibre.\n` +
      `Eaten earlier today: ${s.kcal} kcal, ${s.protein_g} g protein, ${s.fibre_g} g fibre.\n` +
      (avoid ? `Foods that bloat this user: ${String(avoid).slice(0, 500)}\n` : "") +
      `\nMeal:\n${meal}`;

    const gemini = JSON.stringify({
      contents: [{ parts: [{ text: RULES }, { text: context }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
        thinkingConfig: { thinkingLevel: "LOW" },
      },
    });
    const groqKey = Deno.env.get("GROQ_API_KEY");
    const tries: { name: string; call: (signal: AbortSignal) => Promise<Response>; text: (b: any) => string }[] = [
      ...GEMINI.map((m) => ({
        name: m,
        call: (signal: AbortSignal) => fetch(url(m), {
          method: "POST", signal,
          headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
          body: gemini,
        }),
        text: (b: any) => b?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "",
      })),
      ...(groqKey ? GROQ : []).map((g) => ({
        name: g.model,
        call: (signal: AbortSignal) => fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST", signal,
          headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: g.model, ...g.extra,
            response_format: { type: "json_object" },
            messages: [{ role: "system", content: RULES }, { role: "user", content: context }],
          }),
        }),
        text: (b: any) => b?.choices?.[0]?.message?.content ?? "",
      })),
    ];

    const start = Date.now();
    let quota = 0, failed = 0;
    const CONF = ["low", "medium", "high"], MEALS = ["breakfast", "lunch", "dinner", "snack"];

    // Clean one estimate; null when the numbers are impossible.
    const clean = (e: any) => {
      const est = {
        kcal: Math.round(n(e?.kcal)), protein_g: r1(n(e?.protein_g)), carbs_g: r1(n(e?.carbs_g)),
        fat_g: r1(n(e?.fat_g)), fibre_g: r1(n(e?.fibre_g)),
      };
      const ok = est.kcal >= 0 && est.kcal <= 5000 && est.protein_g >= 0 && est.protein_g <= 500 &&
        est.carbs_g >= 0 && est.carbs_g <= 1000 && est.fat_g >= 0 && est.fat_g <= 500 &&
        est.fibre_g >= 0 && est.fibre_g <= 200;
      if (!ok) return null;
      const fromMacros = 4 * est.protein_g + 4 * est.carbs_g + 9 * est.fat_g;
      return {
        ...est,
        meal: MEALS.includes(e.meal) ? e.meal : null,
        items: Array.isArray(e.items) ? e.items.slice(0, 20) : [],
        assumptions: String(e.assumptions ?? "").slice(0, 600),
        confidence: CONF.includes(e.confidence) ? e.confidence : "low",
        mismatch: est.kcal > 50 && Math.abs(fromMacros - est.kcal) / est.kcal > 0.25,
      };
    };

    // One model call: resolves to a checked answer or throws.
    const ask = async (t: typeof tries[number], outer?: AbortSignal) => {
      const left = BUDGET + 10_000 - (Date.now() - start);
      const signals = [AbortSignal.timeout(Math.min(PER_CALL, left))];
      if (outer) signals.push(outer);
      try {
        const res = await t.call(AbortSignal.any(signals));
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          res.status === 429 ? quota++ : failed++;
          console.error(t.name, res.status, JSON.stringify(body).slice(0, 300));
          throw new Error("http");
        }
        const e = JSON.parse(t.text(body).replace(/^```(json)?|```$/g, "").trim());
        const top = clean(e);
        if (!top) throw new Error("invalid");
        // Several occasions: each part is checked, and the totals are summed here.
        const parts = (Array.isArray(e.meals) ? e.meals : []).slice(0, 6)
          .map((p: any) => {
            const c = clean(p);
            return c && { ...c, description: String(p.description ?? "").trim().slice(0, 1000) };
          });
        const split = parts.length > 1 && parts.every((p: any) => p && p.description) ? parts : [];
        return { top, split, advice: String(e.advice ?? "").slice(0, 400), model: t.name };
      } catch (err) {
        if (String(err).includes("http")) throw err;
        if (!outer?.aborted) { failed++; console.error(t.name, String(err).slice(0, 200)); }
        throw err;
      }
    };

    // Round 1: first Gemini and first Groq model together; the losing call is cancelled.
    const first = [tries[0], tries.find((t) => !GEMINI.includes(t.name))].filter(Boolean) as typeof tries;
    const rest = tries.filter((t) => !first.includes(t));
    const stop = new AbortController();
    let got = await Promise.any(first.map((t) => ask(t, stop.signal))).catch(() => null);
    stop.abort();
    for (const t of rest) {
      if (got) break;
      if (Date.now() - start > BUDGET || BUDGET + 10_000 - (Date.now() - start) < 3_000) break;
      got = await ask(t).catch(() => null);
    }

    if (!got) {
      return quota && !failed
        ? json({ error: "quota", message: "The free daily AI limit is used up. Enter the numbers by hand." }, 429)
        : json({ error: "upstream", message: "The estimator could not be reached. Enter the numbers by hand." }, 502);
    }

    const { top, split, advice, model } = got;
    if (split.length) {
      for (const f of ["kcal", "protein_g", "carbs_g", "fat_g", "fibre_g"] as const) {
        (top as any)[f] = f === "kcal"
          ? split.reduce((a: number, p: any) => a + p.kcal, 0)
          : r1(split.reduce((a: number, p: any) => a + p[f], 0));
      }
    }
    return json({ ...top, meals: split, advice, model });
  } catch (err) {
    return json({ error: "failed", message: String(err) }, 500);
  }
});
