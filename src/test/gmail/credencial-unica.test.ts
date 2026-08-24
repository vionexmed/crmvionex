/**
 * Trava contra a classe de bug mais cruel deste fluxo.
 *
 * O Google exige que a RENOVAÇÃO do token use as MESMAS credenciais que o
 * EMITIRAM. Havia sete cópias da expressão de fallback
 * (`cfg.client_id || Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")`) espalhadas por
 * gmail-oauth-start, gmail-oauth-callback, gmail-send, gmail-sync,
 * gmail-attachment, _shared/gmail-sender e gmail-get-defaults.
 *
 * Sete cópias é sete chances de divergir, e o sintoma de divergir é
 * `invalid_client` horas ou dias depois — longe da causa, sem relação aparente
 * com o que foi mexido.
 *
 * A garantia que este teste faz: existe UM lugar que resolve credencial do
 * Google, e UM lugar que renova token com ela.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = "supabase/functions";
const MODULO = "supabase/functions/_shared/google-credentials.ts";

function arquivosTs(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivosTs(p, out);
    else if (nome.endsWith(".ts")) out.push(p);
  }
  return out;
}

const arquivos = arquivosTs(RAIZ);

describe("credencial do Google resolvida em um lugar só", () => {
  it("encontra as funções de borda (guarda contra caminho errado)", () => {
    expect(arquivos.length).toBeGreaterThan(10);
    expect(arquivos).toContain(MODULO);
  });

  it("só o módulo compartilhado lê GOOGLE_OAUTH_CLIENT_ID/SECRET do ambiente", () => {
    const culpados = arquivos.filter((f) => {
      if (f === MODULO) return false;
      return /Deno\.env\.get\(\s*["']GOOGLE_OAUTH_CLIENT_(ID|SECRET)["']\s*\)/.test(
        readFileSync(f, "utf8"),
      );
    });

    expect(
      culpados,
      "Use resolverCredencialGoogle de _shared/google-credentials.ts. " +
        "Ler o ambiente direto reintroduz a divergência que causa invalid_client.",
    ).toEqual([]);
  });

  it("nenhuma função de borda define o próprio refresh de token do Google", () => {
    const culpados = arquivos.filter((f) => {
      if (f === MODULO) return false;
      const txt = readFileSync(f, "utf8");
      // Assinatura das sete cópias que existiam.
      return /async function refreshAccessToken\s*\(/.test(txt);
    });

    expect(
      culpados,
      "Use renovarAccessToken de _shared/google-credentials.ts — ela resolve a " +
        "credencial e traduz o erro do Google no motivo que a tela mostra.",
    ).toEqual([]);
  });

  it("o módulo compartilhado expõe as três peças que os chamadores precisam", () => {
    const txt = readFileSync(MODULO, "utf8");
    expect(txt).toMatch(/export async function resolverCredencialGoogle/);
    expect(txt).toMatch(/export async function renovarAccessToken/);
    expect(txt).toMatch(/export async function validarCredencialGoogle/);
  });

  it("a ordem de resolução é CRM, depois legado, depois ambiente", () => {
    const txt = readFileSync(MODULO, "utf8");
    const iCrm = txt.indexOf("google_oauth_secrets");
    const iLegado = txt.indexOf("integration_configs");
    const iAmbiente = txt.indexOf('Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")');
    expect(iCrm).toBeGreaterThan(-1);
    expect(iLegado).toBeGreaterThan(iCrm);
    expect(iAmbiente).toBeGreaterThan(iLegado);
  });
});
