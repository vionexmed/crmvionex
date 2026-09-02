/**
 * A tela de quem ainda não tem organização.
 *
 * Onze páginas tratavam isso, em DUAS mensagens diferentes: seis diziam "Crie
 * uma organização **em Configurações** primeiro" e cinco diziam só "Crie uma
 * organização primeiro" — sem dizer onde.
 *
 * E nenhuma das onze levava lá. A pessoa lia uma instrução e tinha que
 * encontrar o caminho sozinha, num menu que ela ainda não conhece porque acabou
 * de entrar. É a primeira tela de quem acaba de se cadastrar.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const PAGINAS = readdirSync("src/pages")
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => `src/pages/${f}`);

describe("uma resposta só para quem não tem organização", () => {
  it("nenhuma página monta a mensagem à mão", () => {
    const infratores = PAGINAS.filter((f) =>
      semComentarios(readFileSync(f, "utf8")).includes("Crie uma organiza"),
    );
    expect(infratores, infratores.join("\n")).toEqual([]);
  });

  /**
   * LISTA, e não contagem.
   *
   * A asserção era `usam.length === 10`, e reprovou quando a tela de Produtos
   * entrou -- sem que nada da intenção mudasse. Pior: a mensagem dizia
   * "9 não é 10" e deixava para quem lê descobrir QUAL página faltava.
   *
   * Cheguei a tentar derivar a lista ("toda página que chama useOrg deve usar o
   * componente"), e não vale: NOVE páginas chamam `useOrg()` sem ele, de
   * propósito -- Painel, Configurações e Equipe resolvem a ausência de outro
   * jeito. A varredura genérica gritaria nas nove.
   *
   * Lista explícita, então: acrescentar tela é uma edição deliberada, e a falha
   * nomeia o arquivo. É o que o CLAUDE.md recomenda para este caso.
   */
  const EXIGEM_SEM_ORGANIZACAO = [
    "src/pages/Activities.tsx",
    "src/pages/Automations.tsx",
    "src/pages/Companies.tsx",
    "src/pages/Contacts.tsx",
    "src/pages/Deals.tsx",
    "src/pages/EmailSequences.tsx",
    "src/pages/EmailTemplates.tsx",
    "src/pages/Inbox.tsx",
    "src/pages/LeadScoring.tsx",
    "src/pages/Produtos.tsx",
    "src/pages/Reports.tsx",
  ];

  it.each(EXIGEM_SEM_ORGANIZACAO)("%s usa o componente compartilhado", (arquivo) => {
    expect(readFileSync(arquivo, "utf8")).toContain("<SemOrganizacao />");
  });

  /**
   * O que faltava nas onze: um caminho. Instrução sem link obriga a procurar.
   */
  it("leva a Configurações em vez de mandar procurar", () => {
    const src = readFileSync("src/components/layout/SemOrganizacao.tsx", "utf8");
    expect(src).toContain('to="/settings"');
    expect(src).toContain("<Link");
  });

  it("reusa o primitivo de estado vazio", () => {
    // Era um `<div>` com texto centralizado, sem ícone e sem hierarquia --
    // o décimo segundo formato de estado vazio do projeto.
    const src = readFileSync("src/components/layout/SemOrganizacao.tsx", "utf8");
    expect(src).toContain("<EmptyState");
  });
});
