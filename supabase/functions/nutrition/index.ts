// Estimates calories and macros for a typed meal description.
//
// Gemini estimates and suggests. It never totals the day: daily sums are
// computed in the app from saved rows. Every estimate is shown for correction
// before anything is written to the database.

// Same fallback order as the extract function.
const MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash"];
const url = (m: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const num = { type: "NUMBER" };
const SCHEMA = {
  type: "OBJECT",
  properties: {
    meal: { type: "STRING", nullable: true, enum: ["breakfast", "lunch", "dinner", "snack"] },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { name: { type: "STRING" }, portion: { type: "STRING" }, kcal: num },
        required: ["name", "portion", "kcal"],
      },
    },
    kcal: num, protein_g: num, carbs_g: num, fat_g: num, fibre_g: num,
    assumptions: { type: "STRING", description: "key portion and cooking assumptions, one short line" },
    confidence: { type: "STRING", enum: ["low", "medium", "high"] },
    advice: { type: "STRING", description: "at most two sentences" },
  },
  required: ["items", "kcal", "protein_g", "carbs_g", "fat_g", "fibre_g", "assumptions", "confidence", "advice"],
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

Advice (max two sentences, practical, Indian home or restaurant food):
- Base it on the calories left after this meal, staying full within budget,
  and reaching the protein and fibre targets.
- Steer away from foods likely to cause bloating or gas (and any the user lists).
- No greetings, no medical claims, no exact totals for the day.`;

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

    const payload = JSON.stringify({
      contents: [{ parts: [{ text: RULES }, { text: context }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
        thinkingConfig: { thinkingLevel: "LOW" },
      },
    });

    // Overload falls through to the next model. A 429 is a quota wall: stop.
    let res!: Response, body: Record<string, unknown> = {}, used = "";
    outer:
    for (const model of MODELS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        used = model;
        res = await fetch(url(model), {
          method: "POST",
          headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
          body: payload,
        });
        body = await res.json().catch(() => ({}));
        if (res.ok || res.status === 429) break outer;
        if (res.status !== 503 && res.status !== 500) break;
        await sleep(1200 * (attempt + 1));
      }
    }

    if (res.status === 429) {
      return json({
        error: "quota",
        message: "The free daily AI limit is used up. It resets after midnight US Pacific time. Enter the numbers by hand.",
      }, 429);
    }
    if (!res.ok) {
      console.error("gemini", res.status, JSON.stringify(body).slice(0, 800));
      return json({ error: "upstream", message: "The estimator could not be reached. Enter the numbers by hand." }, 502);
    }

    const out = (body as any)?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    let e: Record<string, any>;
    try {
      e = JSON.parse(out);
    } catch {
      return json({ error: "unparseable", message: "No estimate came back. Try rewording, or enter the numbers by hand." }, 422);
    }

    // Reject impossible answers rather than pass them to the app.
    const est = {
      kcal: Math.round(n(e.kcal)), protein_g: r1(n(e.protein_g)), carbs_g: r1(n(e.carbs_g)),
      fat_g: r1(n(e.fat_g)), fibre_g: r1(n(e.fibre_g)),
    };
    const ok = est.kcal >= 0 && est.kcal <= 5000 && est.protein_g >= 0 && est.protein_g <= 500 &&
      est.carbs_g >= 0 && est.carbs_g <= 1000 && est.fat_g >= 0 && est.fat_g <= 500 &&
      est.fibre_g >= 0 && est.fibre_g <= 200;
    if (!ok) return json({ error: "invalid", message: "The estimate looked wrong. Enter the numbers by hand." }, 422);

    const fromMacros = 4 * est.protein_g + 4 * est.carbs_g + 9 * est.fat_g;
    const mismatch = est.kcal > 50 && Math.abs(fromMacros - est.kcal) / est.kcal > 0.25;

    return json({
      ...est,
      meal: ["breakfast", "lunch", "dinner", "snack"].includes(e.meal) ? e.meal : null,
      items: Array.isArray(e.items) ? e.items.slice(0, 20) : [],
      assumptions: String(e.assumptions ?? "").slice(0, 600),
      confidence: ["low", "medium", "high"].includes(e.confidence) ? e.confidence : "low",
      advice: String(e.advice ?? "").slice(0, 400),
      mismatch,
      model: used,
    });
  } catch (err) {
    return json({ error: "failed", message: String(err) }, 500);
  }
});
