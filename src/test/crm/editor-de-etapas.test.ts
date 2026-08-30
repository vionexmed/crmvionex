/**
 * O editor de etapas do funil.
 *
 * Havia dois, e **nenhum era completo**:
 *
 *   Negócios ("Personalizar funil")   renomear, recolorir, probabilidade
 *                                     — mas NÃO reordenar
 *   Configurações ("Etapas")          reordenar e apagar
 *                                     — mas NÃO renomear nem recolorir
 *
 * Em Configurações, corrigir o nome de uma etapa exigia apagá-la e criar de
 * novo — perdendo os negócios que estavam nela.
 *
 * E a descrição em Configurações prometia "Arraste para reordenar". Não havia
 * arraste nenhum: eram os caracteres ▲▼ como texto.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// Sem comentários: o próprio comentário que EXPLICA por que ▲▼ saíram contém
// os caracteres, e reprovaria a regra que ele documenta.
const LINHA = semComentarios(readFileSync("src/components/crm/LinhaDeEtapa.tsx", "utf8"));
const LINHA_BRUTA = readFileSync("src/components/crm/LinhaDeEtapa.tsx", "utf8");
const DEALS = semComentarios(readFileSync("src/pages/Deals.tsx", "utf8"));
const CONFIG = semComentarios(readFileSync("src/components/settings/PipelinesTab.tsx", "utf8"));

describe("as duas telas usam a mesma linha", () => {
  it.each([
    ["src/pages/Deals.tsx", DEALS],
    ["src/components/settings/PipelinesTab.tsx", CONFIG],
  ])("%s monta LinhaDeEtapa", (_arquivo, src) => {
    expect(src).toContain("<LinhaDeEtapa");
    expect(src).toContain('from "@/components/crm/LinhaDeEtapa"');
  });

  it("as duas podem reordenar", () => {
    // Negócios não podia. A ordem importa de verdade: a etapa de ENTRADA do
    // funil é identificada pelo MENOR `order`, nunca pelo nome.
    expect(DEALS).toContain("onMover=");
    expect(CONFIG).toContain("onMover=");
  });

  it("as duas podem renomear e recolorir", () => {
    // Configurações não podia: só dava para apagar e recriar, perdendo os
    // negócios da etapa.
    for (const src of [DEALS, CONFIG]) expect(src).toContain("onChange=");
  });
});

describe("a linha faz as quatro coisas", () => {
  it("cor, nome, probabilidade e remover", () => {
    expect(LINHA).toContain('type="color"');
    expect(LINHA).toContain("onChange({ name:");
    expect(LINHA).toContain("win_probability:");
    expect(LINHA).toContain("onRemover");
  });

  /**
   * `min`/`max` do HTML não impedem digitar 500 -- só marcam o campo como
   * inválido. Uma etapa com 500% de probabilidade envenena a previsão inteira,
   * que soma por faixa.
   */
  it("limita a probabilidade na entrada, não só no atributo", () => {
    expect(LINHA).toMatch(/Math\.max\(0, Math\.min\(100,/);
  });

  /**
   * As setas eram os caracteres ▲▼ soltos: sem nome acessível, e com alvo de
   * clique do tamanho da letra.
   */
  it("as setas têm nome acessível", () => {
    expect(LINHA).not.toContain("▲");
    expect(LINHA).not.toContain("▼");
    expect(LINHA).toMatch(/aria-label=\{`Mover /);
  });

  it("todo campo tem rótulo", () => {
    // Nenhum dos dois editores rotulava os campos: era um `<input type=color>`
    // e um número solto, sem nome nenhum para leitor de tela.
    const rotulos = LINHA_BRUTA.match(/aria-label=/g) ?? [];
    expect(rotulos.length).toBeGreaterThanOrEqual(5);
  });
});

describe("Configurações não grava a cada tecla", () => {
  /**
   * A tela grava direto no banco, sem botão de salvar. Ligar `onChange` ao
   * `update` faria uma consulta por CARACTERE digitado no nome.
   */
  it("mantém rascunho e grava no blur", () => {
    expect(CONFIG).toMatch(/const \[rascunho, setRascunho\]/);
    expect(CONFIG).toContain("onSalvar=");
    expect(LINHA).toContain("onBlur={onSalvar}");
  });

  it("a descrição não promete arraste", () => {
    // Dizia "Arraste para reordenar" e não havia arraste nenhum.
    expect(CONFIG).not.toContain("Arraste para reordenar");
  });
});
