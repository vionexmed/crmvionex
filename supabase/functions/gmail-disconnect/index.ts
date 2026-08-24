import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Desconecta uma conta Gmail: remove a conexão, os tokens OAuth daquele e-mail e
 * limpa o e-mail do integration_configs se apontava para essa conta.
 * (Antes o app apagava só a linha de email_connections e deixava o token vivo —
 * a conta continuava sendo usada no envio.)
 *
 * QUEM PODE: admin da org, OU a própria pessoa dona da conexão.
 *
 * Antes exigia admin, e o docblock dizia "conta da EMPRESA" — herança do modelo
 * antigo, em que a caixa era da empresa. Com uma conta por pessoa, isso deixava
 * o comercial sem conseguir desconectar a PRÓPRIA conta: levava 403. E a tela
 * mandava `{ email }` enquanto esta função exige `connection_id`, então o botão
 * falhava com 400 para todo mundo, inclusive admin — ninguém nunca desconectou.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await anonClient.auth.getUser();
    if (!userData?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const { connection_id } = await req.json();
    if (!connection_id) return json({ error: "connection_id required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Org do chamador + verificação de papel admin/owner
    const { data: profile } = await admin.from("profiles").select("org_id").eq("id", userId).maybeSingle();
    const orgId = profile?.org_id;
    if (!orgId) return json({ error: "No organization" }, 403);

    // A conexão vem ANTES da autorização: sem ela em mão não há como saber se
    // quem chamou é o dono.
    const { data: conn } = await admin
      .from("email_connections")
      .select("id, org_id, user_id, email_address")
      .eq("id", connection_id)
      .maybeSingle();
    if (!conn || conn.org_id !== orgId) return json({ error: "Connection not found" }, 404);

    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", userId).eq("org_id", orgId).maybeSingle();
    const ehAdmin = roleRow?.role === "owner" || roleRow?.role === "admin";
    const ehDono = conn.user_id === userId;

    if (!ehAdmin && !ehDono) {
      return json({
        error: "forbidden",
        message: "Você só pode desconectar a sua própria conta.",
      }, 403);
    }

    // Escopado por user_id também: gmail_oauth_tokens é UNIQUE(user_id, email),
    // então apagar só por e-mail derrubaria o token de outra pessoa que tivesse
    // conectado o mesmo endereço.
    await admin.from("gmail_oauth_tokens").delete()
      .eq("org_id", orgId).eq("email", conn.email_address).eq("user_id", conn.user_id);
    await admin.from("email_connections").delete().eq("id", conn.id);

    // Limpa o e-mail do integration_configs se apontava para essa conta
    const { data: cfgRow } = await admin
      .from("integration_configs")
      .select("id, config")
      .eq("org_id", orgId)
      .eq("provider", "gmail")
      .maybeSingle();
    const cfg = (cfgRow?.config as Record<string, unknown>) ?? {};
    if (cfgRow && cfg.email === conn.email_address) {
      await admin.from("integration_configs")
        .update({ config: { ...cfg, email: null } })
        .eq("id", cfgRow.id);
    }

    return json({ ok: true });
  } catch (err) {
    console.error("gmail-disconnect error:", err);
    return json({ error: "internal_error", message: (err as Error).message }, 500);
  }
});
