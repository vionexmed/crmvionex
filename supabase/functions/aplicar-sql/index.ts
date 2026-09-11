// Função TEMPORÁRIA de manutenção: aplica SQL de migração no banco.
// Exige JWT (verify_jwt padrão) e papel owner/admin. Removida após a manutenção.
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: userData } = await sb.auth.getUser();
  const user = userData?.user;
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: papeis } = await admin
    .from("user_roles").select("role").eq("user_id", user.id);
  const podeAplicar = (papeis ?? []).some(
    (p: { role: string }) => p.role === "owner" || p.role === "admin",
  );
  if (!podeAplicar) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  const sql = await req.text();
  const client = new Client(Deno.env.get("SUPABASE_DB_URL")!);
  try {
    await client.connect();
    await client.queryArray(sql);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    try { await client.end(); } catch { /* noop */ }
  }
});
