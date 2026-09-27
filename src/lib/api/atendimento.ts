import { supabase } from "@/integrations/supabase/client";
import { buscarEmBlocos } from "@/lib/paginar";
import { erroDaFuncao } from "@/lib/erro-supabase";
import { textoDeHtml } from "@/lib/formato";

/**
 * A leitura e o envio do Atendimento — os TRÊS canais num lugar só.
 *
 * A tela era três: `/conversations` (WhatsApp), `/instagram` e `/inbox`
 * (e-mail). Quem atende precisava ADIVINHAR em qual delas a conversa estava, e
 * a mesma pessoa escrevendo por dois canais aparecia em dois lugares sem nada
 * ligando um ao outro.
 *
 * O banco já estava pronto para isto e ninguém usava: a view
 * `mensagens_do_atendimento` UNE WhatsApp e Instagram com uma coluna `canal`, e
 * `canais_do_atendimento` diz quais estão conectados sem abrir a credencial.
 * O e-mail fica de fora da view -- ele mora em `emails`, tem assunto, corpo em
 * HTML e uma rota de envio própria -- então a junção dos três acontece aqui, e
 * não na tela.
 *
 * TUDO PAGINADO. O PostgREST corta em 1000 linhas em silêncio, e numa lista
 * misturada o corte é pior que o normal: some a conversa MAIS RECENTE de um
 * canal por causa de conversa velha de outro, e não há nada na tela dizendo
 * que faltou algo.
 */

export type CanalAtendimento = "email" | "whatsapp" | "instagram";

/** O rótulo que vai para a tela. Nunca a cor sozinha — ver `Atendimento.tsx`. */
export const ROTULO_CANAL: Record<CanalAtendimento, string> = {
  email: "E-mail",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
};

/**
 * Uma mensagem, qualquer que seja o canal.
 *
 * `identidade` é o outro lado da conversa já resolvido: telefone no WhatsApp,
 * IGSID no Instagram, endereço no e-mail. Resolver aqui é o que permite a lista
 * tratar os três iguais sem repetir o ternário em cada uso.
 */
export type MensagemUnificada = {
  id: string;
  canal: CanalAtendimento;
  contact_id: string | null;
  deal_id: string | null;
  direction: "inbound" | "outbound";
  identidade: string;
  /** Texto puro. No e-mail é a prévia; o corpo formatado vai em `html`. */
  texto: string | null;
  html: string | null;
  assunto: string | null;
  message_type: string;
  status: string;
  created_at: string;
  /** Só e-mail: a tela marca como lido ao abrir, como a caixa completa faz. */
  lido: boolean;
};

export type ContatoDoAtendimento = {
  id: string;
  nome: string;
  email: string | null;
  phone: string | null;
  instagram_username: string | null;
};

/**
 * O teto de cada canal, e ele é POR CANAL de propósito.
 *
 * Um teto único sobre a lista misturada faria o canal movimentado empurrar o
 * calmo para fora — e-mail antigo sumindo porque o WhatsApp teve um dia cheio.
 * Cada canal traz o próprio pedaço recente, e a junção acontece depois.
 */
const TETO_MENSAGENS = 2000;
const TETO_EMAILS = 1000;

/** Contato por lote: uma URL com mil ids não passa, e `.in()` vai na query. */
const LOTE_DE_IDS = 200;

type LinhaDaView = {
  id: string | null;
  canal: string | null;
  contact_id: string | null;
  deal_id: string | null;
  direction: string | null;
  de: string | null;
  para: string | null;
  body: string | null;
  message_type: string | null;
  status: string | null;
  created_at: string | null;
};

type LinhaDeEmail = {
  id: string;
  contact_id: string | null;
  deal_id: string | null;
  direction: string | null;
  subject: string | null;
  body_html: string | null;
  from_email: string | null;
  to_emails: string[] | null;
  status: string | null;
  is_read: boolean | null;
  is_spam: boolean | null;
  is_trashed: boolean | null;
  sent_at: string | null;
  created_at: string | null;
  synced_from: string | null;
};

