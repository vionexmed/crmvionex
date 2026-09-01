/**
 * Título e subtítulo, em todos os níveis.
 *
 * Havia **quatorze** combinações de classe para título, entre `<h1>`, `<h2>` e
 * `<h3>` soltos: `text-2xl font-bold tracking-tight`, `text-xl font-bold`,
 * `text-lg font-semibold`, `text-lg font-bold`, `text-base font-semibold`,
 * `text-xs font-medium`…
 *
 * E a fonte mudava junto: `font-heading` (Poppins) em alguns, e os outros
 * herdando Nunito do `body`. O nome da tela tinha aparência diferente conforme
 * onde você estava.
 *
 * O subtítulo tinha oito formas — `text-sm text-muted-foreground mt-1`,
 * `text-muted-foreground` puro, `text-xs`, `mt-2 text-muted-foreground`… Então
 * mesmo com o título padronizado, o PAR continuava desalinhado.
 *
 * O primitivo `CardTitle` era o pior caso: o default era `text-2xl` e **81 dos
 * 86 usos sobrescreviam** — 66 deles para `text-sm`. Um default que nunca é o
 * que se quer é um default errado.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const TSX = (function varrer(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) varrer(caminho, saida);
    else if (nome.endsWith(".tsx")) saida.push(caminho);
  }
  return saida;
})("src");

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const CSS = readFileSync("src/index.css", "utf8");

describe("os níveis existem em um lugar só", () => {
  it.each(["vx-titulo-tela", "vx-titulo-painel", "vx-titulo-secao", "vx-subtitulo-tela", "vx-subtitulo"])(
    ".%s está no CSS",
    (classe) => {
      expect(CSS).toMatch(new RegExp(`^\\.${classe} \\{`, "m"));
    },
  );

  /**
   * O nível da tela precisa da fonte de título. Sem `font-heading` ele herda
   * Nunito do `body`, que é a divergência original: a mesma frase em Poppins
   * numa tela e em Nunito na outra.
   */
  it("o título de tela usa a fonte de título", () => {
    const bloco = CSS.slice(CSS.indexOf(".vx-titulo-tela {"), CSS.indexOf("}", CSS.indexOf(".vx-titulo-tela {")));
    expect(bloco).toContain("font-heading");
  });

  it("cada nível é um degrau distinto", () => {
    const tamanho = (classe: string) => {
      const i = CSS.indexOf(`.${classe} {`);
      return CSS.slice(i, CSS.indexOf("}", i)).match(/text-(xl|base|sm|meta|corpo|2xl)/)?.[1];
    };
    expect(tamanho("vx-titulo-tela")).toBe("xl");
    expect(tamanho("vx-titulo-painel")).toBe("base");
    expect(tamanho("vx-titulo-secao")).toBe("sm");
  });
});

describe("nenhum título é montado à mão", () => {
  /**
   * Um `<h1>` com utilidades soltas é como as quatorze combinações apareceram:
   * cada tela decidindo por conta, sem ninguém comparando.
   */
  it("todo h1/h2/h3 usa uma das classes", () => {
    const infratores: string[] = [];
    for (const arquivo of TSX) {
      if (arquivo.endsWith("ui/card.tsx")) continue; // o primitivo define o nível
      const src = semComentarios(readFileSync(arquivo, "utf8"));
      src.split("\n").forEach((l, i) => {
        const m = l.match(/<h[123]\s+className="([^"]*)"/);
        if (!m) return;
        if (/vx-titulo-(tela|painel|secao)/.test(m[1])) return;
        infratores.push(`${arquivo}:${i + 1}  ${m[1]}`);
      });
    }
    expect(infratores, `títulos soltos:\n${infratores.join("\n")}`).toEqual([]);
  });
});

describe("o primitivo de cartão tem o default certo", () => {
  const CARD = readFileSync("src/components/ui/card.tsx", "utf8");

  it("CardTitle nasce no tamanho de seção", () => {
    // Era `text-2xl`, e 81 dos 86 usos sobrescreviam.
    expect(CARD).toMatch(/CardTitle[\s\S]*?text-sm font-semibold/);
    expect(CARD).not.toMatch(/CardTitle[\s\S]*?cn\("text-2xl/);
  });

  it("CardDescription nasce no tamanho de subtítulo", () => {
    expect(CARD).toMatch(/CardDescription[\s\S]*?text-label text-muted-foreground/);
  });

  /**
   * Se o default está certo, ninguém precisa repeti-lo. Sobrescrever o tamanho
   * é o sinal de que a divergência está voltando.
   */
  it("nenhum CardTitle sobrescreve o tamanho", () => {
    const infratores: string[] = [];
    for (const arquivo of TSX) {
      const src = semComentarios(readFileSync(arquivo, "utf8"));
      for (const m of src.matchAll(/<CardTitle className="([^"]*)"/g)) {
        // `font-heading text-xl` é o nível de tela, para cartão que É a página
        // (entrada, wizard, erro em tela cheia).
        if (m[1].includes("font-heading text-xl")) continue;
        if (/\btext-(2xl|xl|lg|base|meta|label|xs)\b/.test(m[1])) infratores.push(`${arquivo}  ${m[1]}`);
      }
    }
    expect(infratores, infratores.join("\n")).toEqual([]);
  });

  it("nenhum CardDescription sobrescreve o tamanho", () => {
    const infratores: string[] = [];
    for (const arquivo of TSX) {
      const src = semComentarios(readFileSync(arquivo, "utf8"));
      for (const m of src.matchAll(/<CardDescription className="([^"]*)"/g)) {
        // `text-sm` acompanha os títulos de nível de tela.
        if (m[1].includes("text-sm")) continue;
        if (/\btext-(sm|xs|label|meta)\b/.test(m[1])) infratores.push(`${arquivo}  ${m[1]}`);
      }
    }
    expect(infratores, infratores.join("\n")).toEqual([]);
  });
});

describe("o PageHeader usa as mesmas classes que as telas sem casca", () => {
  const src = readFileSync("src/components/layout/PageHeader.tsx", "utf8");

  /**
   * Se o PageHeader tivesse a própria definição, existiriam DUAS do mesmo
   * nível — e elas divergiriam na primeira vez que alguém ajustasse uma.
   */
  it("título e subtítulo vêm das classes", () => {
    expect(src).toContain("vx-titulo-tela");
    expect(src).toContain("vx-subtitulo-tela");
  });
});
