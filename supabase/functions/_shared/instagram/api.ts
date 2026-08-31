/**
 * Instagram Direct — Graph API e leitura de webhook.
 *
 * Um arquivo só, e não a pasta com `types`/`index`/provedor que o WhatsApp tem:
 * lá existem DOIS provedores (Meta e Evolution) e a abstração paga por si. Aqui
 * há um caminho só.
 *
 * A ROTA ESCOLHIDA É "INSTAGRAM API WITH INSTAGRAM LOGIN", e a consequência é o
 * host: `graph.instagram.com`, não `graph.facebook.com`. É a rota que NÃO exige
 * Página do Facebook vinculada -- só a conta profissional do Instagram. A outra
 * rota ("with Facebook Login") existe e usa o host do Facebook, mas obriga a
 * Página, que é justamente o que se queria evitar.
 *
 * O QUE O INSTAGRAM NÃO DEIXA FAZER, e é melhor saber antes de projetar tela:
 *
 * - não se INICIA conversa. Só responde a quem escreveu. Não há equivalente do
 *   template aprovado do WhatsApp;
 * - não há grupo pela API;
 * - a janela é de 24h para resposta livre. Depois, só com a etiqueta
 *   `human_agent`, que estende para 7 dias. Passados os 7 dias, não há como
 *   escrever -- e nenhuma etiqueta resolve.
 */

const GRAPH = "https://graph.instagram.com/v23.0";

/** Token e conta de quem envia. */
export type Credencial = {
  accessToken: string;
  /** Id da conta profissional. Vai no caminho: POST /<ig_user_id>/messages. */
  igUserId: string;
};

export type ResultadoEnvio =
  | { ok: true; idMensagem: string | null }
  | { ok: false; erro: string; codigo?: number };

/** O que interessa de um evento do webhook. */
export type EventoWebhook =
  | {
    tipo: "mensagem";
    /** Id da conta que recebeu — resolve org e conexão. */
    conta: string;
    /** IGSID da PESSOA, nas duas direções. Ver `direcao`. */
    pessoa: string;
    direcao: "inbound" | "outbound";
    idMensagem: string | null;
    texto: string | null;
    tipoConteudo: string;
    bruto: unknown;
  }
  | { tipo: "lido"; conta: string; pessoa: string }
  | { tipo: "ignorado"; motivo: string };

/**
 * Só os campos que a gente lê -- não é o schema da Meta.
 *
 * Tipar assim em vez de `any` é o que faz o compilador cobrar checagem de nulo
 * em cada nível: isto chega da internet e qualquer campo pode faltar.
 *
 * `MensagemCrua` é nomeada em vez de inline porque `tipoDoConteudo` a recebe.
 */
type MensagemCrua = {
  mid?: string;
  text?: string;
  /** Verdadeiro quando a mensagem saiu da conta da EMPRESA. */
  is_echo?: boolean;
  is_deleted?: boolean;
  is_unsupported?: boolean;
  attachments?: {
    type?: string;
    payload?: { url?: string };
  }[];
  /** Resposta a story: a Meta manda o story em `reply_to`. */
  reply_to?: { story?: { id?: string; url?: string }; mid?: string };
};

type PayloadInstagram = {
  object?: string;
  entry?: {
    /** Id da conta profissional que recebeu. */
    id?: string;
    time?: number;
    messaging?: {
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: MensagemCrua;
      /** Curtida em mensagem. Chega como evento próprio. */
      reaction?: { mid?: string; action?: string; emoji?: string };
      read?: { mid?: string };
      postback?: { mid?: string; title?: string; payload?: string };
    }[];
  }[];
};

/** A Meta devolve o motivo aninhado; sem isto o erro chega como "[object Object]". */
function mensagemDeErro(json: unknown): string {
  const e = (json as {
    error?: { message?: string; error_user_msg?: string; code?: number };
  })?.error;
  return e?.error_user_msg || e?.message || JSON.stringify(json).slice(0, 500);
}

function codigoDeErro(json: unknown): number | undefined {
  return (json as { error?: { code?: number } })?.error?.code;
}

/**
 * Envia texto.
 *
 * `comEtiquetaHumana` põe `messaging_type: MESSAGE_TAG` + `tag: HUMAN_AGENT`,
 * que é a forma da Messenger Platform -- o Instagram herda o formato dela. É o
 * que permite responder entre 24h e 7 dias, e a etiqueta é honesta no nosso
 * caso: há uma pessoa do outro lado, digitando.
 *
 * Não se manda a etiqueta por padrão. Dentro das 24h ela é desnecessária, e
 * usá-la em toda mensagem é exatamente o abuso que a política proíbe -- o que
 * está em jogo é a conta, não a mensagem.
 */
