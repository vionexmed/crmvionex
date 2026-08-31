/**
 * Provedor Evolution API — auto-hospedada, por cima do WhatsApp Web (Baileys).
 *
 * DIFERENÇAS QUE NÃO SÃO SÓ DE ENDEREÇO
 *
 * 1. Não existe template. Template aprovado e a janela de 24 horas são
 *    construções da Meta; aqui toda mensagem é texto comum. `enviarTemplate`
 *    envia o texto do template em vez de recusar -- recusar quebraria a
 *    automação que já manda template, e o efeito prático é o mesmo.
 *
 * 2. O número entra por QR code, não por escolha numa lista. É por isso que o
 *    contrato ganhou `formaDePareamento`.
 *
 * 3. O identificador é o JID (`5511999998888@s.whatsapp.net`), não um
 *    phone_number_id. Toda saída daqui devolve só os dígitos, porque é o que
 *    `whatsapp_messages.from_number` guarda -- e porque ainda há contatos em
 *    produção com `@s.whatsapp.net` no telefone, resíduo da fase anterior.
 *
 * 4. Os status do Baileys são outros: PENDING / SERVER_ACK / DELIVERY_ACK /
 *    READ / PLAYED. Traduzidos para o vocabulário da tabela, que é o da Meta.
 *
 * SOBRE VERSÃO
 *
 * A v1 e a v2 mudaram o corpo do envio e da configuração de webhook. As duas
 * formas são aceitas aqui, porque descobrir qual servidor a pessoa subiu não é
 * problema dela. Onde a resposta muda de forma, a leitura tenta os dois
 * caminhos em vez de assumir um.
 *
 * RISCO REGISTRADO
 *
 * A Evolution roda por cima do WhatsApp Web, o que viola os termos da Meta e
 * pode derrubar o número. É escolha de produto, não de engenharia.
 */
import type {
  Credencial,
  EventoWebhook,
  NumeroDisponivel,
  ProvedorWhatsApp,
} from "./types.ts";

/** Sem barra no fim: `${base}/rota` com barra dupla dá 404 em alguns proxies. */
function base(cred: Credencial): string {
  const u = (cred.serverUrl ?? "").trim().replace(/\/+$/, "");
  if (!u) throw new Error("URL do servidor Evolution não informada.");
  return u;
}

/**
 * A Evolution devolve o motivo em pelo menos três formatos diferentes conforme
 * a versão e a camada que falhou. Sem esta função o erro chega na tela como
 * "[object Object]" -- o mesmo defeito que `mensagemErro` resolve no frontend.
 */
function mensagemDeErro(json: unknown, resp?: Response): string {
  const o = json as {
    message?: unknown;
    error?: unknown;
    response?: { message?: unknown };
  } | null;

  const bruto = o?.response?.message ?? o?.message ?? o?.error;
  if (typeof bruto === "string" && bruto.trim()) return bruto;
  if (Array.isArray(bruto) && bruto.length) return bruto.map(String).join("; ");
  if (bruto && typeof bruto === "object") return JSON.stringify(bruto).slice(0, 500);

  const texto = json ? JSON.stringify(json).slice(0, 500) : "";
  if (texto && texto !== "{}") return texto;
  return resp ? `HTTP ${resp.status} ${resp.statusText}`.trim() : "Erro desconhecido";
}

type Resposta = { ok: boolean; json: unknown; status: number; erro: string | null };

