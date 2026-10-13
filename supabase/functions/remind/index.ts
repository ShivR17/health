// Sends meal reminders as phone notifications.
//
// Called twice a day by pg_cron (see supabase/reminders-setup.sql):
//   14:00 IST, slot "day":   breakfast or lunch not logged yet
//   21:00 IST, slot "night": dinner or snack not logged yet
// Nobody is reminded on a day marked as fasting.
//
// Keys never leave the server. The first call makes a VAPID key pair and keeps
// it in push_keys, a table no user can read. The cron job sends the random
// cron_key from the same table, so no other caller can trigger notifications.
// {op: "key"} returns only the public key, which the app needs to subscribe.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const SLOTS: Record<string, string[]> = { day: ["breakfast", "lunch"], night: ["dinner", "snack"] };
const NAME: Record<string, string> = { breakfast: "breakfast", lunch: "lunch", dinner: "dinner", snack: "evening snack" };
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function keys(db: any) {
  const { data, error } = await db.from("push_keys").select("public,private,cron_key").eq("id", 1).single();
  if (error) throw error;
  if (data.public) return data;
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const j = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const pub = b64u(new Uint8Array([4, ...unb64u(j.x!), ...unb64u(j.y!)]));
  // Only the first caller writes; a racing call reads the winner's pair.
  await db.from("push_keys").update({ public: pub, private: j.d }).eq("id", 1).is("public", null);
  return (await db.from("push_keys").select("public,private,cron_key").eq("id", 1).single()).data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  try {
    const { op, key, slot, test_user } = await req.json().catch(() => ({}));
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const k = await keys(db);
    if (op === "key") return json({ public: k.public });
    if (typeof key !== "string" || key !== k.cron_key || !(slot in SLOTS)) return json({ error: "forbidden" }, 403);
    webpush.setVapidDetails("mailto:noreply@example.com", k.public, k.private);

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

    let q = db.from("push_subs").select("endpoint,p256dh,auth,user_id");
    if (test_user) q = q.eq("user_id", test_user);
    const { data: subs, error } = await q;
    if (error) throw error;
    const users = [...new Set((subs ?? []).map((s) => s.user_id))];
    if (!users.length) return json({ sent: 0 });

    const { data: meals, error: e2 } = await db.from("meals")
      .select("user_id,meal,kcal,description").eq("eaten_on", today).in("user_id", users);
    if (e2) throw e2;

    let sent = 0, gone = 0;
    for (const u of users) {
      const mine = (meals ?? []).filter((m) => m.user_id === u);
      if (mine.some((m) => +m.kcal === 0 && m.description === "Fasting day")) continue;
      const missing = test_user ? SLOTS[slot] : SLOTS[slot].filter((k) => !mine.some((m) => m.meal === k));
      if (!missing.length) continue;
      const words = missing.map((k) => NAME[k]);
      const body = JSON.stringify({
        title: `Log your ${words.join(" and ")}`,
        body: slot === "night" ? "Add what you ate tonight. Skip the snack if you had none." : "Add what you ate so far today.",
        url: "./",
        tag: `meal-${slot}`,
      });
      for (const s of (subs ?? []).filter((x) => x.user_id === u)) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600 });
          sent++;
        } catch (err: any) {
          // The phone dropped this subscription: forget it.
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await db.from("push_subs").delete().eq("endpoint", s.endpoint);
            gone++;
          } else console.error("push", err?.statusCode, String(err?.body ?? err).slice(0, 200));
        }
      }
    }
    return json({ sent, gone });
  } catch (err) {
    console.error(String(err));
    return json({ error: "failed" }, 500);
  }
});