export async function enviarTexto(
  cred: Credencial,
  paraIgsid: string,
  texto: string,
  comEtiquetaHumana = false,
): Promise<ResultadoEnvio> {
  const payload: Record<string, unknown> = {
    recipient: { id: paraIgsid },
    message: { text: texto },
  };
  if (comEtiquetaHumana) {
    payload.messaging_type = "MESSAGE_TAG";
    payload.tag = "HUMAN_AGENT";
  }

  // Authorization: Bearer, NUNCA token na query string. O meta-ads-sync põe o
  // token na URL e ele acaba nos logs — não repetir aqui.
  const resp = await fetch(`${GRAPH}/${cred.igUserId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cred.accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return { ok: false, erro: mensagemDeErro(json), codigo: codigoDeErro(json) };
  }
  return { ok: true, idMensagem: (json as { message_id?: string }).message_id ?? null };
}

/**
 * Nome e @ de quem escreveu.
 *
 * Vale uma chamada porque o webhook manda só o IGSID: sem isto o contato nasce
 * chamado "Instagram 178414..." e ninguém o reconhece na lista. A chamada é por
 * PESSOA NOVA, não por mensagem -- quem já é contato não passa por aqui.
 *
 * Falha em silêncio de propósito, devolvendo null. Perfil sem nome é
 * inconveniente; mensagem perdida porque a busca de perfil falhou é defeito.
 */
export async function perfilDe(
  cred: Credencial,
  igsid: string,
): Promise<{ nome: string | null; username: string | null; foto: string | null } | null> {
  try {
    const resp = await fetch(
      `${GRAPH}/${igsid}?fields=name,username,profile_pic`,
      { headers: { Authorization: `Bearer ${cred.accessToken}` } },
    );
    if (!resp.ok) {
      console.warn("instagram perfilDe: %s", mensagemDeErro(await resp.json().catch(() => ({}))));
      return null;
    }
    const j = await resp.json() as { name?: string; username?: string; profile_pic?: string };
    return {
      nome: j.name ?? null,
      username: j.username ?? null,
      foto: j.profile_pic ?? null,
    };
  } catch (e) {
    console.warn("instagram perfilDe falhou", e);
    return null;
  }
}

/**
 * Assina a conta no webhook, depois de conectar.
 *
 * Sem esta chamada a conexão fica pela metade e o sintoma engana: a interface
 * mostra "conectado", o envio funciona, e NADA entra. Foi o que aconteceu no
 * WhatsApp -- é por isso que aqui é uma chamada explícita no fim do fluxo de
 * conexão, e não algo que se supõe configurado no painel da Meta.
 */
export async function assinarWebhook(cred: Credencial): Promise<{ ok: boolean; erro?: string }> {
  const resp = await fetch(
    `${GRAPH}/${cred.igUserId}/subscribed_apps?subscribed_fields=messages`,
    { method: "POST", headers: { Authorization: `Bearer ${cred.accessToken}` } },
  );
  if (!resp.ok) {
    return { ok: false, erro: mensagemDeErro(await resp.json().catch(() => ({}))) };
  }
  return { ok: true };
}

/**
 * Troca o código do OAuth por token de longa duração.
 *
 * São DUAS trocas, e pular a segunda é o erro que faz a integração morrer em uma
 * hora: o código vira um token de CURTA duração (1h), e só uma segunda chamada o
 * converte no de 60 dias. O de curta duração funciona nos testes -- que é o que
 * torna o erro difícil de ver.
 */
export async function trocarCodigoPorToken(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  codigo: string,
): Promise<
  { ok: true; token: string; igUserId: string; expiraEm: number | null } | { ok: false; erro: string }
> {
  // 1ª troca: código -> token curto. Este endpoint é form-encoded, não JSON.
  const curto = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code: codigo,
    }),
  });
  const jc = await curto.json().catch(() => ({}));
  if (!curto.ok) return { ok: false, erro: mensagemDeErro(jc) };

  const tokenCurto = (jc as { access_token?: string }).access_token;
  const igUserId = String((jc as { user_id?: string | number }).user_id ?? "");
  if (!tokenCurto || !igUserId) {
    return { ok: false, erro: "Resposta do OAuth sem access_token ou user_id" };
  }

  // 2ª troca: curto -> longo (60 dias).
  const longo = await fetch(
    `${GRAPH}/access_token?${new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: clientSecret,
      access_token: tokenCurto,
    })}`,
  );
  const jl = await longo.json().catch(() => ({}));
  if (!longo.ok) return { ok: false, erro: mensagemDeErro(jl) };

  const tokenLongo = (jl as { access_token?: string }).access_token;
  if (!tokenLongo) return { ok: false, erro: "Troca para token de longa duração não devolveu token" };

  return {
    ok: true,
    token: tokenLongo,
    igUserId,
    expiraEm: (jl as { expires_in?: number }).expires_in ?? null,
  };
}

/** Renova o token de 60 dias. Só funciona se ele tiver mais de 24h de vida. */
export async function renovarToken(
  token: string,
): Promise<{ ok: true; token: string; expiraEm: number | null } | { ok: false; erro: string }> {
  const resp = await fetch(
    `${GRAPH}/refresh_access_token?${new URLSearchParams({
      grant_type: "ig_refresh_token",
      access_token: token,
    })}`,
  );
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok) return { ok: false, erro: mensagemDeErro(j) };
  const novo = (j as { access_token?: string }).access_token;
  if (!novo) return { ok: false, erro: "Renovação não devolveu token" };
  return { ok: true, token: novo, expiraEm: (j as { expires_in?: number }).expires_in ?? null };
}

/**
 * O que veio no webhook, em eventos.
 *
 * O `is_echo` é o ponto delicado. Ele marca a mensagem que SAIU da conta da
 * empresa -- inclusive quando alguém respondeu pelo aplicativo do Instagram no
 * celular, fora do CRM. Duas consequências:
 *
 * 1. quem é "a pessoa" TROCA DE LADO. No que entra, é o `sender`; no eco, é o
 *    `recipient`. Ler `sender` sempre gravaria a conta da empresa como se fosse
 *    o contato, e cada resposta pelo celular criaria um contato novo chamado com
 *    o @ da própria empresa;
 * 2. o eco é bom e fica. O WhatsApp descarta o equivalente (`fromMe`), e ali faz
 *    sentido porque a Evolution ecoa o que o próprio CRM acabou de enviar. Aqui
 *    o eco é a única forma de o CRM saber de uma resposta dada pelo celular --
 *    descartá-lo deixaria a conversa com buracos. O `mid` é único, então a
 *    mensagem que o CRM enviou não duplica: o upsert reencontra a linha.
 */
export function lerWebhook(payload: unknown): EventoWebhook[] {
  const p = payload as PayloadInstagram;
  const eventos: EventoWebhook[] = [];

  // A Meta usa o mesmo webhook para vários produtos. Sem esta checagem, um
  // evento de Página do Facebook entraria como Direct.
  if (p.object && p.object !== "instagram") {
    return [{ tipo: "ignorado", motivo: `object=${p.object}` }];
  }

  for (const entry of p.entry ?? []) {
    const conta = entry.id;
    if (!conta) continue;

    for (const m of entry.messaging ?? []) {
      if (m.read) {
        const pessoa = m.sender?.id;
        if (pessoa) eventos.push({ tipo: "lido", conta, pessoa });
        continue;
      }

      // Curtida e postback não são mensagem. Entram como ignorados nomeados em
      // vez de sumirem, para o log dizer o que chegou.
      if (m.reaction) {
        eventos.push({ tipo: "ignorado", motivo: `reaction:${m.reaction.action ?? "?"}` });
        continue;
      }
      if (!m.message) {
        eventos.push({ tipo: "ignorado", motivo: "evento sem message" });
        continue;
      }
      // Mensagem apagada pela pessoa. Não se apaga o histórico do CRM por isso
      // -- mas também não se grava texto que já não existe no Instagram.
      if (m.message.is_deleted) {
        eventos.push({ tipo: "ignorado", motivo: "mensagem apagada na origem" });
        continue;
      }

      const eco = m.message.is_echo === true;
      const pessoa = eco ? m.recipient?.id : m.sender?.id;
      if (!pessoa) {
        eventos.push({ tipo: "ignorado", motivo: "evento sem IGSID da pessoa" });
        continue;
      }

      eventos.push({
        tipo: "mensagem",
        conta,
        pessoa,
        direcao: eco ? "outbound" : "inbound",
        idMensagem: m.message.mid ?? null,
        texto: m.message.text ?? null,
        tipoConteudo: tipoDoConteudo(m.message),
        bruto: m,
      });
    }
  }

  return eventos;
}

/**
 * Que tipo de conteúdo é.
 *
 * A ordem importa: resposta a story TEM texto, então checar texto primeiro
 * classificaria toda resposta a story como texto simples -- e a tela perderia o
 * contexto de que aquilo responde a uma publicação.
 */
function tipoDoConteudo(msg: MensagemCrua): string {
  if (msg.is_unsupported) return "unsupported";
  if (msg.reply_to?.story) return "story_reply";

  const anexo = msg.attachments?.[0]?.type;
  if (anexo) {
    // `story_mention` chega como anexo: é alguém marcando a empresa no story.
    // Vale gravar -- é abordagem, e some do Instagram em 24h.
    return anexo;
  }

  if (typeof msg.text === "string") return "text";
  return "unsupported";
}

/**
 * Texto para mostrar quando não há texto.
 *
 * Sem isto a conversa mostra linhas vazias, e uma linha vazia parece defeito da
 * tela -- não "a pessoa mandou uma foto".
 */
export function descricaoDeConteudo(tipo: string): string {
  const mapa: Record<string, string> = {
    image: "📷 Imagem",
    video: "🎥 Vídeo",
    audio: "🎤 Áudio",
    file: "📎 Arquivo",
    share: "🔗 Publicação compartilhada",
    ig_reel: "🎬 Reel",
    story_mention: "👤 Mencionou você num story",
    story_reply: "💬 Respondeu ao seu story",
    unsupported: "Conteúdo não suportado",
  };
  return mapa[tipo] ?? "Mensagem";
}
