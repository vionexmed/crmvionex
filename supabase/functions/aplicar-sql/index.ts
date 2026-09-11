// Função TEMPORÁRIA de manutenção: aplica SQL de migração no banco.
// Protegida por token e removida ao final da manutenção.
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

Deno.serve(async (req) => {
  const token = req.headers.get("x-manutencao-token");
  if (!token || token !== Deno.env.get("MANUTENCAO_TOKEN")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
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