const COLUNAS_DE_EMAIL =
  "id, contact_id, deal_id, direction, subject, body_html, from_email, to_emails, " +
  "status, is_read, is_spam, is_trashed, sent_at, created_at, synced_from";

export const atendimentoApi = {
  /**
   * WhatsApp e Instagram, pela view.
   *
   * DESC no banco e reversão no fim: com ASC o teto traria as mensagens mais
   * ANTIGAS da organização e a tela abriria vazia numa base grande. O que se
   * quer truncar é o passado, não o presente.
   */
  listarMensagens: async (orgId: string): Promise<MensagemUnificada[]> => {
    const linhas = await buscarEmBlocos<LinhaDaView>(
      async (inicio, fim) => {
        const { data, error } = await supabase
          .from("mensagens_do_atendimento")
          .select("id, canal, contact_id, deal_id, direction, de, para, body, message_type, status, created_at")
          .eq("org_id", orgId)
          .order("created_at", { ascending: false })
          .range(inicio, fim);
        return { data: (data ?? null) as LinhaDaView[] | null, error };
      },
      { teto: TETO_MENSAGENS },
    );

    return linhas
      .filter((l): l is LinhaDaView & { id: string; created_at: string } =>
        !!l.id && !!l.created_at && (l.canal === "whatsapp" || l.canal === "instagram"))
      .map((l): MensagemUnificada => {
        const entrada = l.direction === "inbound";
        return {
          id: l.id,
          canal: l.canal as CanalAtendimento,
          contact_id: l.contact_id,
          deal_id: l.deal_id,
          direction: entrada ? "inbound" : "outbound",
          identidade: (entrada ? l.de : l.para) ?? "",
          texto: l.body,
          html: null,
          assunto: null,
          message_type: l.message_type ?? "text",
          status: l.status ?? "",
          created_at: l.created_at,
          lido: true,
        };
      })
      .reverse();
  },

  /**
   * E-mail, da tabela `emails`.
   *
   * Lixeira, spam e rascunho ficam FORA: são estados da caixa de e-mail, não
   * conversa em andamento. Quem precisa deles abre a caixa completa, que
   * continua existindo em `/inbox` com pastas, rótulos e anexos.
   */
  listarEmails: async (orgId: string): Promise<MensagemUnificada[]> => {
    const linhas = await buscarEmBlocos<LinhaDeEmail>(
      async (inicio, fim) => {
        const { data, error } = await supabase
          .from("emails")
          .select(COLUNAS_DE_EMAIL)
          .eq("org_id", orgId)
          .order("created_at", { ascending: false })
          .range(inicio, fim);
        return { data: (data ?? null) as unknown as LinhaDeEmail[] | null, error };
      },
      { teto: TETO_EMAILS },
    );

    return linhas
      .filter((l) => !l.is_trashed && !l.is_spam && l.status !== "draft")
      .map((l): MensagemUnificada => {
        const entrada = l.direction === "inbound";
        const quando = l.sent_at ?? l.created_at;
        return {
          id: l.id,
          canal: "email" as const,
          contact_id: l.contact_id,
          deal_id: l.deal_id,
          direction: entrada ? "inbound" : "outbound",
          identidade: ((entrada ? l.from_email : l.to_emails?.[0]) ?? "").toLowerCase(),
          // `textoDeHtml` e não um `replace` de tags à mão: tirar a tag
          // NÃO decodifica a entidade, e a prévia de e-mail de editor web
          // lia "Silva&nbsp;&amp;&nbsp;Souza". Há teste proibindo a cópia.
          texto: textoDeHtml(l.body_html, 200),
          html: l.body_html,
          assunto: l.subject,
          message_type: "text",
          status: l.status ?? "",
          created_at: quando ?? new Date(0).toISOString(),
          lido: l.is_read !== false,
        };
      })
      .filter((m) => !!m.identidade)
      .reverse();
  },

  /**
   * Os contatos citados pelas mensagens, em lotes.
   *
   * `.in()` vai na URL: mil ids de uma vez estouram o limite do servidor antes
   * de qualquer coisa responder.
   */
  listarContatos: async (ids: string[]): Promise<ContatoDoAtendimento[]> => {
    const unicos = Array.from(new Set(ids)).filter(Boolean);
    const contatos: ContatoDoAtendimento[] = [];

    for (let i = 0; i < unicos.length; i += LOTE_DE_IDS) {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, email, phone, instagram_username")
        .in("id", unicos.slice(i, i + LOTE_DE_IDS));
      if (error) throw error;
      for (const c of data ?? []) {
        contatos.push({
          id: c.id,
          nome: [c.first_name, c.last_name].filter(Boolean).join(" ").trim(),
          email: c.email,
          phone: c.phone,
          instagram_username: c.instagram_username,
        });
      }
    }
    return contatos;
  },

  /**
   * Quais canais existem, sem ler a configuração.
   *
   * `whatsapp_config` guarda `webhook_verify_token`, e enquanto a tela
   * consultava a tabela quem não era admin recebia vazio e lia "WhatsApp ainda
   * não está conectado", com link para uma página de administrador. Mentira, e
   * sem saída. A função devolve dois booleanos e mais nada.
   */
  canaisConectados: async (orgId: string): Promise<{ whatsapp: boolean; instagram: boolean }> => {
    const { data, error } = await supabase.rpc("canais_do_atendimento", { _org_id: orgId });
    if (error) throw error;
    const linha = data?.[0];
    return { whatsapp: !!linha?.whatsapp, instagram: !!linha?.instagram };
  },
};

