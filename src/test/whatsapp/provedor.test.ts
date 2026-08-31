/**
 * O parse do webhook da Meta e a escolha de provedor.
 *
 * Vale testar porque o payload vem da internet, com campo faltando a qualquer
 * momento, e porque um erro aqui é silencioso: mensagem que não é reconhecida
 * simplesmente não aparece na conversa, sem erro em lugar nenhum.
 *
 * Importa direto do _shared das edge functions. São funções puras — nada de
 * Deno é tocado no carregamento do módulo, só `fetch` em tempo de envio, que
 * estes testes não exercitam.
 */
import { describe, it, expect } from "vitest";
import { resolverProvedor } from "../../../supabase/functions/_shared/whatsapp/index.ts";

const provedor = resolverProvedor("meta");

/** Envelope da Meta, com o mínimo que o parse precisa. */
function payload(value: Record<string, unknown>) {
  return { entry: [{ changes: [{ value }] }] };
}

const META = { phone_number_id: "111", display_phone_number: "+5511999990000" };

describe("resolverProvedor()", () => {
  it("resolve a Meta", () => {
    expect(resolverProvedor("meta").nome).toBe("meta");
  });

  it("resolve a Evolution", () => {
    expect(resolverProvedor("evolution").nome).toBe("evolution");
  });

  it("cai na Meta com valor nulo ou desconhecido — coluna nula não derruba envio", () => {
    expect(resolverProvedor(null).nome).toBe("meta");
    expect(resolverProvedor(undefined).nome).toBe("meta");
    expect(resolverProvedor("carteiro").nome).toBe("meta");
  });
});

describe("lerWebhook() — mensagem recebida", () => {
  it("extrai texto simples e o número que recebeu", () => {
    const [ev] = provedor.lerWebhook(payload({
      metadata: META,
      messages: [{ id: "wamid.1", from: "5511888887777", type: "text", text: { body: "oi" } }],
    }));

    expect(ev).toMatchObject({
      tipo: "mensagem",
      // `origem` é o número que RECEBEU: é por ele que se descobre a conexão.
      origem: "111",
      idMensagem: "wamid.1",
      de: "5511888887777",
      texto: "oi",
      tipoConteudo: "text",
    });
  });

  it("lê resposta de botão e de lista interativa", () => {
    const [botao] = provedor.lerWebhook(payload({
      metadata: META,
      messages: [{ id: "a", from: "55", type: "button", button: { text: "Quero" } }],
    }));
    expect(botao).toMatchObject({ texto: "Quero" });

    const [lista] = provedor.lerWebhook(payload({
      metadata: META,
      messages: [{ id: "b", from: "55", type: "interactive", interactive: { list_reply: { title: "Opção 2" } } }],
    }));
    expect(lista).toMatchObject({ texto: "Opção 2" });
  });

  it("tipo sem texto vira \"[tipo]\", não nulo", () => {
    // Bolha vazia na conversa parece bug; "[image]" diz o que chegou.
    const [ev] = provedor.lerWebhook(payload({
      metadata: META,
      messages: [{ id: "c", from: "55", type: "image" }],
    }));
    expect(ev).toMatchObject({ texto: "[image]", tipoConteudo: "image" });
  });

  it("captura o nome do perfil, que serve para criar o contato", () => {
    const [ev] = provedor.lerWebhook(payload({
      metadata: META,
      contacts: [{ profile: { name: "Dr. Alex" } }],
      messages: [{ id: "d", from: "55", type: "text", text: { body: "oi" } }],
    }));
    expect(ev).toMatchObject({ nomePerfil: "Dr. Alex" });
  });
});

describe("lerWebhook() — o que precisa ser descartado", () => {
  it("descarta o evento sem phone_number_id: não há conexão a resolver", () => {
    expect(provedor.lerWebhook(payload({
      messages: [{ id: "e", from: "55", type: "text", text: { body: "oi" } }],
    }))).toEqual([]);
  });

  it("descarta mensagem sem id — wa_message_id é UNIQUE, sem ele não dedupe", () => {
    expect(provedor.lerWebhook(payload({
      metadata: META,
      messages: [{ from: "55", type: "text", text: { body: "oi" } }],
    }))).toEqual([]);
  });

  it("descarta mensagem sem remetente", () => {
    expect(provedor.lerWebhook(payload({
      metadata: META,
      messages: [{ id: "f", type: "text", text: { body: "oi" } }],
    }))).toEqual([]);
  });

  it("aguenta payload vazio, nulo e sem entry", () => {
    expect(provedor.lerWebhook({})).toEqual([]);
    expect(provedor.lerWebhook(null)).toEqual([]);
    expect(provedor.lerWebhook({ entry: [] })).toEqual([]);
    expect(provedor.lerWebhook({ entry: [{}] })).toEqual([]);
  });
});

