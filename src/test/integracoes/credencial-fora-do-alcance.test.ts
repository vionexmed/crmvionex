/**
 * Credencial não passa por `integration_configs`.
 *
 * Aquela tabela tem policy `FOR ALL USING (user_belongs_to_org)` — ou seja,
 * QUALQUER membro da organização lê o conteúdo dela pelo navegador. Ela serve
 * para configuração: id de conta, canal, preferência. Não para segredo.
 *
 * Já aconteceu duas vezes. O token do WhatsApp ficava lá e saiu numa migração;
 * o do Meta Ads ficava lá até agora — e ainda por cima a função de
 * sincronização nem lia dali, então o campo do formulário não fazia nada e o
 * erro que aparecia ("META_ACCESS_TOKEN not configured") não mencionava token.
 *
 * O lugar certo é `org_secrets`: RLS habilitada e NENHUMA política, alcançável
 * só por service_role, gravada por edge function que valida antes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const semComentarios = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const ABA = semComentarios(readFileSync("src/components/integrations/IntegrationsTab.tsx", "utf8"));
const SALVAR = readFileSync("supabase/functions/meta-ads-save/index.ts", "utf8");
const SYNC = readFileSync("supabase/functions/meta-ads-sync/index.ts", "utf8");

describe("o token do Meta não fica onde o navegador lê", () => {
  /** O TESTE QUE MAIS IMPORTA: o caminho antigo gravava o token direto. */
  it("a aba não grava o token em integration_configs", () => {
    const i = ABA.indexOf('if (provider === "meta")');
    const bloco = ABA.slice(i, ABA.indexOf("const existing = getConfig(provider)", i));
    expect(bloco).toContain('functions.invoke("meta-ads-save"');
    expect(bloco, "o token voltaria a ser legível por qualquer membro")
      .not.toMatch(/from\("integration_configs"\)/);
  });

  it("a função guarda em org_secrets", () => {
    expect(SALVAR).toContain('from("org_secrets")');
    expect(SALVAR).toContain('key_name: "meta_access_token"');
  });

  /** Um spread do que já existia podia devolver `access_token` para a config. */
  it("o token nunca reentra na config legível", () => {
    expect(SALVAR).toMatch(/delete \(config as Record<string, unknown>\)\.access_token/);
  });
});

describe("a validação acontece antes de gravar", () => {
  /**
   * Token expirado, revogado ou sem `ads_read` não se distingue olhando a
   * string. Sem testar contra a Graph API, o erro só apareceria na
   * sincronização — quando ninguém lembra mais o que digitou.
   */
  it("o token é testado contra a Graph API", () => {
    expect(SALVAR).toContain("graph.facebook.com");
    expect(SALVAR).toContain("me/adaccounts");
    const iTeste = SALVAR.indexOf("graph.facebook.com");
    const iGrava = SALVAR.indexOf('from("org_secrets").upsert');
    expect(iTeste, "gravar antes de validar guarda credencial quebrada")
      .toBeLessThan(iGrava);
  });

  /** Trocar a credencial de anúncio da empresa não é ação de membro comum. */
  it("exige administrador", () => {
    expect(SALVAR).toMatch(/papel\?\.role !== "owner" && papel\?\.role !== "admin"/);
  });
});

describe("o sync lê o token da organização", () => {
  /**
   * Ele lia `Deno.env.get('META_ACCESS_TOKEN')` — um secret do projeto INTEIRO.
   * Num CRM multiempresa isso é errado por construção: duas organizações têm
   * contas de anúncio diferentes e não podem dividir credencial.
   */
  it("busca em org_secrets, por org_id", () => {
    expect(SYNC).toContain("from('org_secrets')");
    expect(SYNC).toContain("'meta_access_token'");
    expect(SYNC).toMatch(/\.eq\('org_id', orgId\)/);
  });

  /** O env fica como reserva para não derrubar quem já tinha o secret. */
  it("o secret do projeto continua valendo como reserva", () => {
    expect(SYNC).toMatch(/segredo\?\.key_value \|\| Deno\.env\.get\('META_ACCESS_TOKEN'\)/);
  });
});
