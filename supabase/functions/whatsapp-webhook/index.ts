/**
 * Webhook de WhatsApp — Meta e Evolution.
 *
 * O parse saiu daqui e foi para `prov.lerWebhook()`: esta função virou o que
 * decide DE QUEM é a mensagem e o que fazer com ela. Antes o formato da Meta
 * estava inline, o que tornava impossível um segundo provedor.
 *
 * AS DUAS AUTENTICAÇÕES SÃO DIFERENTES, E ISSO NÃO DÁ PARA ABSTRAIR
 *
 * Meta      handshake GET com `hub.challenge`, e cada POST assinado em
 *           HMAC-SHA256 no cabeçalho `x-hub-signature-256`.
 * Evolution não assina nada. A autenticação é o `?token=` na URL do webhook,
 *           que é o `webhook_verify_token` da organização — a mesma coluna que
 *           a Meta usa no handshake, no mesmo papel de segredo compartilhado.
 *
 * As duas FALHAM FECHADAS. Sem segredo não há como distinguir o provedor de um
 * impostor, e um webhook aberto deixa qualquer pessoa na internet injetar
 * mensagem falsa no CRM — criando contato, conversa e histórico.
 *
 * O `?token=` NÃO é atalho para pular a assinatura da Meta: a conta encontrada
 * pelo token precisa ser de provedor `evolution`. Sem essa checagem, quem
 * descobrisse o token de uma conta Meta contornaria o HMAC.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { resolverProvedor } from "../_shared/whatsapp/index.ts";

type Admin = ReturnType<typeof createClient>;

/** De quem é a mensagem que chegou. */
type Destino = {
  orgId: string;
  userId: string | null;
  conexaoId: string | null;
  /** Número que recebeu, para gravar em `to_number`. */
  de: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const url = new URL(req.url);

  // ---------- GET: handshake, só da Meta ----------
  if (req.method === "GET") {
    const modo = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const desafio = url.searchParams.get("hub.challenge");
    if (modo !== "subscribe" || !token) return new Response("Bad request", { status: 400 });

    // Nas duas tabelas: a nova, e a antiga que ainda atende quem não migrou.
    const { data: conta } = await admin
      .from("whatsapp_business_accounts").select("id").eq("webhook_verify_token", token).maybeSingle();
    const { data: cfg } = conta ? { data: null } : await admin
      .from("whatsapp_config").select("id").eq("webhook_verify_token", token).maybeSingle();

    if (!conta && !cfg) return new Response("Forbidden", { status: 403 });
    return new Response(desafio ?? "", { status: 200 });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const corpoCru = await req.text();
    const token = url.searchParams.get("token");

    let provider = "meta";
    let orgDoToken: string | null = null;

    if (token) {
      // ---------- Evolution: o token na URL é a credencial ----------
      const { data: conta } = await admin
        .from("whatsapp_business_accounts")
        .select("org_id, provider")
        .eq("webhook_verify_token", token)
        .maybeSingle();

      if (!conta) return new Response("Forbidden", { status: 403 });

      // A checagem que fecha o desvio do HMAC.
      if ((conta.provider as string) !== "evolution") {
        console.error("whatsapp-webhook: token usado por conta que não é Evolution");
        return new Response("Forbidden", { status: 403 });
      }

      provider = "evolution";
      orgDoToken = conta.org_id as string;
    } else {
      // ---------- Meta: assinatura HMAC ----------
      const segredo = Deno.env.get("META_APP_SECRET");
      if (!segredo) {
        console.error("META_APP_SECRET ausente — webhook recusado");
        return new Response(
          JSON.stringify({ error: "Webhook não configurado: META_APP_SECRET ausente" }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }
      if (!(await assinaturaConfere(segredo, req.headers.get("x-hub-signature-256") ?? "", corpoCru))) {
        return new Response("Forbidden", { status: 403 });
      }
    }

    const prov = resolverProvedor(provider);
    const eventos = prov.lerWebhook(JSON.parse(corpoCru));

    for (const ev of eventos) {
      if (ev.tipo === "status") {
        await admin.from("whatsapp_messages")
          .update({ status: ev.status, error_message: ev.erro })
          .eq("wa_message_id", ev.idMensagem);
        continue;
      }

      const destino = await resolverDestino(admin, ev.origem, provider, orgDoToken);
      // Mensagem para um número que o CRM não conhece. Descartar em silêncio é
      // o certo: o webhook da Meta é do WABA inteiro e pode trazer número que
      // ninguém reivindicou.
      if (!destino) continue;

      const contactId = await acharOuCriarContato(admin, destino.orgId, ev.de, ev.nomePerfil);

      await admin.from("whatsapp_messages").upsert({
        org_id: destino.orgId,
        user_id: destino.userId,
        connection_id: destino.conexaoId,
        contact_id: contactId,
        direction: "inbound",
        wa_message_id: ev.idMensagem,
        from_number: ev.de,
        to_number: ev.para || destino.de,
        body: ev.texto,
        message_type: ev.tipoConteudo,
        status: "delivered",
        raw: ev.bruto,
      }, { onConflict: "wa_message_id" });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("whatsapp-webhook error", e);
    // 200 mesmo em erro: a Meta desativa webhook que responde erro seguidas
    // vezes, e aí para de chegar TUDO — inclusive o que funcionava.
    return new Response(JSON.stringify({ ok: false }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/** HMAC-SHA256 do corpo cru, comparado em tempo constante. */
async function assinaturaConfere(segredo: string, assinatura: string, corpo: string): Promise<boolean> {
  const chave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpo));
  const esperado = "sha256=" +
    Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");

  if (assinatura.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < assinatura.length; i++) diff |= assinatura.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diff === 0;
}

/**
 * `origem` é o phone_number_id na Meta e o nome da instância na Evolution — o
 * mesmo papel nos dois: dizer qual conexão recebeu.
 */
async function resolverDestino(
  admin: Admin,
  origem: string,
  provider: string,
  orgDoToken: string | null,
): Promise<Destino | null> {
  const coluna = provider === "evolution" ? "instance_name" : "phone_number_id";

  const { data: conexao } = await admin
    .from("whatsapp_connections")
    .select("id, org_id, user_id, display_phone_number")
    .eq(coluna, origem)
    .eq("is_active", true)
    .maybeSingle();

  if (conexao) {
    // Instância de outra organização respondendo com o token desta seria
    // mensagem entrando na empresa errada.
    if (orgDoToken && conexao.org_id !== orgDoToken) return null;
    return {
      orgId: conexao.org_id as string,
      userId: conexao.user_id as string,
      conexaoId: conexao.id as string,
      de: (conexao.display_phone_number as string | null) ?? "",
    };
  }

  // LEGADO: número da organização em whatsapp_config. Só Meta, e some junto com
  // o caminho legado de whatsapp-send.
  if (provider === "meta") {
    const { data: cfg } = await admin
      .from("whatsapp_config")
      .select("org_id, display_phone_number")
      .eq("phone_number_id", origem)
      .maybeSingle();
    if (cfg) {
      return {
        orgId: cfg.org_id as string,
        userId: null,
        conexaoId: null,
        de: (cfg.display_phone_number as string | null) ?? "",
      };
    }
  }

  return null;
}

/**
 * Contato pelo telefone, criando se não existir.
 *
 * Criar automaticamente é certo AQUI e errado no e-mail: quem manda mensagem no
 * WhatsApp da empresa está se apresentando. Um destinatário de e-mail, não.
 *
 * Casa pelos últimos 8 dígitos porque o mesmo número aparece com e sem o 9, com
 * e sem +55, com e sem parênteses.
 */
async function acharOuCriarContato(
  admin: Admin,
  orgId: string,
  telefone: string,
  nomePerfil: string | null,
): Promise<string | null> {
  const cauda = telefone.replace(/\D/g, "").slice(-8);
  if (!cauda) return null;

  const { data: achado } = await admin
    .from("contacts").select("id")
    .eq("org_id", orgId).ilike("phone", `%${cauda}%`)
    .limit(1).maybeSingle();
  if (achado) return achado.id as string;

  // `lifecycle_stage`, NUNCA `status`. O gatilho sync_contact_lifecycle deixa o
  // status legado mandar no INSERT, então escrevê-lo é a armadilha registrada
  // no CLAUDE.md — aqui o resultado seria o mesmo, mas o padrão é o que se copia.
  const { data: novo } = await admin
    .from("contacts")
    .insert({
      org_id: orgId,
      first_name: nomePerfil || `WhatsApp +${telefone}`,
      phone: `+${telefone}`,
      lifecycle_stage: "lead",
    })
    .select("id").single();

  return (novo?.id as string) ?? null;
}
