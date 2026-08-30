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
  it("micro, label, meta e corpo estão declarados", () => {
    const cfg = readFileSync("tailwind.config.ts", "utf8");
    for (const [nome, px] of [["micro", "9px"], ["label", "10px"], ["meta", "11px"], ["corpo", "13px"]]) {
      expect(cfg, `degrau ${nome} não declarado`).toMatch(new RegExp(`${nome}: \\[`));
      expect(cfg, `${nome} deveria ser ${px}`).toContain(px);
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
