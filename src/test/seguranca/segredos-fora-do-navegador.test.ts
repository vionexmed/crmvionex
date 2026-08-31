/**
 * Credencial não chega ao navegador.
 *
 * É a regra mais importante deste projeto e a que não aparece em captura de
 * tela: uma tabela de segredo com policy de leitura funciona perfeitamente --
 * a integração conecta, envia, recebe -- e ao mesmo tempo entrega a chave a
 * qualquer sessão que a policy autorize. O sintoma é zero.
 *
 * O padrão correto é RLS LIGADA E ZERO POLICY (ou uma policy `USING (false)`):
 * assim só o `service_role` lê, ou seja só edge function.
 *
 * Este teste varre as MIGRAÇÕES, não o banco. Não é a mesma coisa -- o banco é a
 * verdade -- mas é o que se pode checar em CI, e pega o caso que já aconteceu
 * aqui: uma migração posterior ACRESCENTAR uma policy de leitura numa tabela que
 * nasceu fechada, sem ninguém notar.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";

/** Migrações em ORDEM DE NOME, que é a ordem em que o Supabase as aplica. */
const migracoes = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ arquivo: f, sql: readFileSync(join(DIR, f), "utf8") }));

/**
 * COMENTÁRIO NÃO É CÓDIGO.
 *
 * Sem isto, o comentário que EXPLICA por que não se cria policy aqui seria lido
 * como um `CREATE POLICY` -- e a armadilha ficaria impossível de documentar. É a
 * regra que o CLAUDE.md registra e que todos os varredores deste projeto seguem.
 */
const semComentarios = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

const todoSql = migracoes.map((m) => semComentarios(m.sql)).join("\n");

/** Tabelas de segredo, descobertas e não escritas à mão. */
const tabelasDeSegredo = Array.from(
  new Set(
    Array.from(
      todoSql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?public\.([a-z_]*secrets)\b/g),
      (m) => m[1],
    ),
  ),
).sort();

/**
 * O QUE ESTÁ ABERTO HOJE, e é dívida, não decisão.
 *
 * `org_secrets` guarda `anthropic_api_key`, `resend_api_key` e
 * `slack_webhook_url`. Ela NASCEU fechada, em 20260316014430, com RLS e nenhuma
 * policy -- e a migração 20260527212948 acrescentou
 * `"Owners admins read org_secrets" FOR SELECT`. Desde então o navegador de
 * qualquer owner ou admin lê as três chaves.
 *
 * Dois comentários no código ainda afirmam o contrário ("RLS e nenhuma política
 * — inalcançável pelo cliente"): em `IntegrationsTab.saveConfig` e no cabeçalho
 * de `validate-slack-webhook`. Eles descrevem o estado de março.
 *
 * NENHUM código do navegador lê essa tabela -- só edge functions escrevem nela.
 * Então derrubar a policy de SELECT não quebra nada, e é o que tira este nome
 * daqui. Está nesta lista para ficar VISÍVEL, não para ficar aceito.
 */
const CONHECIDO_ABERTO = new Set(["org_secrets"]);

