/**
 * As duas faixas entre o cabeçalho e a lista.
 *
 * Estavam escritas à mão em SETE lugares — o painel de filtro em três e a barra
 * de seleção em quatro — e já divergiam: filtro com `bg-muted/30`, seleção com
 * `bg-muted/50`, e as duas cravando `rounded-lg` em vez do raio do token.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const COM_FILTRO = [
  "src/pages/Contacts.tsx",
  "src/pages/Companies.tsx",
  "src/components/crm/DealsFilters.tsx",
];
const COM_SELECAO = [
  "src/pages/Contacts.tsx",
  "src/pages/Companies.tsx",
  "src/components/crm/DealsList.tsx",
];

describe("ninguém monta a faixa à mão", () => {
  it.each(COM_FILTRO)("%s usa BarraDeFiltros", (arquivo) => {
    const src = semComentarios(readFileSync(arquivo, "utf8"));
    expect(src).toContain("<BarraDeFiltros>");
    expect(src).not.toMatch(/rounded-lg border border-border bg-muted\/30/);
  });

  it.each(COM_SELECAO)("%s usa BarraDeSelecao", (arquivo) => {
    const src = semComentarios(readFileSync(arquivo, "utf8"));
    expect(src).toContain("<BarraDeSelecao");
    expect(src).not.toMatch(/rounded-lg border border-border bg-muted\/50/);
  });
});

describe("a barra de seleção diz que é um estado", () => {
  const BARRA = semComentarios(readFileSync("src/components/layout/BarraDeAcoes.tsx", "utf8"));

  /**
   * Cinza é a cor de "isto está aqui"; a seleção é "você fez algo e a lista
   * está esperando". Com a faixa cinza, quem rolava a lista e voltava não tinha
   * pista de que ainda havia trinta linhas marcadas.
   */
  it("usa a cor de destaque, não cinza", () => {
    expect(BARRA).toMatch(/border-primary\/30 bg-primary\/5/);
  });

  /** `aria-live` para quem não vê a faixa aparecer. */
  it("anuncia a mudança", () => {
    expect(BARRA).toContain('role="status"');
    expect(BARRA).toContain('aria-live="polite"');
  });

  /**
   * Faltava nas quatro telas: com trinta linhas marcadas, a única saída era
   * desmarcar uma por uma ou recarregar a página.
   */
  it.each(COM_SELECAO)("%s oferece limpar a seleção", (arquivo) => {
    expect(semComentarios(readFileSync(arquivo, "utf8"))).toContain("onLimpar=");
  });

  /**
   * O plural era decidido em cada tela, e as quatro escolheram diferente:
   * "selecionados", "selecionadas", "selecionado(s)". A terceira é a que
   * denuncia — ninguém escreve "(s)" por gosto, escreve por não ter onde
   * resolver.
   */
  it("o plural é decidido no primitivo", () => {
    expect(BARRA).toMatch(/quantidade === 1 \? substantivo : plural/);
    for (const arquivo of COM_SELECAO) {
      expect(semComentarios(readFileSync(arquivo, "utf8")), arquivo).not.toContain("selecionado(s)");
    }
  });
});

describe("o realce ao passar o mouse não usa sombra", () => {
  /**
   * `hover:shadow-md` era o realce de quando o cartão JÁ tinha sombra em
   * repouso: subia de sm para md. Sem sombra em repouso, ele salta de plano
   * para elevado — e o salto é mais visível que o realce.
   */
  it("nenhum hover:shadow fora do primitivo do shadcn", () => {
    const infratores: string[] = [];
    for (const arquivo of [...COM_SELECAO, "src/pages/Inbox.tsx", "src/components/crm/DealsKanban.tsx",
                           "src/components/crm/ContactsKanbanByOwner.tsx"]) {
      if (readFileSync(arquivo, "utf8").includes("hover:shadow")) infratores.push(arquivo);
    }
    expect(infratores, infratores.join("\n")).toEqual([]);
  });
});