describe("lerWebhook() — status de entrega", () => {
  it("extrai status e o motivo do erro", () => {
    const [ev] = provedor.lerWebhook(payload({
      metadata: META,
      statuses: [{ id: "wamid.9", status: "failed", errors: [{ message: "número inválido" }] }],
    }));
    expect(ev).toEqual({
      tipo: "status",
      idMensagem: "wamid.9",
      status: "failed",
      erro: "número inválido",
    });
  });

  it("status sem erro vem com erro nulo", () => {
    const [ev] = provedor.lerWebhook(payload({
      metadata: META,
      statuses: [{ id: "wamid.10", status: "read" }],
    }));
    expect(ev).toMatchObject({ status: "read", erro: null });
  });

  it("descarta status incompleto", () => {
    expect(provedor.lerWebhook(payload({
      metadata: META,
      statuses: [{ id: "sem-status" }, { status: "sem-id" }],
    }))).toEqual([]);
  });
});

describe("lerWebhook() — vários eventos no mesmo POST", () => {
  it("a Meta agrupa, e todos têm de sair", () => {
    // Um POST pode trazer mensagem e status juntos, de vários números.
    const eventos = provedor.lerWebhook({
      entry: [
        { changes: [{ value: { metadata: META, messages: [{ id: "1", from: "55", type: "text", text: { body: "a" } }] } }] },
        { changes: [{ value: { metadata: { phone_number_id: "222" }, messages: [{ id: "2", from: "66", type: "text", text: { body: "b" } }] } }] },
        { changes: [{ value: { metadata: META, statuses: [{ id: "1", status: "delivered" }] } }] },
      ],
    });

    expect(eventos).toHaveLength(3);
    // Números diferentes no mesmo POST — é o caso de um WABA com vários números.
    expect(eventos.filter((e) => e.tipo === "mensagem").map((e) => "origem" in e && e.origem))
      .toEqual(["111", "222"]);
  });
});