describe("tabela de segredo é inalcançável pelo navegador", () => {
  it("achou as tabelas de segredo", () => {
    // Se esta lista esvaziar, a regex quebrou e os testes abaixo passariam
    // vazios — o pior modo de um teste falhar.
    expect(tabelasDeSegredo.length).toBeGreaterThanOrEqual(4);
  });

  it.each(tabelasDeSegredo)("%s tem RLS ligada", (tabela) => {
    const ligada = new RegExp(
      `ALTER TABLE (?:public\\.)?${tabela}\\s+ENABLE ROW LEVEL SECURITY`,
    ).test(todoSql);
    expect(ligada, `${tabela}: falta ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).toBe(true);
  });

  it.each(tabelasDeSegredo)("%s não tem policy de leitura", (tabela) => {
    /*
     * Pega o corpo de cada CREATE POLICY até o `;`, porque é ali que mora o
     * `USING (false)` -- a policy que existe justamente para NEGAR, e que conta
     * como fechada.
     */
    const policies = Array.from(
      todoSql.matchAll(
        new RegExp(`CREATE POLICY[^;]*?ON\\s+(?:public\\.)?${tabela}\\b([^;]*);`, "g"),
      ),
      (m) => m[1],
    );

    const abertas = policies.filter((corpo) => {
      const c = corpo.replace(/\s+/g, " ").toLowerCase();
      // Policy de SELECT, ou FOR ALL (que inclui SELECT). Negação explícita não
      // conta.
      const leitura = c.includes("for select") || c.includes("for all") || !c.includes(" for ");
      const nega = /using\s*\(\s*false\s*\)/.test(c);
      return leitura && !nega;
    });

    if (CONHECIDO_ABERTO.has(tabela)) {
      // Trava a dívida no tamanho que ela tem. Se alguém abrir MAIS, quebra.
      expect(abertas.length, `${tabela}: ver CONHECIDO_ABERTO`).toBeLessThanOrEqual(2);
      return;
    }

    expect(
      abertas.length,
      `${tabela} ganhou policy de leitura:\n${abertas.join("\n---\n")}\n\n` +
        "Segredo com policy de leitura é segredo que o navegador lê. " +
        "Se a leitura é realmente necessária, exponha só o campo inócuo por " +
        "função SECURITY DEFINER — como instagram_token_vence_em faz com a data " +
        "de vencimento.",
    ).toBe(0);
  });
});

describe("o navegador não consulta tabela de segredo", () => {
  const arquivos = (function varrer(dir: string, saida: string[] = []): string[] {
    for (const nome of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, nome.name);
      if (nome.isDirectory()) varrer(caminho, saida);
      else if (/\.tsx?$/.test(nome.name)) saida.push(caminho);
    }
    return saida;
  })("src").filter((f) => !f.includes("/test/") && !f.endsWith("supabase/types.ts"));

  const codigo = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it.each(tabelasDeSegredo)("nada em src/ faz .from(\"%s\")", (tabela) => {
    const infratores = arquivos.filter((f) => codigo(f).includes(`from("${tabela}")`));
    expect(
      infratores,
      `${infratores.join("\n")}\n\nA consulta devolveria vazio (RLS sem policy) ` +
        "e a tela concluiria que a integração não está configurada — " +
        "um sintoma que parece defeito da conexão e é defeito da consulta.",
    ).toEqual([]);
  });
});

/**
 * O canal de Instagram, especificamente.
 *
 * O token de longa duração do Instagram dá acesso de LEITURA E ESCRITA às
 * mensagens da conta. Estes três testes travam as decisões que o mantêm fora do
 * alcance do navegador.
 */
describe("Instagram: o token fica no servidor", () => {
  const sql = migracoes.find((m) => m.arquivo.includes("canal_instagram"))?.sql ?? "";

  it("a migração do canal existe", () => {
    expect(sql).not.toBe("");
  });

  it("o token está em tabela separada da conexão", () => {
    /*
     * `instagram_connections` é LIDA pelo navegador (o cartão de Integrações
     * mostra o @ e o estado). Se o token morasse nela, a policy de SELECT que o
     * cartão precisa entregaria o token junto.
     */
    const limpo = semComentarios(sql);
    const i = limpo.indexOf("CREATE TABLE IF NOT EXISTS public.instagram_connections");
    const j = limpo.indexOf(");", i);
    expect(limpo.slice(i, j)).not.toMatch(/access_token/);
  });

  it("o cartão de Integrações lê o vencimento por função, não da tabela", () => {
    const cartao = readFileSync("src/components/crm/InstagramCard.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(cartao).toContain("instagram_token_vence_em");
    expect(cartao).not.toContain("instagram_secrets");
  });

  it("a função de vencimento confere pertencimento", () => {
    /*
     * Ela é SECURITY DEFINER, então atravessa a RLS. Sem a checagem de
     * organização no corpo, viraria exatamente o vazamento que a tabela evita —
     * qualquer pessoa autenticada passaria um id e leria.
     */
    const limpo = semComentarios(sql);
    const i = limpo.indexOf("FUNCTION public.instagram_token_vence_em");
    const corpo = limpo.slice(i, limpo.indexOf("$$;", i));
    expect(corpo).toContain("SECURITY DEFINER");
    expect(corpo).toContain("user_belongs_to_org");
  });
});

/**
 * A view do atendimento.
 *
 * `security_invoker = on` é o que faz a RLS das tabelas-base valer para quem
 * chama. Sem isso a view roda com os direitos de quem a criou -- o postgres --
 * e qualquer membro de qualquer organização leria as mensagens de TODAS as
 * outras. É o defeito clássico de view sobre tabela com RLS, e é silencioso:
 * a view funciona.
 */
describe("a view de atendimento respeita a RLS de quem consulta", () => {
  it("mensagens_do_atendimento é security_invoker", () => {
    const limpo = semComentarios(todoSql);
    const i = limpo.indexOf("VIEW public.mensagens_do_atendimento");
    expect(i, "a view não foi encontrada nas migrações").toBeGreaterThan(-1);
    // O `WITH (...)` vem entre o nome e o AS.
    expect(limpo.slice(i, limpo.indexOf(" AS", i)).replace(/\s+/g, " "))
      .toMatch(/security_invoker\s*=\s*on/);
  });
});
