/**
 * Trava contra um bug que levou três tentativas para ser diagnosticado.
 *
 * `animation-fill-mode: both` inclui `forwards`, que PERSISTE o estado final da
 * animação. Quando esse estado final é um `transform` — mesmo `translateY(0)` —
 * o elemento fica com transform diferente de `none` para sempre, e passa a ser
 * BLOCO DE CONTENÇÃO de todo `position: fixed` descendente.
 *
 * `.vx-page` está no <main> que envolve todas as páginas. O clone do dnd-kit é
 * `position: fixed` com coordenadas de viewport: ancorado no <main>, ele ganhava
 * de offset a largura da sidebar e parecia fugir do cursor para a direita.
 * Duas correções erradas foram tentadas antes (largura do clone) porque o
 * sintoma parecia de dimensão.
 *
 * `backwards` resolve sem perder nada: aplica o estado inicial durante o delay
 * — que o .vx-stagger precisa — e devolve `transform: none` ao terminar.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/index.css", "utf8");

/** Nome dos @keyframes que mexem em transform. */
function keyframesComTransform(): Set<string> {
  const nomes = new Set<string>();
  const re = /@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    if (/\btransform\s*:/.test(m[2])) nomes.add(m[1]);
  }
  return nomes;
}

describe("fill-mode de animações que mexem em transform", () => {
  it("encontra os keyframes com transform (guarda contra regex quebrada)", () => {
    const nomes = keyframesComTransform();
    expect(nomes.size).toBeGreaterThan(0);
    expect(nomes.has("vxPageIn")).toBe(true);
  });

  it("nenhuma regra usa `both` ou `forwards` com esses keyframes", () => {
    const comTransform = keyframesComTransform();
    const culpados: string[] = [];

    // `animation: <nome> <duração> <easing> <fill-mode>` em uma linha
    const re = /animation:\s*([\w-]+)[^;]*?\b(both|forwards)\b[^;]*;/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
      if (comTransform.has(m[1])) culpados.push(`${m[1]} → ${m[2]}`);
    }

    expect(
      culpados,
      "fill-mode persistente + transform = bloco de contenção permanente para " +
        "position:fixed. Use `backwards`.",
    ).toEqual([]);
  });

  it("mantém `backwards` no .vx-stagger, que depende de animation-delay", () => {
    // Sem `backwards`, cada item pisca visível antes do próprio delay começar.
    expect(css).toMatch(/\.vx-stagger > \*\s*\{\s*animation:[^;]*\bbackwards\b/);
    expect(css).toMatch(/\.vx-stagger > \*:nth-child\(1\)\s*\{\s*animation-delay/);
  });
});
