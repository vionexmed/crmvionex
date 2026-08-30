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

  it("as dez usam o componente compartilhado", () => {
    // Eram onze; `Tasks` virou um filtro de `Activities` e a tela saiu.
    const usam = PAGINAS.filter((f) => readFileSync(f, "utf8").includes("<SemOrganizacao />"));
    expect(usam.length).toBe(10);
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
