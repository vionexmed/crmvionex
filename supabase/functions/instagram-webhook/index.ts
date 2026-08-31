/**
 * Webhook de Instagram Direct.
 *
 * Mesma forma do `whatsapp-webhook`, e as diferenças estão todas em
 * `_shared/instagram/api.ts`. O que fica aqui é a decisão: de quem é a mensagem,
 * e o que fazer com ela.
 *
 * FALHA FECHADA, e é a razão de o handshake e o POST checarem coisas diferentes:
 *
 * GET   `hub.verify_token` conferido contra `instagram_connections`. É o aperto
 *       de mão que a Meta faz UMA vez, ao salvar a URL no painel.
 * POST  assinatura HMAC-SHA256 no cabeçalho `x-hub-signature-256`, com o segredo
 *       do app. Em TODA requisição.
 *
 * Um webhook aberto deixa qualquer pessoa na internet injetar mensagem falsa no
 * CRM -- criando contato, conversa e histórico. Não há aqui o atalho `?token=`
 * que o WhatsApp tem para a Evolution: lá ele existe porque a Evolution não
 * assina nada, e o Instagram sempre assina.
 *
 * `INSTAGRAM_APP_SECRET` é variável PRÓPRIA, sem cair para `META_APP_SECRET`.
 * Na rota "Instagram Login" o segredo do app do Instagram pode ser outro, e um
 * fallback silencioso aqui significaria: assinatura conferida contra o segredo
 * errado, sempre falhando -- ou pior, conferida contra um segredo que vazou de
 * outro contexto.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { lerWebhook, perfilDe } from "../_shared/instagram/api.ts";

type Admin = ReturnType<typeof createClient>;

/** De quem é a mensagem que chegou. */
type Destino = {
  orgId: string;
  conexaoId: string;
  igUserId: string;
  accessToken: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const url = new URL(req.url);

  // ---------- GET: handshake ----------
  if (req.method === "GET") {
    const modo = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const desafio = url.searchParams.get("hub.challenge");
    if (modo !== "subscribe" || !token) return new Response("Bad request", { status: 400 });

    const { data: conexao } = await admin
      .from("instagram_connections")
      .select("id")
      .eq("webhook_verify_token", token)
      .maybeSingle();

    if (!conexao) return new Response("Forbidden", { status: 403 });
    return new Response(desafio ?? "", { status: 200 });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const corpoCru = await req.text();

    const segredo = Deno.env.get("INSTAGRAM_APP_SECRET");
    if (!segredo) {
      console.error("INSTAGRAM_APP_SECRET ausente — webhook recusado");
      return new Response(
        JSON.stringify({ error: "Webhook não configurado: INSTAGRAM_APP_SECRET ausente" }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    if (!(await assinaturaConfere(segredo, req.headers.get("x-hub-signature-256") ?? "", corpoCru))) {
      return new Response("Forbidden", { status: 403 });
    }

    const eventos = lerWebhook(JSON.parse(corpoCru));

    for (const ev of eventos) {
      if (ev.tipo === "ignorado") {
        console.log("instagram-webhook ignorado: %s", ev.motivo);
        continue;
      }

      const destino = await resolverDestino(admin, ev.conta);
      // Conta que o CRM não conhece. Descartar em silêncio é o certo: o app pode
      // estar assinado em conta que ninguém conectou aqui.
      if (!destino) continue;

      if (ev.tipo === "lido") {
        // "Lido" é da PESSOA lendo o que a empresa mandou. Marca o que saiu.
        await admin
          .from("instagram_messages")
          .update({ status: "read" })
          .eq("connection_id", destino.conexaoId)
          .eq("to_igsid", ev.pessoa)
          .eq("direction", "outbound")
          .neq("status", "read");
        continue;
      }

      const contactId = await acharOuCriarContato(admin, destino, ev.pessoa);

      /*
       * `de` e `para` dependem da direção, e trocá-los é o defeito que faz a
       * conversa aparecer espelhada: no eco (alguém respondeu pelo aplicativo do
       * celular) quem envia é a EMPRESA.
       */
      const de = ev.direcao === "inbound" ? ev.pessoa : destino.igUserId;
      const para = ev.direcao === "inbound" ? destino.igUserId : ev.pessoa;

      /*
       * `onConflict: ig_message_id` é o que torna a reentrega inofensiva. A Meta
       * reentrega quando não recebe 200, e sem isto cada reentrega duplicaria a
       * mensagem na tela.
       *
       * Também é o que faz o eco da mensagem que o CRM acabou de enviar
       * reencontrar a própria linha em vez de criar uma segunda: `instagram-send`
       * grava o `mid` que a Meta devolveu, e o eco traz o mesmo `mid`.
       */
      await admin.from("instagram_messages").upsert({
        org_id: destino.orgId,
        connection_id: destino.conexaoId,
        contact_id: contactId,
        direction: ev.direcao,
        ig_message_id: ev.idMensagem,
        from_igsid: de,
        to_igsid: para,
        body: ev.texto,
        message_type: ev.tipoConteudo,
        status: ev.direcao === "inbound" ? "delivered" : "sent",
        raw: ev.bruto,
      }, { onConflict: "ig_message_id" });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("instagram-webhook error", e);
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
 * Qual conexão recebeu, e com que token.
 *
 * O token vem junto porque a busca de perfil precisa dele, e buscá-lo depois
 * seria uma segunda ida ao banco por mensagem.
 */
async function resolverDestino(admin: Admin, igUserId: string): Promise<Destino | null> {
  const { data: conexao } = await admin
    .from("instagram_connections")
    .select("id, org_id, ig_user_id, instagram_secrets(access_token)")
    .eq("ig_user_id", igUserId)
    .eq("is_active", true)
    .maybeSingle();

  if (!conexao) return null;

  /*
   * O embed devolve array ou objeto conforme a cardinalidade que o PostgREST
   * inferir, e `instagram_secrets.connection_id` é UNIQUE -- então vem objeto.
   * Tratar os dois casos porque a diferença é invisível até quebrar em produção.
   */
  const seg = conexao.instagram_secrets as
    | { access_token?: string }
    | { access_token?: string }[]
    | null;
  const token = (Array.isArray(seg) ? seg[0]?.access_token : seg?.access_token) ?? null;

  if (!token) {
    // Conexão sem segredo é conexão pela metade: dá para gravar a mensagem, mas
    // não para buscar perfil nem responder. Vale registrar alto.
    console.error("instagram-webhook: conexão %s sem token", conexao.id);
    return null;
  }

  return {
    orgId: conexao.org_id as string,
    conexaoId: conexao.id as string,
    igUserId: conexao.ig_user_id as string,
    accessToken: token,
  };
}

/**
 * Contato pelo IGSID, criando se não existir.
 *
 * Criar automaticamente é certo AQUI e errado no e-mail: quem manda Direct para
 * o perfil da empresa está se apresentando. Um destinatário de e-mail, não.
 *
 * NÃO HÁ CASAMENTO POR TELEFONE OU E-MAIL. O Instagram não entrega nenhum dos
 * dois, então a pessoa que já é contato por outro canal vira um SEGUNDO contato
 * quando escreve pelo Direct. Juntar exigiria adivinhar por nome, e nome é o
 * pior identificador que existe -- há dois "Ana Paula Silva" em qualquer base
 * médica. Preferi dois contatos honestos a uma fusão errada, e a tela de
 * contatos já tem a mesclagem manual.
 */
async function acharOuCriarContato(
  admin: Admin,
  destino: Destino,
  igsid: string,
): Promise<string | null> {
  const { data: achado } = await admin
    .from("contacts").select("id")
    .eq("org_id", destino.orgId)
    .eq("instagram_igsid", igsid)
    .maybeSingle();
  if (achado) return achado.id as string;

  const perfil = await perfilDe(
    { accessToken: destino.accessToken, igUserId: destino.igUserId },
    igsid,
  );

  /*
   * O nome, em ordem de preferência: o que a pessoa pôs no perfil, o @, e por
   * fim o IGSID. O último é feio e é de propósito -- é melhor um contato
   * chamado "Instagram 17841..." aparecendo na lista do que uma mensagem
   * perdida por não haver nome.
   */
  const nome = perfil?.nome?.trim() ||
    (perfil?.username ? `@${perfil.username}` : "") ||
    `Instagram ${igsid.slice(0, 8)}`;

  // `lifecycle_stage`, NUNCA `status`. O gatilho sync_contact_lifecycle deixa o
  // status legado mandar no INSERT — a armadilha registrada no CLAUDE.md.
  const { data: novo, error } = await admin
    .from("contacts")
    .insert({
      org_id: destino.orgId,
      first_name: nome,
      instagram_igsid: igsid,
      instagram_username: perfil?.username ?? null,
      avatar_url: perfil?.foto ?? null,
      lifecycle_stage: "lead",
      metadata: { source: "Instagram Direct" },
    })
    .select("id").single();

  if (error) {
    /*
     * Corrida: duas mensagens da mesma pessoa nova chegando juntas, as duas sem
     * achar contato, as duas inserindo. O índice único (org_id, instagram_igsid)
     * derruba a segunda -- e é isso que se quer, mas a mensagem não pode ser
     * perdida por causa disso. Relê e usa o que a primeira criou.
     */
    const { data: agora } = await admin
      .from("contacts").select("id")
      .eq("org_id", destino.orgId)
      .eq("instagram_igsid", igsid)
      .maybeSingle();
    if (agora) return agora.id as string;
    console.error("instagram-webhook: falhou criar contato", error);
    return null;
  }

  return (novo?.id as string) ?? null;
}
