/**
 * Os primitivos que desenham superfície: cartão, tabela, selo, seção.
 *
 * O estilo escolhido (Attio/Linear) separa por RESPIRO e por uma linha fina, não
 * por caixa dentro de caixa. Os primitivos do shadcn vêm calibrados para o
 * oposto — e para base 16px, quando aqui a base é 13px.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Comentário explicando por que X saiu contém X, e reprova a regra que
 * documenta. É a QUINTA vez nesta base — está no CLAUDE.md como regra de como
 * escrever teste aqui, e eu repeti mesmo assim.
 */
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const CSS = readFileSync("src/index.css", "utf8");

describe("os tokens de superfície são distintos entre si", () => {
  const valor = (token: string) => {
    const raiz = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf("}", CSS.indexOf(":root {")));
    return raiz.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1]?.trim();
  };

  /**
   * `--muted` era IDÊNTICO a `--background`, e está documentado no CLAUDE.md
   * como armadilha: o truque padrão de kanban — coluna cinza, cartão branco —
   * era invisível no tema claro.
   *
   * Ao clarear o fundo eu quase repeti o erro com `--card`: os dois foram para
   * branco puro. Um pontinho de diferença é o que faz o cartão ler como
   * levantado.
   */
  it.each([
    ["--card", "--background"],
    ["--muted", "--background"],
    ["--popover", "--background"],
  ])("%s não é idêntico a %s", (a, b) => {
    expect(valor(a)).not.toBe(valor(b));
  });
});

describe("o cartão não tem dois sinais para a mesma coisa", () => {
  const CARD = semComentarios(readFileSync("src/components/ui/card.tsx", "utf8"));

  /**
   * Sombra OU borda, não as duas.
   *
   * O primitivo do shadcn vinha com `border` E `shadow-sm`: dois sinais para a
   * mesma coisa. Cheguei a tirar a sombra e ficar só com a linha; a escolha foi
   * o contrário -- o cartão se levanta do fundo cinza, e aí a borda vira
   * redundante.
   */
  it("elevação em vez de borda", () => {
    expect(CARD).toContain("vx-elevado");
    expect(CARD).not.toMatch(/cn\("[^"]*\bborder\b/);
  });

  /**
   * Duas camadas: a curta e opaca ancora o cartão na superfície, a longa e
   * difusa dá a altura. Só a longa faz o objeto flutuar sem apoio.
   */
  it("a elevação tem duas camadas", () => {
    const i = CSS.indexOf(".vx-elevado {");
    const bloco = CSS.slice(i, CSS.indexOf("}", i));
    expect((bloco.match(/hsl\(/g) ?? []).length).toBe(2);
  });

  /**
   * No escuro não há luz para bloquear -- sombra preta sobre fundo preto não
   * existe. A separação vem de uma linha de realce no topo.
   */
  it("no tema escuro a elevação é realce, não sombra", () => {
    expect(CSS).toMatch(/\.dark \.vx-elevado \{[\s\S]*?0 0 0 1px/);
  });

  /**
   * Havia `rounded-md` (115 usos) e `rounded-lg` (92) competindo — dois
   * arredondamentos na mesma tela. O token é a fonte única.
   */
  /**
   * `rounded-lg` JÁ é o token: o config define `lg: "var(--radius)"`.
   *
   * Eu tinha escrito `rounded-[var(--radius)]`, que dá o mesmo pixel e é uma
   * QUARTA forma de dizer a mesma coisa -- exatamente o problema que vim
   * resolver. A escala derivada é sm(6) / md(8) / lg(10), e é ela que deve
   * aparecer no código.
   */
  it("o raio vem da escala derivada do token", () => {
    expect(CARD).toMatch(/rounded-lg/);
    expect(CARD).not.toContain("rounded-[var(");
  });
});

describe("os primitivos foram recalibrados para a base de 13px", () => {
  it("o cabeçalho de tabela não tem o dobro da altura da linha", () => {
    // `h-12` (48px) é o default do shadcn, calibrado para base 16px.
    const src = semComentarios(readFileSync("src/components/ui/table.tsx", "utf8"));
    expect(src).not.toMatch(/cn\(\s*\n?\s*"h-12 px-4/);
  });

  /**
   * `rounded-full` + `px-2.5` + `font-semibold` fazia cada selo virar pílula
   * gorda. Numa linha de tabela com três selos, eles dominam e o dado vira
   * secundário.
   */
  it("o selo é marca, não botão", () => {
    const src = semComentarios(readFileSync("src/components/ui/badge.tsx", "utf8"));
    const base = src.slice(src.indexOf("cva("), src.indexOf("{", src.indexOf("cva(")));
    expect(base).not.toContain("rounded-full");
    expect(base).not.toContain("font-semibold");
    expect(base).toContain("text-label");
  });
});

describe("a seção tem primitivo", () => {
  const SECAO = semComentarios(readFileSync("src/components/layout/Secao.tsx", "utf8"));

  /**
   * `<Card>` como seção significa que todo bloco vira caixa, e uma página com
   * cinco blocos vira cinco caixas dentro de uma caixa.
   */
  it("sem moldura por padrão", () => {
    expect(SECAO).toMatch(/contornada = false/);
  });

  it("usa a mesma hierarquia de título das páginas", () => {
    // O bloco muda de embalagem, não de nível.
    expect(SECAO).toContain("vx-titulo-secao");
    expect(SECAO).toContain("vx-subtitulo");
  });

  /**
   * Uma linha vertical entre blocos EMPILHADOS aponta para o nada. Ela só
   * existe quando há duas colunas de verdade.
   */
  it("a divisória lateral é só no desktop", () => {
    expect(SECAO).toMatch(/lg:divide-x/);
    expect(SECAO).not.toMatch(/[^:]\bdivide-x\b/);
  });

  it("é um <section>, não um <div>", () => {
    // O bloco tem título; o elemento certo diz isso a quem navega por leitor.
    expect(SECAO).toMatch(/<section\n/);
  });
});
