/**
 * Libera o número de uma conexão.
 *
 * Desativa em vez de apagar: is_active = false já solta os dois índices
 * parciais, então o número volta para a lista e a pessoa pode pegar outro. E o
 * histórico de mensagens continua apontando para a conexão — apagar a linha
 * zeraria connection_id (ON DELETE SET NULL) e a conversa passaria a ser
 * visível só para admin, sem ninguém ter pedido isso.
 *
 * NÃO copia o gmail-disconnect: aquele exige owner/admin, então um comercial
 * nunca consegue desconectar a própria conta — e a tela dele manda `email` onde
 * a função espera `connection_id`, então falha de qualquer jeito. Aqui a regra é
 * "admin, ou dono da conexão".
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Não autenticado" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ ok: false, error: "Não autenticado" }, 401);
    const userId = userData.user.id;

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { connection_id } = await req.json().catch(() => ({}));
    if (typeof connection_id !== "string" || !connection_id) {
      return json({ ok: false, error: "connection_id é obrigatório" }, 400);
    }

    const { data: conexao } = await admin
      .from("whatsapp_connections")
      .select("id, org_id, user_id, display_phone_number")
      .eq("id", connection_id)
      .maybeSingle();

    if (!conexao) return json({ ok: false, error: "Conexão não encontrada" }, 404);

    const { data: papel } = await admin
      .from("user_roles").select("role")
      .eq("user_id", userId).eq("org_id", conexao.org_id).maybeSingle();
    const ehAdmin = papel?.role === "owner" || papel?.role === "admin";

    if (!ehAdmin && conexao.user_id !== userId) {
      return json({ ok: false, error: "Você só pode desconectar o seu próprio número" }, 403);
    }

    const { error } = await admin
      .from("whatsapp_connections")
      .update({ is_active: false })
      .eq("id", connection_id);
    if (error) throw error;

    return json({ ok: true, numero: conexao.display_phone_number });
  } catch (e) {
    console.error("whatsapp-disconnect", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
