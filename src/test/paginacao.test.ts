/**
 * A navegação entre páginas.
 *
 * DEFEITO QUE ISTO CORRIGE: a página não passava.
 *
 * A paginação era `justify-between` — rótulo à esquerda, setas coladas na borda
 * direita. E o canto inferior direito NÃO É LIVRE: o botão flutuante do copiloto
 * de IA mora lá (`fixed bottom-5 right-5 z-50`, 48px). Ele ficava NA FRENTE da
 * seta de avançar, e o clique ia para o copiloto.
 *
 * A correção leva as setas para junto dos números, resolvendo a colisão pela
 * raiz em vez de disputar espaço com um elemento fixo por margem ou z-index —
 * disputa que voltaria a cada tela nova que pusesse algo naquele canto.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ler = (f: string) => readFileSync(f, "utf8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const PRIMITIVO = "src/components/layout/Paginacao.tsx";

const arquivos = (function varrer(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) varrer(caminho, saida);
    else if (nome.endsWith(".tsx")) saida.push(caminho);
  }
  return saida;
})("src").filter((f) => !f.includes("/test/") && f !== PRIMITIVO);

describe("as setas ficam junto dos números", () => {
  const src = semComentarios(ler(PRIMITIVO));

  /**
   * É a asserção que importa. `justify-between` é o que jogava a seta para
   * debaixo do botão flutuante.
   */
  it("o primitivo não empurra as setas para a borda", () => {
    expect(src).not.toMatch(/justify-between/);
  });

  it("a ordem é seta, rótulo, seta", () => {
    // Sem as linhas de import. Elas citam os dois ícones ANTES do JSX, e
    // comparar posição no arquivo cru dá a ordem do import, não a da tela --
    // furo que já apareceu três vezes hoje em varredura por posição.
    const jsx = src.replace(/^import .*$/gm, "");
    const iEsq = jsx.indexOf("ChevronLeft");
    const iTexto = jsx.indexOf("Página {pagina + 1}");
    const iDir = jsx.indexOf("ChevronRight");
    expect(iEsq).toBeGreaterThan(-1);
    expect(iTexto).toBeGreaterThan(iEsq);
    expect(iDir).toBeGreaterThan(iTexto);
  });

  it("os botões dizem o que fazem para quem não vê o ícone", () => {
    expect(src).toContain('aria-label="Página anterior"');
    expect(src).toContain('aria-label="Próxima página"');
  });

  /**
   * O número muda sob os olhos. Sem largura fixa de dígito, o rótulo se alarga
   * ao passar de 9 para 10 e as setas pulam de lugar no meio do clique.
   */
  it("o número tem largura de dígito fixa", () => {
    expect(src).toContain("tabular-nums");
  });

  it("uma página só não desenha navegação", () => {
    // Dois botões desabilitados não são navegação, são ruído.
    expect(src).toMatch(/if \(totalPaginas <= 1\) return null;/);
  });
});

describe("ninguém monta paginação à mão", () => {
  /**
   * Estava duplicado em Contatos e Empresas, com o MESMO defeito nos dois — o
   * que é o argumento para existir um primitivo: a correção precisou acontecer
   * em um lugar, não em dois.
   */
  it.each(arquivos.filter((f) => semComentarios(ler(f)).includes("Página {page")))(
    "%s deveria usar o primitivo",
    (arquivo) => {
      expect(arquivo, "monta o rótulo de página à mão").toBe(PRIMITIVO);
    },
  );

  it("as duas telas que paginavam usam o primitivo", () => {
    for (const tela of ["src/pages/Contacts.tsx", "src/pages/Companies.tsx"]) {
      expect(semComentarios(ler(tela)), tela).toContain("<Paginacao");
    }
  });
});

/**
 * O CANTO INFERIOR DIREITO FICOU LIVRE.
 *
 * Havia aqui um teste guardando que o botão do copiloto continuasse `fixed
 * bottom-5 right-5 z-50` -- ele existia para a próxima pessoa entender por que
 * a paginação tinha sido empurrada para a esquerda: qualquer coisa naquele
 * canto ficava atrás dele.
 *
 * O botão saiu junto com as telas de IA, que dependiam de uma chave da Lovable
 * que este projeto não usa. Com o canto vago, o teste perdeu o objeto -- e o
 * motivo dele também: não há mais nada `fixed` ali para cobrir a paginação.
 *
 * Deixo o registro em vez de apagar em silêncio: se algum dia voltar um botão
 * flutuante naquele canto, é este parágrafo que explica o que ele vai cobrir.
 */
