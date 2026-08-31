/**
 * Envio de Instagram Direct.
 *
 * A diferença de fundo em relação ao WhatsApp não é técnica, é de política: no
 * WhatsApp se INICIA conversa, com template aprovado. No Instagram não existe
 * isso -- só se responde, e só dentro da janela. Então esta função checa a
 * janela ANTES de gastar a chamada, e a mensagem de erro tem de explicar o
 * porquê, porque "falhou" sem motivo faz a pessoa tentar de novo.
 *
 * A janela vem da função SQL `instagram_janela`, a mesma que a tela usa para
 * bloquear o campo de texto. Uma fonte só: se cada lado calculasse, a tela
 * deixaria escrever o que o envio recusa -- e a pessoa perderia a mensagem
 * digitada.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { enviarTexto } from "../_shared/instagram/api.ts";

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: claims, error: cErr } = await supabase.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (cErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const contactId = body.contactId ? String(body.contactId) : null;
    // 1000 é o limite do Direct. Cortar aqui é melhor que a Meta recusar: a
    // pessoa vê o texto truncado e reescreve, em vez de perder a mensagem.
    const texto = body.text ? String(body.text).slice(0, 1000) : null;
    const dealId = body.dealId || null;

    if (!contactId || !texto?.trim()) {
      return json({ error: 'Informe "contactId" e "text"' }, 400);
    }

    const { data: prof } = await admin
      .from("profiles").select("org_id").eq("id", userId).maybeSingle();
    const orgId = prof?.org_id;
    if (!orgId) return json({ error: "Sem organização" }, 400);

    // ---------- para quem ----------
    const { data: contato } = await admin
      .from("contacts")
      .select("id, instagram_igsid, first_name")
      .eq("id", contactId)
      .eq("org_id", orgId)
      .maybeSingle();

    if (!contato) return json({ error: "Contato não encontrado" }, 404);
    if (!contato.instagram_igsid) {
      return json({
        error: `${contato.first_name} não tem Instagram vinculado. ` +
          "O vínculo nasce quando a pessoa manda a primeira mensagem — " +
          "não é possível iniciar uma conversa no Direct.",
      }, 400);
    }

    // ---------- a janela ----------
    const { data: janelas } = await admin
      .rpc("instagram_janela", { _contact_id: contactId });
    const janela = (janelas as {
      pode_responder: boolean;
      precisa_etiqueta: boolean;
      ultima_entrada: string | null;
    }[] | null)?.[0];

    if (!janela?.ultima_entrada) {
      return json({
        error: "Esta pessoa nunca escreveu pelo Direct. " +
          "O Instagram não permite iniciar conversa — só responder.",
      }, 400);
    }
    if (!janela.pode_responder) {
      return json({
        error: "Passaram-se mais de 7 dias desde a última mensagem dela. " +
          "O Instagram não permite responder depois disso. " +
          "Use WhatsApp ou e-mail para retomar o contato.",
      }, 400);
    }

    // ---------- de qual conta ----------
    const { data: conexao } = await admin
      .from("instagram_connections")
      .select("id, ig_user_id, username, instagram_secrets(access_token)")
      .eq("org_id", orgId)
      .eq("is_active", true)
      // Uma conta por organização hoje. `order` + `limit` em vez de
      // `maybeSingle` para a segunda conta não virar erro 500 quando ela existir.
      .order("connected_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!conexao) {
      return json({ error: "Nenhuma conta de Instagram conectada. Vá em Integrações." }, 400);
    }

    const seg = conexao.instagram_secrets as
      | { access_token?: string }
      | { access_token?: string }[]
      | null;
    const accessToken = (Array.isArray(seg) ? seg[0]?.access_token : seg?.access_token) ?? null;
    if (!accessToken) {
      return json({
        error: "A conta de Instagram está conectada mas sem credencial. Reconecte em Integrações.",
      }, 400);
    }

    // ---------- cota ----------
    const { data: temCota } = await admin
      .rpc("reserve_instagram_send", { _connection_id: conexao.id });
    if (temCota !== true) {
      return json({
        error: "Limite diário de envios desta conta atingido. " +
          "O teto protege o perfil de bloqueio por automação.",
      }, 429);
    }

    /**
     * Grava o que aconteceu, dando certo ou não.
     *
     * Um envio sem registro é um envio que a conversa não mostra. E aqui há um
     * detalhe que o WhatsApp não tem: o `ig_message_id` que a Meta devolve é o
     * MESMO que volta no eco do webhook, então gravá-lo é o que impede a
     * mensagem de aparecer duas vezes na tela.
     */
    const registrar = (campos: Record<string, unknown>) =>
      admin.from("instagram_messages").insert({
        org_id: orgId,
        connection_id: conexao.id,
        user_id: userId,
        contact_id: contactId,
        deal_id: dealId,
        direction: "outbound",
        from_igsid: conexao.ig_user_id,
        to_igsid: contato.instagram_igsid,
        body: texto,
        message_type: "text",
        ...campos,
      });

    const resultado = await enviarTexto(
      { accessToken, igUserId: conexao.ig_user_id as string },
      contato.instagram_igsid as string,
      texto,
      // A etiqueta só quando é preciso. Ver o comentário em `enviarTexto`: usá-la
      // dentro das 24h é o abuso que a política proíbe.
      janela.precisa_etiqueta === true,
    );

    if (!resultado.ok) {
      await registrar({ status: "failed", error_message: resultado.erro });
      return json({ error: resultado.erro, codigo: resultado.codigo }, 502);
    }

    await registrar({ status: "sent", ig_message_id: resultado.idMensagem });

    return json({
      ok: true,
      idMensagem: resultado.idMensagem,
      comEtiquetaHumana: janela.precisa_etiqueta === true,
    });
  } catch (e) {
    console.error("instagram-send error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
