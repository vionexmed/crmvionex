/**
 * Carregando, falhou e vazio são três situações, e pedem três respostas.
 *
 * O levantamento encontrou 12 páginas sem indicador nenhum e 9 sem tratamento
 * de erro de leitura. O efeito é sempre o mesmo: uma consulta que falha devolve
 * lista vazia, a tela imprime "Nenhum resultado", e alguém conclui que não tem
 * cliente nenhum.
 *
 * Nas telas que usam React Query o dado já estava lá -- `isLoading` e `isError`
 * existem no retorno do hook e eram **descartados** pela desestruturação.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Telas de lista, e o que cada uma dizia antes nos três casos. */
const TELAS = [
  "src/pages/Contacts.tsx",
  "src/pages/Companies.tsx",
  "src/pages/Activities.tsx",
  "src/pages/Tasks.tsx",
  "src/pages/EmailTemplates.tsx",
  "src/pages/EmailSequences.tsx",
  "src/pages/Reports.tsx",
];

describe("as telas de lista distinguem os três estados", () => {
  it.each(TELAS)("%s monta os primitivos", (arquivo) => {
    const src = semComentarios(readFileSync(arquivo, "utf8"));
    expect(src).toContain('from "@/components/layout/EstadoDaLista"');
    expect(src, "sem estado de carregamento").toMatch(/<LoadingState|carregando=\{/);
    expect(src, "sem estado de erro").toMatch(/<ErrorState|erro=\{/);
  });

  /**
   * A ordem é obrigatória: **erro ANTES de vazio**. Uma consulta que falhou
   * devolve lista vazia, e dizer "nenhum resultado" nesse caso é afirmar um
   * fato que a tela não conhece.
   */
  it.each(TELAS)("%s testa o erro antes do vazio", (arquivo) => {
    const src = semComentarios(readFileSync(arquivo, "utf8"));
    const iErro = src.search(/<ErrorState|erro=\{/);
    const iVazio = src.search(/<EmptyState|vazio=\{/);
    if (iVazio < 0) return; // nem toda tela tem estado vazio próprio
    expect(iErro, "o estado vazio vem antes do de erro").toBeLessThan(iVazio);
  });

  /**
   * O botão de tentar de novo é o que separa "deu erro" de "desista". Sem ele
   * a única saída é recarregar a página inteira.
   */
  it.each(TELAS)("%s oferece tentar de novo", (arquivo) => {
    const src = semComentarios(readFileSync(arquivo, "utf8"));
    expect(src).toMatch(/onTentarNovamente=\{/);
  });
});

describe("os hooks de consulta param de descartar o estado", () => {
  /**
   * `const { data = [] } = useX()` joga fora `isLoading` e `isError`, que o
   * React Query já entrega prontos. Era a causa de metade dos casos: o dado
   * existia e a tela não olhava.
   */
  it.each([
    ["src/pages/Companies.tsx", "useCompanies"],
    ["src/pages/Activities.tsx", "useActivities"],
    ["src/pages/Tasks.tsx", "useActivities"],
  ])("%s lê isLoading e isError de %s", (arquivo, hook) => {
    const src = semComentarios(readFileSync(arquivo, "utf8"));
    const linha = src.split("\n").find((l) => l.includes(`= ${hook}(`));
    expect(linha, `chamada a ${hook} não encontrada`).toBeTruthy();
    expect(linha).toContain("isLoading");
    expect(linha).toContain("isError");
  });
});

describe("as buscas manuais conferem o erro", () => {
  /**
   * `(data as T[]) || []` transforma falha em lista vazia e apaga o erro. Duas
   * telas faziam isso sem nem ter estado de carregamento.
   */
  it.each([
    "src/pages/EmailTemplates.tsx",
    "src/pages/EmailSequences.tsx",
  ])("%s trata o error da consulta", (arquivo) => {
    const src = semComentarios(readFileSync(arquivo, "utf8"));
    expect(src).toMatch(/setFalhou\(true\)/);
    expect(src).toMatch(/console\.error\(/);
  });

  it("EmailSequences confere as QUATRO consultas, não uma", () => {
    // São quatro em Promise.all; conferir só a primeira deixaria três falhas
    // passarem como lista vazia.
    const src = semComentarios(readFileSync("src/pages/EmailSequences.tsx", "utf8"));
    expect(src).toMatch(/\[sRes, stRes, eRes, cRes\]\.find\(\(r\) => r\.error\)/);
  });
});