describe("provedor Evolution — leitura do webhook", () => {
  const evo = resolverProvedor("evolution");

  /** Envelope da Evolution: evento no topo, instância, e `data`. */
  const upsert = (data: unknown) => ({ event: "messages.upsert", instance: "org-a-user-b", data });

  it("extrai texto simples e usa a INSTÂNCIA como origem", () => {
    const [ev] = evo.lerWebhook(upsert({
      key: { id: "3EB0A1", remoteJid: "5511888887777@s.whatsapp.net", fromMe: false },
      pushName: "Fulano",
      messageType: "conversation",
      message: { conversation: "oi" },
    }));

    expect(ev).toMatchObject({
      tipo: "mensagem",
      // Na Meta a origem é o phone_number_id; aqui é a instância. Mesmo papel:
      // é por ela que o webhook descobre de quem é a conexão.
      origem: "org-a-user-b",
      idMensagem: "3EB0A1",
      de: "5511888887777",
      texto: "oi",
      nomePerfil: "Fulano",
    });
  });

  it("tira o sufixo do JID do telefone", () => {
    // Ainda há contato em produção com `@s.whatsapp.net` gravado no telefone,
    // resíduo da fase anterior. Deixar passar reintroduziria aquilo.
    const [ev] = evo.lerWebhook(upsert({
      key: { id: "1", remoteJid: "5511999998888:12@s.whatsapp.net" },
      message: { conversation: "x" },
    }));
    expect(ev && "de" in ev && ev.de).toBe("5511999998888");
  });

  it("lê texto estendido, legenda de mídia e resposta de botão", () => {
    const texto = (message: unknown) => {
      const [ev] = evo.lerWebhook(upsert({ key: { id: "1", remoteJid: "55@s.whatsapp.net" }, message }));
      return ev && "texto" in ev ? ev.texto : null;
    };
    expect(texto({ extendedTextMessage: { text: "com link" } })).toBe("com link");
    expect(texto({ imageMessage: { caption: "olha isso" } })).toBe("olha isso");
    expect(texto({ buttonsResponseMessage: { selectedDisplayText: "Sim" } })).toBe("Sim");
  });

  it("mídia sem legenda vira [tipo], não bolha vazia", () => {
    const [ev] = evo.lerWebhook(upsert({
      key: { id: "1", remoteJid: "55@s.whatsapp.net" },
      message: { audioMessage: { seconds: 3 } },
    }));
    expect(ev && "texto" in ev && ev.texto).toBe("[audio]");
  });

  it("ignora o que NÓS mandamos", () => {
    // Volta pelo mesmo evento. Gravar como recebida criaria conversa consigo
    // mesmo e contaria resposta que não houve -- a taxa de resposta do painel
    // viraria ficção.
    expect(evo.lerWebhook(upsert({
      key: { id: "1", remoteJid: "55@s.whatsapp.net", fromMe: true },
      message: { conversation: "eu mandei" },
    }))).toEqual([]);
  });

  it("ignora grupo", () => {
    // O CRM não tem conceito de conversa em grupo; entraria como contato fantasma.
    expect(evo.lerWebhook(upsert({
      key: { id: "1", remoteJid: "12036304@g.us" },
      message: { conversation: "no grupo" },
    }))).toEqual([]);
  });

  it("aceita data como objeto OU como array", () => {
    const um = { key: { id: "1", remoteJid: "55@s.whatsapp.net" }, message: { conversation: "a" } };
    expect(evo.lerWebhook(upsert(um))).toHaveLength(1);
    expect(evo.lerWebhook(upsert([um, { ...um, key: { id: "2", remoteJid: "56@s.whatsapp.net" } }]))).toHaveLength(2);
  });

  it("traduz o status do Baileys para o vocabulário da tabela", () => {
    const st = (status: string) => {
      const [ev] = evo.lerWebhook({
        event: "messages.update", instance: "i", data: { keyId: "9", status },
      });
      return ev && "status" in ev ? ev.status : null;
    };
    expect(st("SERVER_ACK")).toBe("sent");
    expect(st("DELIVERY_ACK")).toBe("delivered");
    expect(st("READ")).toBe("read");
    // Status que não conhecemos não vira linha: gravar "PLAYED_2" cru faria a
    // consulta de abordagens, que compara por string, parar de contar.
    expect(st("INVENTADO")).toBeNull();
  });

  it("evento sem instância ou sem data não produz nada", () => {
    expect(evo.lerWebhook({ event: "messages.upsert", data: {} })).toEqual([]);
    expect(evo.lerWebhook({ event: "messages.upsert", instance: "i" })).toEqual([]);
    expect(evo.lerWebhook({})).toEqual([]);
  });

  it("connection.update não vira mensagem", () => {
    // Quem cuida do estado é a tela de pareamento, perguntando ao servidor.
    expect(evo.lerWebhook({
      event: "connection.update", instance: "i", data: { state: "open" },
    })).toEqual([]);
  });
});

describe("as duas formas de parear", () => {
  it("a Meta é lista; a Evolution é QR code", () => {
    expect(resolverProvedor("meta").formaDePareamento).toBe("lista");
    expect(resolverProvedor("evolution").formaDePareamento).toBe("qrcode");
  });

  it("a Meta recusa QR dizendo onde o número é cadastrado", async () => {
    await expect(
      resolverProvedor("meta").iniciarPareamento(
        { provider: "meta", token: "x", wabaId: "1", serverUrl: null }, "i",
      ),
    ).rejects.toThrow(/Business Manager/);
  });

  /**
   * O webhook da Meta é apontado à mão no painel dela. Recusar aqui obrigaria
   * quem chama a saber de qual provedor se trata -- que é justamente o que o
   * contrato existe para evitar.
   */
  it("apontarWebhook da Meta não falha, porque não há o que fazer", async () => {
    await expect(
      resolverProvedor("meta").apontarWebhook(
        { provider: "meta", token: "x", wabaId: "1", serverUrl: null }, "i", "https://x",
      ),
    ).resolves.toBeUndefined();
  });

  it("a Evolution exige a URL do servidor antes de qualquer coisa", async () => {
    const r = await resolverProvedor("evolution").verificarCredencial(
      { provider: "evolution", token: "x", wabaId: null, serverUrl: null },
    );
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/URL do servidor/);
  });
});
