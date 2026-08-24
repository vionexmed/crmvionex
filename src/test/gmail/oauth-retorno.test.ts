/**
 * Trava contra um bug que mandava o usuário para dentro do Google.
 *
 * O callback montava a URL de retorno com o header `referer`:
 *
 *   const origin = req.headers.get("referer")?.split("/").slice(0,3).join("/")
 *   const finalReturn = `${origin}${sanitizedReturn}`
 *
 * No callback do OAuth o referer é `accounts.google.com` — foi o Google que
 * redirecionou o navegador até ali. Resultado: "/settings/integrations" virava
 * `https://accounts.google.com/settings/integrations`, e a pessoa era despejada
 * numa tela do Google em vez de voltar ao CRM.
 *
 * Pior que o incômodo: o referer também entrava na lista de hosts confiáveis do
 * sanitizeReturnTo. Como ele vem do navegador, qualquer host podia ser aceito
 * como destino — redirecionamento aberto.
 *
 * A base do retorno tem de ser APP_BASE_URL, que é configuração do servidor.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const CALLBACK = "supabase/functions/gmail-oauth-callback/index.ts";
const codigo = readFileSync(CALLBACK, "utf8");

/** Só o código, sem comentários — o motivo do bug é citado em prosa no arquivo. */
const semComentarios = codigo
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((l) => l.replace(/\/\/.*$/, ""))
  .join("\n");

describe("retorno do callback OAuth", () => {
  it("não lê o header referer", () => {
    expect(
      semComentarios,
      "O referer no callback é accounts.google.com. Use APP_BASE_URL.",
    ).not.toMatch(/headers\.get\(\s*["']referer["']\s*\)/i);
  });

  it("usa APP_BASE_URL como base do retorno", () => {
    expect(semComentarios).toMatch(/Deno\.env\.get\(\s*["']APP_BASE_URL["']\s*\)/);
  });

  it("a página do callback responde 200, não status de erro", () => {
    // Com status >= 400 a plataforma reescreve o Content-Type para text/plain;
    // somado ao nosniff, o HTML aparecia como código-fonte e com acento quebrado.
    expect(semComentarios).toMatch(/status:\s*200/);
    expect(semComentarios).not.toMatch(/status:\s*ok\s*\?\s*200\s*:\s*400/);
  });

  it("declara text/html com charset", () => {
    expect(semComentarios).toMatch(/text\/html;\s*charset=utf-8/);
  });

  it("distingue os motivos de state recusado", () => {
    // Antes os três viravam "inválido ou expirou", e quem lia não sabia se era
    // só tentar de novo ou se havia algo errado na configuração.
    for (const motivo of ["expirado", "assinatura", "formato", "erro"]) {
      expect(semComentarios).toContain(motivo);
    }
  });
});
