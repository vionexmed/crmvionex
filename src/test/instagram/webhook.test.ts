/**
 * O parse do webhook do Instagram.
 *
 * Vale testar pelo mesmo motivo do WhatsApp: o payload vem da internet, com
 * campo faltando a qualquer momento, e o erro é SILENCIOSO -- mensagem não
 * reconhecida simplesmente não aparece na conversa, sem erro em lugar nenhum.
 *
 * Importa direto do _shared das edge functions. `lerWebhook` é pura; o `fetch`
 * mora nas funções de envio, que estes testes não exercitam.
 */
import { describe, it, expect } from "vitest";
import {
  lerWebhook,
  descricaoDeConteudo,
} from "../../../supabase/functions/_shared/instagram/api.ts";

const CONTA = "17841400000000000";
const PESSOA = "17841499999999999";

/** Envelope do Instagram, com o mínimo que o parse precisa. */
function payload(messaging: Record<string, unknown>[]) {
  return { object: "instagram", entry: [{ id: CONTA, messaging }] };
}

const deEla = (message: Record<string, unknown>) => ({
  sender: { id: PESSOA },
  recipient: { id: CONTA },
  message,
});

describe("mensagem que entra", () => {
  it("lê texto, remetente e conta", () => {
    const [ev] = lerWebhook(payload([deEla({ mid: "m1", text: "Bom dia" })]));
    expect(ev).toMatchObject({
      tipo: "mensagem",
      conta: CONTA,
      pessoa: PESSOA,
      direcao: "inbound",
      idMensagem: "m1",
      texto: "Bom dia",
      tipoConteudo: "text",
    });
  });

  it("guarda o evento bruto", () => {
    const [ev] = lerWebhook(payload([deEla({ mid: "m1", text: "oi" })]));
    // O `raw` é o que permite entender depois um caso que o parse errou.
    expect(ev.tipo === "mensagem" && ev.bruto).toBeTruthy();
  });
});

/**
 * O ECO, que é a parte que engana.
 *
 * `is_echo` marca a mensagem que SAIU da conta da empresa -- inclusive quando
 * alguém respondeu pelo aplicativo do Instagram no celular, fora do CRM.
 */
describe("eco: quem é 'a pessoa' troca de lado", () => {
  const eco = payload([{
    sender: { id: CONTA },      // a EMPRESA envia
    recipient: { id: PESSOA },  // a PESSOA recebe
    message: { mid: "m2", text: "Claro, doutor", is_echo: true },
  }]);

  it("a pessoa é o destinatário, não o remetente", () => {
    const [ev] = lerWebhook(eco);
    /*
     * Ler `sender` sempre gravaria a CONTA DA EMPRESA como se fosse o contato --
     * e cada resposta dada pelo celular criaria um contato novo chamado com o @
     * da própria empresa. É o defeito que este teste existe para impedir.
     */
    expect(ev.tipo === "mensagem" && ev.pessoa).toBe(PESSOA);
    expect(ev.tipo === "mensagem" && ev.pessoa).not.toBe(CONTA);
  });

  it("a direção é de saída", () => {
    const [ev] = lerWebhook(eco);
    expect(ev.tipo === "mensagem" && ev.direcao).toBe("outbound");
  });

  it("o eco NÃO é descartado", () => {
    /*
     * O WhatsApp descarta o equivalente (`fromMe`), e ali faz sentido: a
     * Evolution ecoa o que o próprio CRM acabou de enviar. Aqui o eco é a única
     * forma de o CRM saber de uma resposta dada pelo celular -- descartá-lo
     * deixaria a conversa com buracos.
     */
    expect(lerWebhook(eco).filter((e) => e.tipo === "mensagem")).toHaveLength(1);
  });
});

