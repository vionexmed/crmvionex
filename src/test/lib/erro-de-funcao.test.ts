/**
 * A mensagem real de uma edge function que falhou.
 *
 * `functions.invoke` não lê o corpo quando o status não é 2xx: devolve um erro
 * cuja `message` é sempre "Edge Function returned a non-2xx status code". O
 * corpo fica em `error.context`, que é a `Response` crua.
 *
 * É o mesmo defeito do `[object Object]` do CLAUDE.md: a função diz exatamente o
 * que falta e a tela mostra uma frase que não ajuda ninguém.
 */
import { describe, it, expect } from "vitest";
import { erroDaFuncao } from "@/lib/erro-supabase";

/** Imita o `FunctionsHttpError` do supabase-js. */
const erroHttp = (corpo: unknown) => ({
  message: "Edge Function returned a non-2xx status code",
  context: { json: () => Promise.resolve(corpo) },
});

describe("erroDaFuncao", () => {
  it("sem erro devolve null", async () => {
    expect(await erroDaFuncao({ data: { url: "https://..." }, error: null })).toBeNull();
  });

  /** O CASO QUE MOTIVOU: 503 com a mensagem no corpo. */
  it("lê a mensagem do corpo em status não-2xx", async () => {
    const msg = await erroDaFuncao({
      data: null,
      error: erroHttp({ error: "Falta configurar INSTAGRAM_APP_ID nos secrets do projeto." }),
    });
    expect(msg).toBe("Falta configurar INSTAGRAM_APP_ID nos secrets do projeto.");
    expect(msg).not.toContain("non-2xx");
  });

  it("200 com erro no corpo também é erro", async () => {
    // Várias funções do projeto sinalizam falha de negócio assim.
    expect(await erroDaFuncao({ data: { error: "Contato não encontrado" }, error: null }))
      .toBe("Contato não encontrado");
  });

  it("corpo do erro tem precedência sobre a frase genérica", async () => {
    const msg = await erroDaFuncao({ data: null, error: erroHttp({ error: "Sem organização" }) });
    expect(msg).toBe("Sem organização");
  });

  it("corpo que não é JSON cai na mensagem genérica, sem estourar", async () => {
    const msg = await erroDaFuncao({
      data: null,
      error: { message: "Edge Function returned a non-2xx status code",
               context: { json: () => Promise.reject(new Error("not json")) } },
    });
    expect(msg).toBe("Edge Function returned a non-2xx status code");
  });

  it("erro sem context nenhum não estoura", async () => {
    expect(await erroDaFuncao({ data: null, error: { message: "Failed to fetch" } }))
      .toBe("Failed to fetch");
  });

  it("nunca devolve [object Object]", async () => {
    // O corpo pode trazer um objeto em vez de string — é o caso que produzia
    // `[object Object]` nas 12 telas que o CLAUDE.md registra.
    const msg = await erroDaFuncao({
      data: null,
      error: erroHttp({ error: { message: "violates foreign key", code: "23503" } }),
    });
    expect(msg).not.toBe("[object Object]");
    expect(msg).toContain("violates foreign key");
  });
});
