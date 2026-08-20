/**
 * Reivindica um número do WABA para quem está chamando.
 *
 * A corrida é resolvida no banco, não aqui: whatsapp_connections_number_key é
 * UNIQUE parcial em phone_number_id WHERE is_active. Dois cliques simultâneos,
 * um insert perde com 23505 — e é por isso que o erro é traduzido em mensagem
 * específica em vez de "algo deu errado".
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { carregarCredencial, explicarAusencia, resolverProvedor } from "../_shared/whatsapp/index.ts";

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

    const { data: perfil } = await admin
      .from("profiles").select("org_id").eq("id", userId).maybeSingle();
    const orgId = perfil?.org_id;
    if (!orgId) return json({ ok: false, error: "Você não pertence a nenhuma organização" }, 403);

    const { phone_number_id } = await req.json().catch(() => ({}));
    if (typeof phone_number_id !== "string" || !phone_number_id.trim()) {
      return json({ ok: false, error: "Escolha um número." }, 400);
    }

    const credencial = await carregarCredencial(admin, orgId);
    if (!credencial.ok) {
      return json({ ok: false, error: explicarAusencia(credencial.motivo) }, 400);
    }

    const prov = resolverProvedor(credencial.cred.provider);

    // Confirmar na Meta que o número É do WABA desta empresa. Sem isto, um
    // phone_number_id qualquer entraria na tabela — inclusive de outra conta —
    // e o envio falharia só depois, sem explicação.
    const numeros = await prov.listarNumeros(credencial.cred);
    const escolhido = numeros.find((n) => n.id === phone_number_id.trim());
    if (!escolhido) {
      return json({ ok: false, error: "Este número não pertence ao WhatsApp da empresa." }, 400);
    }

    const { data: criada, error } = await admin
      .from("whatsapp_connections")
      .insert({
        org_id: orgId,
        user_id: userId,
        provider: prov.nome,
        phone_number_id: escolhido.id,
        display_phone_number: escolhido.telefone,
        verified_name: escolhido.nomeVerificado,
        scope_type: "user",
        is_active: true,
      })
      .select("id, phone_number_id, display_phone_number, verified_name, daily_send_limit")
      .single();

    if (error) {
      // 23505 = violação de unicidade. Os dois índices parciais têm saídas
      // diferentes, então a mensagem precisa dizer QUAL aconteceu.
      const texto = `${error.message} ${error.details ?? ""}`;
      if (error.code === "23505") {
        if (texto.includes("whatsapp_connections_number_key")) {
          return json({
            ok: false,
            error: "Esse número acabou de ser escolhido por outra pessoa. Atualize a lista e escolha outro.",
          }, 409);
        }
        if (texto.includes("whatsapp_connections_user_key")) {
          return json({
            ok: false,
            error: "Você já tem um número conectado. Desconecte o atual antes de escolher outro.",
          }, 409);
        }
        return json({ ok: false, error: "Este número já está em uso." }, 409);
      }
      throw error;
    }

    return json({ ok: true, conexao: criada });
  } catch (e) {
    console.error("whatsapp-claim", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