describe("tipo de conteúdo", () => {
  /**
   * A ORDEM IMPORTA. Resposta a story TEM texto, então checar texto primeiro
   * classificaria toda resposta a story como texto simples -- e a tela perderia
   * o contexto de que aquilo responde a uma publicação.
   */
  it("resposta a story vence texto", () => {
    const [ev] = lerWebhook(payload([deEla({
      mid: "m3",
      text: "que legal!",
      reply_to: { story: { id: "s1", url: "https://..." } },
    })]));
    expect(ev.tipo === "mensagem" && ev.tipoConteudo).toBe("story_reply");
    // O texto continua disponível: é a resposta dela.
    expect(ev.tipo === "mensagem" && ev.texto).toBe("que legal!");
  });

  it("anexo vira o tipo do anexo", () => {
    for (const tipo of ["image", "video", "audio", "share", "story_mention"]) {
      const [ev] = lerWebhook(payload([deEla({ mid: "x", attachments: [{ type: tipo }] })]));
      expect(ev.tipo === "mensagem" && ev.tipoConteudo).toBe(tipo);
    }
  });

  it("tipo desconhecido não derruba nada", () => {
    /*
     * A Meta acrescenta tipo sem avisar. `instagram_messages.message_type` não
     * tem CHECK pelo mesmo motivo: um tipo novo tem de virar mensagem gravada,
     * não webhook falhando -- e a Meta desativa webhook que falha.
     */
    const [ev] = lerWebhook(payload([deEla({ mid: "x", is_unsupported: true })]));
    expect(ev.tipo === "mensagem" && ev.tipoConteudo).toBe("unsupported");
  });

  it("sem texto e sem anexo é unsupported, não texto vazio", () => {
    const [ev] = lerWebhook(payload([deEla({ mid: "x" })]));
    expect(ev.tipo === "mensagem" && ev.tipoConteudo).toBe("unsupported");
  });
});

describe("o que não é mensagem", () => {
  it("outro produto da Meta é recusado pelo `object`", () => {
    // O mesmo webhook serve Página do Facebook. Sem esta checagem, um evento de
    // Página entraria como Direct.
    const eventos = lerWebhook({ object: "page", entry: [{ id: CONTA, messaging: [] }] });
    expect(eventos).toEqual([{ tipo: "ignorado", motivo: "object=page" }]);
  });

  it("confirmação de leitura vira evento próprio", () => {
    const [ev] = lerWebhook(payload([{ sender: { id: PESSOA }, recipient: { id: CONTA }, read: { mid: "m1" } }]));
    expect(ev).toEqual({ tipo: "lido", conta: CONTA, pessoa: PESSOA });
  });

  it("curtida não vira mensagem", () => {
    const [ev] = lerWebhook(payload([{
      sender: { id: PESSOA }, recipient: { id: CONTA },
      reaction: { mid: "m1", action: "react", emoji: "❤️" },
    }]));
    expect(ev.tipo).toBe("ignorado");
  });

  it("mensagem apagada na origem não é gravada", () => {
    const [ev] = lerWebhook(payload([deEla({ mid: "m1", text: "ops", is_deleted: true })]));
    expect(ev.tipo).toBe("ignorado");
  });

  it("evento sem IGSID é ignorado em vez de gravar undefined", () => {
    const [ev] = lerWebhook(payload([{ recipient: { id: CONTA }, message: { mid: "m1", text: "oi" } }]));
    expect(ev.tipo).toBe("ignorado");
  });

  it("payload vazio não estoura", () => {
    expect(lerWebhook({})).toEqual([]);
    expect(lerWebhook({ object: "instagram" })).toEqual([]);
    expect(lerWebhook({ object: "instagram", entry: [{}] })).toEqual([]);
  });
});

describe("descrição de conteúdo sem texto", () => {
  /**
   * Sem isto a conversa mostra linhas vazias, e linha vazia parece defeito da
   * tela -- não "a pessoa mandou uma foto".
   */
  it("todo tipo conhecido tem frase", () => {
    for (const tipo of ["image", "video", "audio", "file", "share", "ig_reel", "story_mention", "story_reply"]) {
      expect(descricaoDeConteudo(tipo)).not.toBe("Mensagem");
    }
  });

  it("tipo novo cai num rótulo genérico em vez de vazio", () => {
    expect(descricaoDeConteudo("tipo_que_a_meta_inventou")).toBe("Mensagem");
  });
});
