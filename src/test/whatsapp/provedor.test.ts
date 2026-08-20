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

describe("provedor Evolution — stub honesto", () => {
  it("recusa envio dizendo o motivo, em vez de falhar sem explicação", async () => {
    const evo = resolverProvedor("evolution");
    await expect(
      evo.enviarTexto({ provider: "evolution", token: "x", wabaId: null, serverUrl: null },
        { origem: "i", para: "55" }, "oi"),
    ).rejects.toThrow(/ainda não está disponível/);
  });

  it("verificarCredencial NÃO lança — o cadastro precisa poder exibir o motivo", async () => {
    const evo = resolverProvedor("evolution");
    const r = await evo.verificarCredencial({ provider: "evolution", token: "x", wabaId: null, serverUrl: null });
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/ainda não está disponível/);
  });
});
