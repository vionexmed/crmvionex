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

  it("redireciona em vez de renderizar HTML", () => {
    // Medido na função implantada: resposta JSON mantém application/json, mas
    // text/html é rebaixado para text/plain com nosniff — proteção da plataforma
    // contra phishing no domínio compartilhado *.supabase.co. O HTML aparecia
    // como código-fonte, com os acentos quebrados.
    expect(semComentarios).toMatch(/status:\s*302/);
    expect(semComentarios).toMatch(/Location/);
    expect(
      semComentarios,
      "text/html não renderiza em edge function do Supabase. Redirecione para o app.",
    ).not.toMatch(/text\/html/);
  });

  it("manda o motivo como código, não como frase pronta", () => {
    // A tela traduz, igual ao invalid_reason. Frase no backend fica congelada.
    for (const motivo of ["google_recusou", "sem_credencial", "troca_de_token"]) {
      expect(semComentarios).toContain(motivo);
    }
  });

  it("a tela traduz todos os códigos que o callback pode devolver", () => {
    const tela = readFileSync("src/pages/MyEmail.tsx", "utf8");

    // Os literais.
    const literais = [...semComentarios.matchAll(/falhar\([^,]+,\s*["']([a-z_]+)["']/g)]
      .map((m) => m[1]);
    expect(literais.length).toBeGreaterThan(4);

    // Mais os montados por template: `state_${motivo}`, cujos valores são os
    // membros de FalhaState.
    const doTemplate = semComentarios.includes("state_${resultadoState.motivo}")
      ? ["state_expirado", "state_assinatura", "state_formato", "state_erro"]
      : [];

    const semTraducao = [...literais, ...doTemplate].filter((c) => !tela.includes(c));
    expect(semTraducao, "código sem tradução vira aviso genérico").toEqual([]);
  });
});
