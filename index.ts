// Deletes the signed-in person's files and account. Runs on the server so the
// powerful service key never reaches the browser.
// Deploy: supabase functions deploy delete-account
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user }, error } = await asUser.auth.getUser();
    if (error || !user) return json({ error: "Please sign in again." }, 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Remove every file in the person's own folder.
    const { data: files } = await admin.storage.from("books").list(user.id, { limit: 1000 });
    if (files && files.length) {
      await admin.storage.from("books").remove(files.map((f) => `${user.id}/${f.name}`));
    }
    // Deleting the auth user also deletes profile, books, bookmarks and history (cascade).
    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) return json({ error: "We couldn't delete your account. Please try again." }, 500);
    return json({ ok: true });
  } catch (_e) {
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
