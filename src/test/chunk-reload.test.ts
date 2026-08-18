/**
 * Trava contra um bug que chegou à produção.
 *
 * O lazyChunk recarrega a página quando um chunk some — o que acontece a cada
 * deploy, porque o nome do arquivo carrega hash do conteúdo e a aba aberta
 * pede a versão anterior. Uma trava em sessionStorage impede laço de recarga.
 *
 * Só que a trava era GRAVADA e nunca APAGADA. Resultado: a recuperação
 * funcionava uma vez por sessão do navegador e nunca mais — do segundo deploy
 * em diante, a pessoa via "Algo deu errado" com
 * "'text/html' is not a valid JavaScript MIME type".
 *
 * Testar o comportamento exigiria simular import() dinâmico falhando e um
 * window.location.reload — caro e frágil. A garantia que importa é mais
 * simples: se existe setItem da trava, tem de existir removeItem.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.tsx", "utf8");

describe("recuperação de chunk após deploy", () => {
  it("grava a trava de recarga", () => {
    expect(app).toMatch(/sessionStorage\.setItem\(\s*TRAVA_RECARGA/);
  });

  it("LIBERA a trava — sem isto a recuperação vale uma vez só", () => {
    expect(app).toMatch(/sessionStorage\.removeItem\(\s*TRAVA_RECARGA/);
  });

  it("libera no caminho de sucesso, não só no de erro", () => {
    // A liberação tem de acontecer quando um chunk CARREGA. Num .catch ela
    // seria inútil: o erro é justamente o caso em que a trava deve ficar.
    expect(app).toMatch(/\.then\(\(mod\) => \{\s*liberaRecarga\(\);/);
  });

  it("reconhece o erro de MIME que o rewrite do vercel.json produz", () => {
    // O rewrite manda tudo para index.html, então chunk ausente volta 200 com
    // HTML em vez de 404 — a mensagem é sobre MIME type, não sobre 404.
    expect(app).toContain('msg.includes("MIME")');
  });
});
