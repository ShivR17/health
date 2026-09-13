// Reads numbers off a body-scan photo or a blood-report PDF.
//
// Gemini extracts only. It never calculates, never infers, never fills a gap.
// Every derived figure (HOMA-IR, BMI, week, verdict) is computed elsewhere by
// fixed formulas. The client shows every extracted field for confirmation
// before anything is written to the database.

// Tried in order. Overload on the newest model falls through to the next,
// rather than making the user retry by hand.
const MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash"];
const url = (m: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const num = { type: "NUMBER", nullable: true };
const str = { type: "STRING", nullable: true };

const SCHEMAS: Record<string, Record<string, unknown>> = {
  scan: {
    type: "OBJECT",
    properties: {
      taken_on: { ...str, description: "measurement date on the readout, ISO yyyy-mm-dd" },
      weight_kg: num,
      body_fat_pct: num,
      muscle_kg: num,
      visceral: num,
      bmi: num,
      bmr: num,
      muscle_quality: num,
    },
  },
  blood: {
    type: "OBJECT",
    properties: {
      taken_on: { ...str, description: "collection or report date, ISO yyyy-mm-dd" },
      lab: { ...str, description: "name of the laboratory" },
      insulin: num, glucose: num, hba1c: num,
      ldl: num, non_hdl: num, hdl: num, triglycerides: num, apob: num,
      lpa: num, hscrp: num, vitamin_d: num, b12: num, folate: num,
      homocysteine: num, tsh: num, alt: num, ast: num,
      ferritin: num, haemoglobin: num, egfr: num, testosterone: num,
      total_cholesterol: num, apoa1: num, alp: num, ggt: num,
      uric_acid: num, tlc: num, creatinine: num,
    },
  },
};

const RULES = `You read measurements off a medical document or device readout.

Rules, all mandatory:
- Return a field only if you can SEE its value in the document.
- Use null for anything absent, unreadable, or uncertain. Never guess.
- Never calculate or derive a value. If HOMA-IR or a ratio is not printed, return null.
- Copy the number exactly as printed, including the decimal point. A value like
  23.10 is twenty-three point one zero, never 2310.
- Keep the document's own units. Do not convert.
- Take the date from the document itself, never today's date. Format yyyy-mm-dd.
- If a value is a range or has a qualifier such as < or >, return null.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  try {
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return json({ error: "no_key", message: "Extraction is not configured." }, 500);

    const { kind, mime, data } = await req.json().catch(() => ({}));
    const schema = SCHEMAS[kind];
    if (!schema) return json({ error: "bad_kind", message: "kind must be scan or blood." }, 400);
    if (!mime || !data) return json({ error: "bad_file", message: "No file received." }, 400);
    // base64 inflates by ~4/3; 8 MB of base64 is roughly a 6 MB file
    if (data.length > 8_000_000) {
      return json({ error: "too_big", message: "That file is too large. Use a smaller photo." }, 413);
    }

    const payload = JSON.stringify({
      contents: [{
        parts: [
          { text: RULES },
          { inline_data: { mime_type: mime, data } },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
        thinkingConfig: { thinkingLevel: "LOW" },
      },
    });

    // Retry transient overload across models before giving up. A 429 is a real
    // quota wall, not transient, so it stops immediately.
    let res!: Response, body: Record<string, unknown> = {};
    outer:
    for (const model of MODELS) {
      for (let attempt = 0; attempt < 2; attempt++) {
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
        message: "The free daily limit is used up. It resets after midnight US Pacific time. Type the values in by hand today.",
      }, 429);
    }
    if (!res.ok) {
      console.error("gemini", res.status, JSON.stringify(body).slice(0, 800));
      return json({ error: "upstream", status: res.status,
        detail: (body as { error?: { message?: string } })?.error?.message ?? null,
        message: "The reader could not be reached. Type the values in by hand." }, 502);
    }

    const text = body?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    let fields: Record<string, unknown>;
    try {
      fields = JSON.parse(text);
    } catch {
      return json({ error: "unparseable", message: "Nothing readable was found in that file." }, 422);
    }

    // drop nulls so the confirmation screen shows only what was actually read
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v !== null && v !== undefined && v !== "") clean[k] = v;
    }

    return json({ kind, fields: clean, raw: fields });
  } catch (e) {
    return json({ error: "failed", message: String(e) }, 500);
  }
});