export type PedidoDeEnvio = {
  canal: CanalAtendimento;
  texto: string;
  contactId: string | null;
  dealId: string | null;
  /** Telefone, IGSID ou endereço de e-mail do outro lado. */
  identidade: string;
  /** Só e-mail: o assunto da mensagem que está sendo respondida. */
  assunto?: string | null;
  orgId: string;
  userId: string | null;
};

/**
 * O envio, pelas MESMAS rotas que já existiam.
 *
 * Nenhuma delas é nova: `whatsapp-send`, `instagram-send` e `gmail-send` são as
 * funções que as três telas antigas chamavam, com o mesmo corpo. Passam por
 * aqui para a tela unificada não ter três blocos de `invoke` competindo dentro
 * de um `if` -- e para o motivo do erro sair por `erroDaFuncao` nos três casos.
 *
 * `erroDaFuncao` e não `error.message`: o `invoke` NÃO lê o corpo em status
 * não-2xx, e "Edge Function returned a non-2xx status code" esconde o motivo
 * real -- que a função escreveu no corpo, e que quase sempre diz o que fazer.
 */
export async function enviarPeloCanal(pedido: PedidoDeEnvio): Promise<void> {
  const { canal, texto, contactId, dealId, identidade, assunto, orgId, userId } = pedido;

  const res = canal === "instagram"
    ? await supabase.functions.invoke("instagram-send", {
      body: { contactId, text: texto },
    })
    : canal === "whatsapp"
      ? await supabase.functions.invoke("whatsapp-send", {
        body: { to: identidade, text: texto, contactId },
      })
      : await supabase.functions.invoke("gmail-send", {
        body: {
          org_id: orgId,
          user_id: userId,
          contact_id: contactId,
          deal_id: dealId,
          to: [identidade],
          subject: assunto?.toLowerCase().startsWith("re:")
            ? assunto
            : `Re: ${assunto ?? ""}`.trim(),
          // `<p>` e não texto cru: `gmail-send` monta um corpo HTML, e a quebra
          // de linha digitada some se não virar marcação.
          html: texto
            .split("\n")
            .map((linha) => `<p>${linha || "&nbsp;"}</p>`)
            .join(""),
        },
      });

  const motivo = await erroDaFuncao(res);
  if (motivo) throw new Error(motivo);
}
