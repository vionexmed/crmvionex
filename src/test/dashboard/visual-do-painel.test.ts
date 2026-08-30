/**
 * O visual do painel.
 *
 * O tile de métrica tinha barra colorida de 3px no topo, bolha circular para o
 * ícone, sombra, e o valor competindo com tudo isso. Quatro tiles lado a lado
 * viravam quatro objetos DECORADOS, e para ler os quatro números era preciso
 * atravessar a decoração de cada um.
 *
 * O estilo escolhido (Attio/Linear) resolve por tipografia: rótulo pequeno,
 * número grande, variação pequena. E por faixa em vez de cartões soltos.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const TILE = semComentarios(readFileSync("src/components/dashboard/StatCard.tsx", "utf8"));
const PAINEL = semComentarios(readFileSync("src/pages/Dashboard.tsx", "utf8"));
const GRAFICOS = semComentarios(readFileSync("src/components/dashboard/SdrCharts.tsx", "utf8"));

describe("o número é o elemento, não o cartão", () => {
  it("sem barra colorida no topo", () => {
    // Era `<div className="h-[3px] w-full" />` com a cor do acento.
    expect(TILE).not.toMatch(/h-\[3px\]/);
  });

  it("sem bolha circular no ícone", () => {
    // A bolha dava ao ícone o peso de um botão, e ele não é clicável nem
    // nomeia nada que o rótulo já não nomeie.
    expect(TILE).not.toMatch(/rounded-full[\s\S]{0,80}Icon/);
  });

  it("sem sombra", () => {
    expect(TILE).not.toMatch(/shadow-/);
  });

  /**
   * `sem fonte` era um selo. Um tile sem fonte já está apagado a 60%; o selo
   * por cima chamava atenção justamente para o que não tem o que mostrar.
   */
  it("o estado sem fonte é texto, não selo", () => {
    expect(TILE).not.toMatch(/<Badge[\s\S]{0,120}sem fonte/);
    expect(TILE).toContain("sem fonte de dado");
  });
});

describe("as métricas são uma faixa, não cartões soltos", () => {
  /**
   * `divide-x` divide numa direção só, e com 2 colunas no celular e 4 no
   * computador a conta de quais células levam borda muda a cada quebra --
   * vira uma pilha de `nth-child` que erra em algum tamanho.
   *
   * `gap-px` sobre fundo da cor da borda funciona sem a grade saber quantas
   * colunas tem.
   */
  it("a divisória é o fundo aparecendo pelo vão", () => {
    const faixas = PAINEL.match(/gap-px[^"]*bg-border/g) ?? [];
    expect(faixas.length, "as duas abas usam a faixa").toBeGreaterThanOrEqual(2);
  });

  it("nenhuma faixa depende de nth-child", () => {
    expect(PAINEL).not.toMatch(/nth-child/);
  });

  it("o tile dentro da faixa não desenha moldura própria", () => {
    expect(TILE).toContain("emFaixa");
    // Precisa de fundo próprio: é ele que tapa a grade e deixa só o vão à mostra.
    expect(TILE).toMatch(/emFaixa \? "[^"]*bg-background/);
  });
});

describe("os gráficos usam o cartão padrão", () => {
  /**
   * Os quatro usavam `border-0 shadow-sm` -- compensação de quando o Card vinha
   * com borda E sombra e o gráfico queria só a sombra. Sem a sombra no
   * primitivo, `border-0` deixaria o bloco sem separação nenhuma.
   */
  it("sem border-0 shadow-sm", () => {
    expect(GRAFICOS).not.toContain("border-0 shadow-sm");
  });
});

describe("os grupos de indicador usam o primitivo de seção", () => {
  it("Secao em vez de section com título à mão", () => {
    expect(PAINEL).toContain("<Secao");
    expect(PAINEL).not.toMatch(/<section[\s\S]{0,200}vx-titulo-secao/);
  });
});
