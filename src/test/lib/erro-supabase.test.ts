/**
 * "[object Object]" é um erro de tela mascarando um erro de operação.
 *
 * O padrão espalhado pelas telas era `e instanceof Error ? e.message : String(e)`.
 * `PostgrestError` é um objeto simples, não instância de `Error`: o instanceof dá
 * falso, cai no `String(e)`, e o toast exibe "[object Object]".
 *
 * Aconteceu de verdade ao excluir um contato de teste: a mensagem real era
 * violação de chave estrangeira -- perfeitamente diagnosticável -- e ficou
 * invisível.
 */
import { describe, it, expect } from "vitest";
import { mensagemErro, ehViolacaoDeVinculo } from "@/lib/erro-supabase";

describe("mensagemErro", () => {
  it("nunca devolve [object Object]", () => {
    const casos: unknown[] = [
      { message: "boom" },
      { code: "23503" },
      {},
      null,
      undefined,
      42,
      [],
      new Error("erro real"),
      "texto solto",
    ];
    for (const c of casos) {
      expect(mensagemErro(c)).not.toContain("[object");
      expect(mensagemErro(c).trim().length).toBeGreaterThan(0);
    }
  });

  it("lê o campo message de um erro do PostgREST", () => {
    // O caso exato que falhava: objeto simples, não instância de Error.
    const erro = {
      message: 'update or delete on table "contacts" violates foreign key constraint',
      code: "23503",
      details: 'Key is still referenced from table "deals".',
      hint: null as string | null,
    };
    const m = mensagemErro(erro);
    expect(m).toContain("registros vinculados");
    expect(m).toContain("deals");
  });

  it("traduz o código antes de mostrar o texto cru do banco", () => {
    // Quem usa o CRM precisa saber o que fazer; "violates foreign key
    // constraint" é verdadeiro e inútil como primeira frase.
    const m = mensagemErro({ code: "23503", message: "violates foreign key constraint" });
    expect(m.indexOf("registros vinculados")).toBeLessThan(m.indexOf("violates"));
  });

  it("não repete a mesma frase duas vezes", () => {
    const m = mensagemErro({ code: "23503", message: "Há registros vinculados que impedem a exclusão." });
    expect(m.match(/registros vinculados/g)).toHaveLength(1);
  });

  it("prefere a mensagem de um Error de verdade", () => {
    expect(mensagemErro(new Error("falhou aqui"))).toBe("falhou aqui");
  });

  it("traduz permissão recusada pela RLS", () => {
    expect(mensagemErro({ code: "42501" })).toContain("permissão");
  });

  /**
   * PGRST200 é embed apontando para relação inexistente — o bug que fazia
   * clicar num negócio devolver o usuário para a lista. Ver
   * src/test/api/embed-com-fk.test.ts.
   */
  it("traduz relação inexistente no embed", () => {
    expect(mensagemErro({ code: "PGRST200" })).toContain("relação inexistente");
  });

  it("um Error sem mensagem não vira string vazia", () => {
    expect(mensagemErro(new Error("")).trim().length).toBeGreaterThan(0);
  });
});

describe("ehViolacaoDeVinculo", () => {
  it("reconhece 23503", () => {
    expect(ehViolacaoDeVinculo({ code: "23503" })).toBe(true);
  });

  it("não confunde com outros erros", () => {
    expect(ehViolacaoDeVinculo({ code: "23505" })).toBe(false);
    expect(ehViolacaoDeVinculo(new Error("qualquer"))).toBe(false);
    expect(ehViolacaoDeVinculo(null)).toBe(false);
  });
});

/**
 * O padrão estava em SEIS telas, não só em Contatos -- eram 12 lugares onde uma
 * falha do banco apareceria como "[object Object]". A que o usuário encontrou
 * foi a de excluir contato; as outras onze esperavam a vez.
 */
describe("nenhuma tela usa o padrão que produzia [object Object]", () => {
  const telas = [
    "src/App.tsx",
    "src/components/settings/SessionsPanel.tsx",
    "src/pages/Team.tsx",
    "src/pages/Deals.tsx",
    "src/pages/AcceptInvite.tsx",
    "src/pages/Contacts.tsx",
  ];

  it.each(telas)("%s", async (arq) => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(arq, "utf8");
    expect(src).not.toMatch(/instanceof Error \? e(rr)?\.message : String\(e(rr)?\)/);
    expect(src).toContain("mensagemErro");
  });
});