async function chamar(
  cred: Credencial,
  caminho: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Resposta> {
  let resp: Response;
  try {
    resp = await fetch(`${base(cred)}${caminho}`, {
      method: init.method ?? "GET",
      headers: {
        // A Evolution autentica por `apikey`, não por Bearer.
        apikey: cred.token,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (e) {
    // Servidor auto-hospedado cai, muda de IP e fica sem TLS válido. Um erro de
    // rede aqui é o caso comum, não a exceção -- e "failed to fetch" sozinho não
    // ajuda ninguém a consertar.
    return {
      ok: false,
      json: null,
      status: 0,
      erro: `Não foi possível falar com o servidor Evolution em ${cred.serverUrl}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }

  const json: unknown = await resp.json().catch((): unknown => null);
  return {
    ok: resp.ok,
    json,
    status: resp.status,
    erro: resp.ok ? null : mensagemDeErro(json, resp),
  };
}

/** JID → só dígitos. `5511999998888@s.whatsapp.net` vira `5511999998888`. */
function digitos(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const so = String(jid).split("@")[0].split(":")[0].replace(/\D/g, "");
  return so || null;
}

/**
 * `base64` ora vem com o prefixo data URI, ora sem. Normalizar aqui evita que a
 * tela tenha de saber a versão do servidor.
 */
function comoDataUri(b64: string | null | undefined): string | null {
  if (!b64) return null;
  const s = String(b64);
  return s.startsWith("data:") ? s : `data:image/png;base64,${s}`;
}

/** As três formas em que a v1 e a v2 embrulham o estado da conexão. */
function lerEstado(json: unknown): string | null {
  const o = json as {
    instance?: { state?: string; status?: string; connectionStatus?: string };
    state?: string;
    connectionStatus?: string;
  } | null;
  return (
    o?.instance?.state ??
    o?.instance?.status ??
    o?.instance?.connectionStatus ??
    o?.state ??
    o?.connectionStatus ??
    null
  );
}

const CONECTADO = new Set(["open", "connected", "online"]);

/** Eventos que interessam. Pedir todos faria o webhook receber presença e digitação. */
const EVENTOS = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"];

/**
 * Traduz falha de envio em algo que a pessoa possa agir.
 *
 * MEDIDO contra a v2.3.7: enviar por uma instância sem sessão pareada devolve
 * HTTP 500 com `{"response":{"message":"Cannot read properties of undefined
 * (reading 'find')"}}` -- um crash interno do Baileys, não uma explicação. Quem
 * visse isso na tela não teria como saber que só precisa reler o QR code.
 *
 * A consulta extra roda SÓ quando o envio já falhou. No caminho normal não
 * custa nada, e é por isso que não checo o estado antes de cada envio.
 */
async function explicarFalhaDeEnvio(
  cred: Credencial,
  instancia: string,
  falha: Resposta,
): Promise<string> {
  const estado = await chamar(cred, `/instance/connectionState/${encodeURIComponent(instancia)}`);
  const atual = lerEstado(estado.json);

  if (estado.status === 404) {
    return "Este WhatsApp não está mais pareado no servidor. Conecte de novo em Integrações.";
  }
  if (atual && !CONECTADO.has(atual)) {
    return "O WhatsApp desta conexão não está conectado. Leia o QR code de novo em Integrações.";
  }
  // Conectado e falhou de todo jeito: o motivo do servidor é o melhor que há.
  return falha.erro ?? "Falha no envio.";
}

export const provedorEvolution: ProvedorWhatsApp = {
  nome: "evolution",
  formaDePareamento: "qrcode",

  async enviarTexto(cred, rota, texto) {
    const r = await chamar(cred, `/message/sendText/${encodeURIComponent(rota.origem)}`, {
      method: "POST",
      // `text` no topo é v2; `textMessage.text` é v1. Mandar os dois é aceito
      // pelas duas, porque cada uma ignora o campo que não conhece.
      body: { number: rota.para, text: texto, textMessage: { text: texto } },
    });

    if (!r.ok) {
      return {
        ok: false,
        idMensagem: null,
        bruto: r.json,
        erro: await explicarFalhaDeEnvio(cred, rota.origem, r),
      };
    }

    const id = (r.json as { key?: { id?: string } })?.key?.id ?? null;
    return { ok: true, idMensagem: id, bruto: r.json, erro: null };
  },

  /**
   * Não existe template aqui. Envia o NOME do template como texto seria pior que
   * inútil, então o que vai é o corpo montado pelo chamador quando houver, e o
   * nome só como último recurso -- assim a mensagem sai, e sai legível.
   */
  enviarTemplate(cred, rota, template) {
    const doComponente = (template.components ?? [])
      .flatMap((c) => {
        const params = (c as { parameters?: { text?: string }[] })?.parameters ?? [];
        return params.map((p) => p.text).filter(Boolean);
      })
      .join(" ");
    return provedorEvolution.enviarTexto(cred, rota, doComponente || template.name);
  },

  async verificarCredencial(cred) {
    if (!cred.serverUrl?.trim()) {
      return { ok: false, erro: "Informe a URL do servidor Evolution." };
    }
    // `fetchInstances` é a rota mais barata que exige a chave: se ela responde,
    // a URL está certa E a chave vale. Duas verificações num pedido só.
    const r = await chamar(cred, "/instance/fetchInstances");
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) {
        return { ok: false, erro: "A chave da API foi recusada pelo servidor Evolution." };
      }
      return { ok: false, erro: r.erro };
    }
    return { ok: true, erro: null };
  },

  async listarNumeros(cred) {
    const r = await chamar(cred, "/instance/fetchInstances");
    if (!r.ok) throw new Error(r.erro ?? "Falha ao listar instâncias.");

    const lista = Array.isArray(r.json) ? r.json : [];
    return lista.map((item): NumeroDisponivel => {
      // v1 aninha em `instance`; v2 devolve o objeto plano.
      const i = (item as { instance?: Record<string, unknown> })?.instance ??
        (item as Record<string, unknown>);
      const nome = String(i.instanceName ?? i.name ?? "");
      const dono = (i.owner ?? i.ownerJid ?? null) as string | null;
      return {
        id: nome,
        telefone: digitos(dono),
        nomeVerificado: (i.profileName ?? null) as string | null,
        // A Evolution não tem quality rating; declarar null é mais honesto que
        // inventar "GREEN".
        qualidade: null,
      };
    }).filter((n) => n.id);
  },

  async iniciarPareamento(cred, instancia) {
    // Criar. Se já existe, a Evolution responde 403 ou 409 -- e aí o caminho
    // certo é conectar, não falhar: a pessoa pode ter fechado a tela e voltado.
    const criar = await chamar(cred, "/instance/create", {
      method: "POST",
      body: {
        instanceName: instancia,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
      },
    });

    if (criar.ok) {
      const j = criar.json as {
        qrcode?: { base64?: string; code?: string; pairingCode?: string };
      };
      const qr = comoDataUri(j?.qrcode?.base64);
      if (qr) {
        return {
          instancia,
          estado: "aguardando",
          qr,
          codigo: j?.qrcode?.pairingCode ?? null,
          telefone: null,
          nomePerfil: null,
        };
      }
      // Criou sem devolver QR: a rota de conexão devolve.
      return provedorEvolution.consultarPareamento(cred, instancia);
    }

    const jaExiste = criar.status === 403 || criar.status === 409 ||
      /already in use|already exists|já existe/i.test(criar.erro ?? "");
    if (!jaExiste) throw new Error(criar.erro ?? "Falha ao criar a instância.");

    return provedorEvolution.consultarPareamento(cred, instancia);
  },

  async consultarPareamento(cred, instancia) {
    const nome = encodeURIComponent(instancia);

    const estadoResp = await chamar(cred, `/instance/connectionState/${nome}`);
    const estado = lerEstado(estadoResp.json);

    if (estadoResp.ok && estado && CONECTADO.has(estado)) {
      // Conectado: o telefone só aparece na listagem, não no estado.
      let telefone: string | null = null;
      let nomePerfil: string | null = null;
      try {
        const achado = (await provedorEvolution.listarNumeros(cred))
          .find((n) => n.id === instancia);
        telefone = achado?.telefone ?? null;
        nomePerfil = achado?.nomeVerificado ?? null;
      } catch {
        // Falhar aqui não pode derrubar o pareamento: já está conectado, e o
        // telefone é enfeite que o webhook preenche depois.
      }
      return { instancia, estado: "conectado", qr: null, codigo: null, telefone, nomePerfil };
    }

    // Não conectado: pedir o QR. Esta rota também RETOMA a sessão, então é ela
    // que faz um QR expirado virar um novo.
    const conectar = await chamar(cred, `/instance/connect/${nome}`);
    if (!conectar.ok) {
      // Instância inexistente devolve 404 aqui; para quem chama, isso é
      // "desconectado", não erro -- o fluxo é criar de novo.
      if (conectar.status === 404) {
        return {
          instancia, estado: "desconectado", qr: null, codigo: null,
          telefone: null, nomePerfil: null,
        };
      }
      throw new Error(conectar.erro ?? "Falha ao obter o QR code.");
    }

    const j = conectar.json as {
      base64?: string;
      code?: string;
      pairingCode?: string;
      qrcode?: { base64?: string; pairingCode?: string };
    };
    const qr = comoDataUri(j?.base64 ?? j?.qrcode?.base64);

    return {
      instancia,
      estado: qr ? "aguardando" : "desconectado",
      qr,
      codigo: j?.pairingCode ?? j?.qrcode?.pairingCode ?? null,
      telefone: null,
      nomePerfil: null,
    };
  },

  async apontarWebhook(cred, instancia, url) {
    const r = await chamar(cred, `/webhook/set/${encodeURIComponent(instancia)}`, {
      method: "POST",
      // v2 embrulha em `webhook`; v1 espera os campos no topo. Mandar as duas
      // formas no mesmo corpo é aceito pelas duas.
      body: {
        webhook: { enabled: true, url, webhookByEvents: false, base64: true, events: EVENTOS },
        enabled: true,
        url,
        webhook_by_events: false,
        webhook_base64: true,
        events: EVENTOS,
      },
    });
    if (!r.ok) throw new Error(r.erro ?? "Falha ao configurar o webhook.");
  },

  async encerrarInstancia(cred, instancia) {
    const nome = encodeURIComponent(instancia);
    // Logout antes de apagar: sem ele o aparelho segue listando o CRM como
    // sessão ativa em "Aparelhos conectados".
    await chamar(cred, `/instance/logout/${nome}`, { method: "DELETE" });
    const r = await chamar(cred, `/instance/delete/${nome}`, { method: "DELETE" });
    // 404 é sucesso: o que se queria é que não exista mais.
    if (!r.ok && r.status !== 404) throw new Error(r.erro ?? "Falha ao remover a instância.");
  },

  lerWebhook(payload) {
    const p = payload as {
      event?: string;
      instance?: string;
      data?: unknown;
    } | null;

    const evento = String(p?.event ?? "").toLowerCase().replace(/_/g, ".");
    const instancia = p?.instance;
    // Sem a instância não há como saber de quem é a mensagem.
    if (!instancia || !p?.data) return [];

    // A Evolution manda ora um objeto, ora um array, para o mesmo evento.
    const itens = Array.isArray(p.data) ? p.data : [p.data];
    const eventos: EventoWebhook[] = [];

    if (evento === "messages.upsert") {
      for (const item of itens) {
        const m = item as {
          key?: { id?: string; remoteJid?: string; fromMe?: boolean };
          pushName?: string;
          messageType?: string;
          message?: Record<string, unknown>;
        };

        // Mensagem que NÓS mandamos volta pelo mesmo evento. Gravá-la como
        // recebida criaria conversa consigo mesmo e contaria resposta que não
        // houve -- e a taxa de resposta do painel viraria ficção.
        if (m?.key?.fromMe) continue;

        const id = m?.key?.id;
        const de = digitos(m?.key?.remoteJid);
        if (!id || !de) continue;

        // Grupo não é atendimento individual. `@g.us` no JID, e o CRM não tem
        // conceito de conversa em grupo -- entraria como contato fantasma.
        if (String(m?.key?.remoteJid ?? "").includes("@g.us")) continue;

        eventos.push({
          tipo: "mensagem",
          // A instância é a "origem": é por ela que se descobre a conexão, o
          // mesmo papel que o phone_number_id tem na Meta.
          origem: instancia,
          idMensagem: id,
          de,
          para: "",
          texto: textoDaMensagem(m?.message),
          tipoConteudo: m?.messageType ?? tipoDaMensagem(m?.message),
          nomePerfil: m?.pushName ?? null,
          bruto: item,
        });
      }
      return eventos;
    }

    if (evento === "messages.update") {
      for (const item of itens) {
        const u = item as { keyId?: string; key?: { id?: string }; status?: string };
        const id = u?.keyId ?? u?.key?.id;
        const st = STATUS[String(u?.status ?? "").toUpperCase()];
        if (!id || !st) continue;
        eventos.push({ tipo: "status", idMensagem: id, status: st, erro: null });
      }
      return eventos;
    }

    // connection.update e o resto não viram linha em whatsapp_messages. Quem
    // cuida do estado da conexão é a tela de pareamento, que pergunta direto ao
    // servidor -- depender do webhook para isso deixaria a tela travada em
    // "aguardando" se um evento se perdesse.
    return eventos;
  },
};

/** Baileys → o vocabulário de `whatsapp_messages`, que é o da Meta. */
const STATUS: Record<string, string> = {
  PENDING: "sent",
  SERVER_ACK: "sent",
  DELIVERY_ACK: "delivered",
  READ: "read",
  PLAYED: "read",
};

/**
 * O texto está em um lugar diferente por tipo de mensagem, e o Baileys aninha
 * fundo. Sem esta função, tudo que não fosse `conversation` viraria bolha vazia.
 */
function textoDaMensagem(msg: Record<string, unknown> | undefined): string | null {
  if (!msg) return null;
  const m = msg as {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string };
    videoMessage?: { caption?: string };
    documentMessage?: { caption?: string; fileName?: string };
    buttonsResponseMessage?: { selectedDisplayText?: string };
    listResponseMessage?: { title?: string };
    templateButtonReplyMessage?: { selectedDisplayText?: string };
  };

  const direto = m.conversation
    ?? m.extendedTextMessage?.text
    ?? m.buttonsResponseMessage?.selectedDisplayText
    ?? m.listResponseMessage?.title
    ?? m.templateButtonReplyMessage?.selectedDisplayText
    ?? m.imageMessage?.caption
    ?? m.videoMessage?.caption
    ?? m.documentMessage?.caption
    ?? m.documentMessage?.fileName;

  if (direto) return direto;
  // Mídia sem legenda: dizer o tipo é melhor que bolha vazia. Mesma escolha do
  // provedor da Meta.
  const tipo = tipoDaMensagem(msg);
  return tipo === "unknown" ? null : `[${tipo}]`;
}

function tipoDaMensagem(msg: Record<string, unknown> | undefined): string {
  if (!msg) return "unknown";
  const chave = Object.keys(msg).find((k) => k.endsWith("Message") || k === "conversation");
  if (!chave) return "unknown";
  return chave === "conversation" ? "text" : chave.replace(/Message$/, "");
}
