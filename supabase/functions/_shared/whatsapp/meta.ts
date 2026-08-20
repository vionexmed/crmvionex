/**
 * Provedor WhatsApp Cloud API (oficial da Meta).
 *
 * Concentra tudo o que sabe de Graph API: era código solto dentro de
 * whatsapp-send e whatsapp-webhook, cada um com a própria constante de versão.
 *
 * Sobre a hierarquia, que explica por que a credencial tem WABA e a rota tem
 * número: o token de sistema pertence ao WABA e envia por QUALQUER número dele.
 * Logo o token é da organização, e o que varia por pessoa é só a origem.
 */
import type {
  Credencial,
  EventoWebhook,
  NumeroDisponivel,
  ProvedorWhatsApp,
  ResultadoEnvio,
  Rota,
} from "./types.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Só os campos que a gente realmente lê do webhook da Meta — não é o schema
 * completo dela. Tipar assim, em vez de `any`, é o que faz o compilador cobrar
 * a checagem de nulo em cada nível: o payload chega da internet e qualquer
 * campo pode faltar.
 */
type PayloadMeta = {
  entry?: {
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: { profile?: { name?: string } }[];
        messages?: {
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: {
            button_reply?: { title?: string };
            list_reply?: { title?: string };
          };
        }[];
        statuses?: {
          id?: string;
          status?: string;
          errors?: { message?: string }[];
        }[];
      };
    }[];
  }[];
};

/** A Meta devolve o motivo aninhado; sem isto o erro chega como "[object Object]". */
function mensagemDeErro(json: unknown): string {
  const e = (json as { error?: { message?: string; error_user_msg?: string } })?.error;
  return e?.error_user_msg || e?.message || JSON.stringify(json).slice(0, 500);
}

async function postMensagem(
  cred: Credencial,
  rota: Rota,
  payload: Record<string, unknown>,
): Promise<ResultadoEnvio> {
  // Authorization: Bearer, nunca token na query string. O meta-ads-sync põe o
  // token na URL e ele acaba nos logs — não repetir aqui.
  const resp = await fetch(`${GRAPH}/${rota.origem}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cred.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: rota.para,
      recipient_type: "individual",
      ...payload,
    }),
  });

  const json = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    return { ok: false, idMensagem: null, bruto: json, erro: mensagemDeErro(json) };
  }

  return {
    ok: true,
    idMensagem: (json as { messages?: { id?: string }[] })?.messages?.[0]?.id ?? null,
    bruto: json,
    erro: null,
  };
}

export const provedorMeta: ProvedorWhatsApp = {
  nome: "meta",

  enviarTexto(cred, rota, texto) {
    return postMensagem(cred, rota, { type: "text", text: { body: texto } });
  },

  enviarTemplate(cred, rota, template) {
    return postMensagem(cred, rota, {
      type: "template",
      template: {
        name: template.name,
        language: { code: template.language || "pt_BR" },
        components: template.components || [],
      },
    });
  },

  async verificarCredencial(cred) {
    if (!cred.wabaId) return { ok: false, erro: "WABA não informado." };

    const resp = await fetch(
      `${GRAPH}/${cred.wabaId}?fields=id,name`,
      { headers: { Authorization: `Bearer ${cred.token}` } },
    );
    const json = await resp.json().catch(() => ({}));

    if (!resp.ok) return { ok: false, erro: mensagemDeErro(json) };
    return { ok: true, erro: null };
  },

  async listarNumeros(cred) {
    if (!cred.wabaId) throw new Error("WABA não informado.");

    const resp = await fetch(
      `${GRAPH}/${cred.wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating&limit=100`,
      { headers: { Authorization: `Bearer ${cred.token}` } },
    );
    const json = await resp.json().catch(() => ({}));

    if (!resp.ok) throw new Error(mensagemDeErro(json));

    const dados = (json as { data?: Record<string, string>[] })?.data ?? [];
    return dados.map((n): NumeroDisponivel => ({
      id: n.id,
      telefone: n.display_phone_number ?? null,
      nomeVerificado: n.verified_name ?? null,
      qualidade: n.quality_rating ?? null,
    }));
  },

  lerWebhook(payload) {
    const eventos: EventoWebhook[] = [];
    const corpo = payload as PayloadMeta;

    for (const entry of corpo?.entry || []) {
      for (const change of entry?.changes || []) {
        const value = change?.value;
        if (!value) continue;

        // O número que RECEBEU. É por ele que se descobre de quem é a conexão —
        // um webhook só serve a todos os números do WABA.
        const origem = value.metadata?.phone_number_id;
        if (!origem) continue;

        for (const msg of value.messages || []) {
          // Sem id não há como deduplicar (wa_message_id é UNIQUE) e sem
          // remetente não há conversa — descartar é melhor que gravar lixo.
          if (!msg.id || !msg.from) continue;

          // Mesma extração de texto de antes: tipo sem texto vira "[tipo]" em
          // vez de nulo, senão a conversa mostra bolha vazia.
          const tipo = msg.type ?? "unknown";
          let texto: string | null;
          if (tipo === "text") texto = msg.text?.body ?? null;
          else if (tipo === "button") texto = msg.button?.text ?? null;
          else if (tipo === "interactive") {
            texto = msg.interactive?.button_reply?.title
              ?? msg.interactive?.list_reply?.title
              ?? null;
          } else texto = `[${tipo}]`;

          eventos.push({
            tipo: "mensagem",
            origem,
            idMensagem: msg.id,
            de: msg.from,
            para: value.metadata?.display_phone_number ?? "",
            texto,
            tipoConteudo: tipo,
            nomePerfil: value.contacts?.[0]?.profile?.name ?? null,
            bruto: msg,
          });
        }

        for (const st of value.statuses || []) {
          if (!st.id || !st.status) continue;
          eventos.push({
            tipo: "status",
            idMensagem: st.id,
            status: st.status,
            erro: st.errors?.[0]?.message ?? null,
          });
        }
      }
    }

    return eventos;
  },
};
