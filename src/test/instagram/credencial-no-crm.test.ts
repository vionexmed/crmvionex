/**
 * A credencial do app cadastrada PELA TELA, sem o segredo voltar ao navegador.
 *
 * Espelha `src/test/gmail/credencial-unica.test.ts`, e o motivo de existir é o
 * mesmo: eu havia mandado configurar variável de ambiente no painel do Supabase,
 * quando o projeto já tinha resolvido isso melhor para o Google. Estes testes
 * travam as três propriedades que fazem o padrão funcionar.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)--.*$/gm, "").replace(/\/\/.*$/gm, "");

const ler = (p: string) => semComentarios(readFileSync(p, "utf8"));

const MIGRACAO = (() => {
  const dir = "supabase/migrations";
  const f = readdirSync(dir).find((n) => n.includes("credencial_instagram_no_crm"));
  return f ? ler(join(dir, f)) : "";
})();
const RESOLVEDOR = ler("supabase/functions/_shared/instagram/credencial.ts");
const SALVAR = ler("supabase/functions/instagram-credentials-save/index.ts");
const CARTAO = ler("src/components/crm/InstagramCard.tsx");

describe("a migração existe e fecha a tabela", () => {
  it("a migração está lá", () => {
    expect(MIGRACAO).not.toBe("");
  });

  /**
   * O sufixo `_secrets` não é decorativo: o teste `segredos-fora-do-navegador`
   * DESCOBRE as tabelas por esse padrão e cobra RLS sem policy de leitura.
   * Nomear diferente sairia da varredura em silêncio.
   */
  it("o nome termina em _secrets, para entrar na varredura de segurança", () => {
    expect(MIGRACAO).toContain("public.instagram_app_secrets");
  });

  it("RLS ligada e nenhuma policy", () => {
    expect(MIGRACAO).toMatch(/ALTER TABLE public\.instagram_app_secrets\s+ENABLE ROW LEVEL SECURITY/);
    expect(MIGRACAO).not.toMatch(/CREATE POLICY[^;]*instagram_app_secrets/);
  });

  /**
   * A função de estado é SECURITY DEFINER, então atravessa a RLS. Sem a checagem
   * de admin no corpo ela viraria o vazamento que a tabela evita.
   */
  it("a função de estado confere admin e não devolve o segredo", () => {
    const i = MIGRACAO.indexOf("FUNCTION public.instagram_credencial_estado");
    expect(i).toBeGreaterThan(-1);
    const corpo = MIGRACAO.slice(i, MIGRACAO.indexOf("$$;", i));
    expect(corpo).toContain("SECURITY DEFINER");
    expect(corpo).toContain("is_org_admin");
    // Devolve `app_id`, que é público. NUNCA a coluna `app_secret`.
    expect(corpo).toContain("s.app_id");
    /*
     * `\b` e não `toContain`: o NOME DA TABELA é `instagram_app_secrets`, que
     * contém a substring `app_secret` -- então `toContain` reprovava a função
     * correta por causa do seu próprio `FROM`. Com a borda de palavra, "_" conta
     * como caractere de palavra e não há borda dentro do nome da tabela, mas há
     * em `s.app_secret`, que é o que se quer proibir.
     */
    expect(corpo).not.toMatch(/\bapp_secret\b/);
  });
});

describe("a ordem de resolução é uma só", () => {
  /**
   * CRM antes do ambiente. Invertido, a credencial cadastrada pela tela seria
   * ignorada em favor de uma variável antiga -- e o sintoma é "salvei e não
   * pegou", que não aponta para nada.
   */
  it("CRM vem antes do ambiente", () => {
    const iCrm = RESOLVEDOR.indexOf('from("instagram_app_secrets")');
    const iEnv = RESOLVEDOR.indexOf('Deno.env.get("INSTAGRAM_APP_ID")');
    expect(iCrm).toBeGreaterThan(-1);
    expect(iEnv).toBeGreaterThan(iCrm);
  });

  it("exige as DUAS partes antes de aceitar a origem CRM", () => {
    // Meia credencial não conecta, e cair para o ambiente com metade de cada
    // lado produz um erro que não aponta para nada.
    expect(RESOLVEDOR).toMatch(/if \(appId && appSecret\) return \{ appId, appSecret, origem: "crm" \}/);
  });

  /**
   * As TRÊS funções que precisam da credencial usam o resolvedor. Ler
   * `Deno.env` direto em qualquer uma delas ressuscita o defeito -- e no webhook
   * o sintoma é o pior: conectar funciona, enviar funciona, e nada entra.
   */
  it.each([
    "instagram-oauth-start",
    "instagram-oauth-callback",
    "instagram-webhook",
  ])("%s usa o resolvedor, não Deno.env", (fn) => {
    const src = ler(`supabase/functions/${fn}/index.ts`);
    expect(src).toContain("resolverCredencialApp");
    expect(src, `${fn} lê INSTAGRAM_APP_* direto do ambiente`)
      .not.toMatch(/Deno\.env\.get\("INSTAGRAM_APP_/);
  });
});

describe("o segredo nunca volta para a tela", () => {
  it("a função de salvar devolve o app_id, não o segredo", () => {
    // `app_id` é público -- viaja na URL de autorização. O segredo, não.
    expect(SALVAR).toMatch(/return json\(\{ ok: true, app_id: id/);
    expect(SALVAR).not.toMatch(/app_secret: (segredo|id)\b[^,]*\}\)/);
  });

  it("só owner ou admin cadastra", () => {
    expect(SALVAR).toMatch(/papel\?\.role !== "owner" && papel\?\.role !== "admin"/);
  });

  it("o cartão não consulta a tabela de segredo", () => {
    expect(CARTAO).not.toContain('from("instagram_app_secrets")');
  });

  /**
   * Deixar o campo do segredo preenchido depois de salvar sugere que dá para
   * relê-lo, e não dá. Limpar é o que faz a tela contar a verdade.
   */
  it("o campo do segredo é limpo depois de salvar", () => {
    const i = CARTAO.indexOf("const salvarCredencial");
    expect(i).toBeGreaterThan(-1);
    expect(CARTAO.slice(i, i + 1200)).toContain('setFormSegredo("")');
  });

  it("o campo é do tipo password", () => {
    expect(CARTAO).toMatch(/id="ig-app-secret" type="password"/);
  });
});
