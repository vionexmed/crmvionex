/**
 * A escala tipográfica.
 *
 * `body { font-size: 13px }` desalinha a escala do Tailwind, que assume 16px, e
 * o projeto compensava com **470 tamanhos arbitrários em px** espalhados pelo
 * código:
 *
 *     253×  text-[10px]      99×  text-[9px]      76×  text-[11px]
 *      23×  text-[8px]        7×  text-[13px]      4×  text-[12px]
 *
 * O custo não é estético. Com 253 lugares escrevendo `text-[10px]`, mudar "o
 * tamanho do rótulo pequeno" é uma edição em 253 arquivos — então ninguém muda,
 * e a escala fica congelada no que quer que tenha sido digitado primeiro.
 *
 * Nomeada, cada degrau muda em um lugar só.
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
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * Os únicos tamanhos que ficam soltos, e por quê: são números de destaque em
 * cartão, um por lugar, sem par em nenhuma outra tela. Nomeá-los criaria três
 * tokens de um uso cada — ruído maior que o problema.
 */
const DISPLAY_PERMITIDOS = new Set(["text-[18px]", "text-[22px]", "text-[28px]"]);

describe("os degraus têm nome", () => {
  const CFG = readFileSync("tailwind.config.ts", "utf8");

  /** O valor do degrau, em px, lido da própria declaração. */
  function px(nome: string): number | null {
    const m = CFG.match(new RegExp(`\\n\\s*${nome}: \\["([\\d.]+)rem"`));
    return m ? Number(m[1]) * 16 : null;
  }

  /**
   * A versão anterior deste teste fazia `expect(cfg).toContain("9px")` -- casava
   * em QUALQUER lugar do arquivo, comentário incluído. Quando a escala mudou de
   * 9/10/11/13 para 11/12/14, ele continuou passando: os números antigos
   * estavam no comentário que EXPLICA a mudança.
   *
   * Um teste que passa depois da mudança que deveria pegar não estava testando
   * nada. Agora lê o valor da declaração.
   */
  it("três degraus abaixo do corpo, e o menor é 11px", () => {
    expect(px("label")).toBe(11);
    expect(px("xs")).toBe(12);
  });

  /**
   * Havia 9 / 10 / 11 / 12 / 13 / 14px simultâneos -- seis tamanhos num
   * intervalo de cinco pixels. A diferença entre 10 e 11px não se lê como "um é
   * mais importante", só como "algo está desalinhado".
   */
  it("micro, meta e corpo são apelidos, não degraus próprios", () => {
    expect(px("micro")).toBe(px("label"));
    expect(px("meta")).toBe(px("label"));
    expect(px("corpo")).toBe(14);
  });

  /** 9px é menor que o mínimo legível confortável. */
  it("nada abaixo de 11px na escala", () => {
    for (const nome of ["label", "xs", "micro", "meta", "corpo"]) {
      expect(px(nome), `${nome} abaixo do piso`).toBeGreaterThanOrEqual(11);
    }
  });

  /**
   * `theme.extend.fontSize` ACRESCENTA; `theme.fontSize` SUBSTITUI. Se os
   * degraus fossem declarados fora de `extend`, `text-xs` e `text-sm` deixariam
   * de existir — e são 546 usos de `text-xs` sozinho.
   */
  it("os degraus são acrescentados, não substituem a escala do Tailwind", () => {
    const cfg = readFileSync("tailwind.config.ts", "utf8");
    const iExtend = cfg.indexOf("extend:");
    const iFontSize = cfg.indexOf("fontSize:");
    expect(iExtend).toBeGreaterThan(-1);
    expect(iFontSize).toBeGreaterThan(iExtend);
  });
});

describe("nenhum tamanho arbitrário novo", () => {
  it("só os três display de um uso cada", () => {
    const achados: string[] = [];
    for (const arquivo of TSX) {
      const src = semComentarios(readFileSync(arquivo, "utf8"));
      for (const m of src.matchAll(/text-\[\d+px\]/g)) {
        if (!DISPLAY_PERMITIDOS.has(m[0])) achados.push(`${arquivo}  ${m[0]}`);
      }
    }
    expect(achados, `tamanhos arbitrários:\n${achados.join("\n")}`).toEqual([]);
  });

  /**
   * 8px e 7px num CRM não são "discreto", são ilegíveis — e estavam em 24
   * lugares. O menor degrau que o projeto declara é 9px, e nada deve ficar
   * abaixo dele.
   */
  it("nada abaixo de 9px", () => {
    const achados: string[] = [];
    for (const arquivo of TSX) {
      const src = semComentarios(readFileSync(arquivo, "utf8"));
      for (const m of src.matchAll(/text-\[([0-8])px\]/g)) achados.push(`${arquivo}  ${m[0]}`);
    }
    expect(achados, achados.join("\n")).toEqual([]);
  });
});

/**
 * Altura de controle.
 *
 * Havia `h-7` (28px) em 77 lugares — abaixo do alvo de toque mínimo, e pequeno
 * demais ao lado do texto de 12–14px. `h-8` (32px) é o piso.
 *
 * A varredura acha o ELEMENTO DONO de cada `h-7`, não a linha: um `<Button>`
 * com `onClick={() => algo()}` tem um `>` no meio dos atributos, então qualquer
 * regex de "até o próximo `>`" para no lugar errado e deixa o caso passar. Foi
 * exatamente o que aconteceu na primeira tentativa.
 */
describe("nenhum controle abaixo de 32px", () => {
  const INTERATIVO = new Set([
    "Button", "Input", "SelectTrigger", "Textarea", "button", "input", "textarea",
  ]);

  it("varre pelo elemento dono, não pela linha", () => {
    const infratores: string[] = [];
    for (const arquivo of TSX) {
      // `ui/sidebar.tsx` é o primitivo do shadcn, com medidas próprias.
      if (arquivo.endsWith("ui/sidebar.tsx")) continue;
      const src = readFileSync(arquivo, "utf8");
      for (const m of src.matchAll(/\bh-7\b/g)) {
        let i = src.lastIndexOf("<", m.index!);
        while (i > 0 && " /\n".includes(src[i + 1])) i = src.lastIndexOf("<", i - 1);
        const tag = src.slice(i).match(/^<(\w+)/)?.[1];
        if (tag && INTERATIVO.has(tag)) {
          infratores.push(`${arquivo}:${src.slice(0, m.index!).split("\n").length}  <${tag}>`);
        }
      }
    }
    expect(infratores, infratores.join("\n")).toEqual([]);
  });

  /**
   * `h-7 w-7` num `<Button>` NÃO é decorativo. A primeira versão desta regra
   * pulava tudo que fosse quadrado, assumindo avatar ou bolinha — e deixou
   * passar dez botões de ícone, que são alvo de toque como qualquer outro.
   */
  it("botão quadrado de ícone também é alvo de toque", () => {
    const infratores: string[] = [];
    for (const arquivo of TSX) {
      const src = readFileSync(arquivo, "utf8");
      for (const m of src.matchAll(/<Button[\s\S]{0,300}?h-7 w-7/g)) {
        infratores.push(`${arquivo}  ${m[0].slice(-40)}`);
      }
    }
    expect(infratores, infratores.join("\n")).toEqual([]);
  });
});
