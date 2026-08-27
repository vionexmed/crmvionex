/**
 * O negócio se chama pelo nome da pessoa, sem "Lead:" na frente.
 *
 * O prefixo estava escrito à mão em TRÊS lugares -- o gatilho de entrada, a RPC
 * de qualificação e a edge function de captação -- e é por isso que ele
 * sobreviveu: mudar um não muda os outros. A regra passou a morar numa função
 * só, `titulo_de_negocio`.
 *
 * A primeira tentativa foi esconder o título repetido na TELA, consertando a
 * aparência e deixando o dado errado. Não bastava: o prefixo vaza para fora do
 * card -- assunto de e-mail, exportação de relatório, busca. Procurar "Rodrigo"
 * numa lista onde todo título começa com "Lead: " é pior, não melhor.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const MIG = "supabase/migrations/20260827120000_negocio_sem_prefixo.sql";
const sql = readFileSync(MIG, "utf8");

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "").replace(/\/\/.*$/gm, "");

const codigoSql = semComentarios(sql);

describe("a regra do título mora num lugar só", () => {
  it("existe titulo_de_negocio", () => {
    expect(codigoSql).toContain("FUNCTION public.titulo_de_negocio");
  });

  it("os dois caminhos do banco a usam", () => {
    // O gatilho de entrada e o INSERT de fallback da qualificação.
    const usos = codigoSql.match(/public\.titulo_de_negocio\(/g) ?? [];
    expect(usos.length).toBeGreaterThanOrEqual(4); // 2 inserts + 2 no UPDATE
  });

  it("nenhum INSERT monta o título à mão", () => {
    // O `'Lead: '` ainda aparece na migração, e deve: é o UPDATE comparando com
    // o título ANTIGO para saber o que renomear. O que não pode é um INSERT
    // continuar gerando o prefixo.
    const inserts = codigoSql.match(/INSERT INTO[\s\S]*?RETURNING/g) ?? [];
    expect(inserts.length).toBeGreaterThanOrEqual(2);
    for (const ins of inserts) expect(ins).not.toContain("'Lead: '");
  });

  /**
   * first_name é NOT NULL, mas um nome só com espaços passa pelo NOT NULL. Sem
   * o coalesce o negócio nasceria sem título.
   */
  it("cobre nome vazio sem deixar o título em branco", () => {
    expect(codigoSql).toContain("nullif(trim(concat_ws(' ', c.first_name, c.last_name)), '')");
    expect(codigoSql).toContain("'Sem nome'");
  });
});

describe("a renomeação não toca em título escrito por gente", () => {
  /**
   * Casamento EXATO, não por prefixo. Um negócio renomeado à mão para
   * "Lead: fulano da clínica X" carrega informação que o nome do contato não
   * tem; cortar por LIKE 'Lead: %' apagaria isso.
   */
  it("compara o título inteiro, não o começo", () => {
    expect(codigoSql).toContain("d.title = 'Lead: ' || public.titulo_de_negocio(d.contact_id)");
    expect(codigoSql).not.toMatch(/LIKE\s+'Lead/i);
    expect(codigoSql).not.toMatch(/substring|regexp_replace|ltrim/i);
  });

  it("só renomeia negócio com contato vinculado", () => {
    // Sem contato não há nome para derivar; o título é a única identificação.
    expect(codigoSql).toContain("d.contact_id IS NOT NULL");
  });
});

describe("as funções mantêm o que já funcionava", () => {
  // A migração reescreve criar_negocio_de_entrada e qualify_lead inteiras para
  // trocar o título. Reescrever função é onde se perde uma linha sem notar.
  it("o gatilho de entrada continua idempotente", () => {
    expect(codigoSql).toMatch(/IF EXISTS \(SELECT 1 FROM public\.deals WHERE contact_id = _contact_id\)/);
  });

  it("organização sem funil não quebra o cadastro do contato", () => {
    expect(codigoSql).toContain("IF v_pipeline IS NULL THEN RETURN NULL; END IF;");
    expect(codigoSql).toContain("IF v_stage_id IS NULL THEN RETURN NULL; END IF;");
  });

  it("qualificar continua MOVENDO o negócio existente", () => {
    expect(codigoSql).toMatch(/UPDATE deals SET stage_id = coalesce\(v_proxima, v_entrada\)/);
  });

  it("qualificar continua avançando o ciclo de vida do contato", () => {
    expect(codigoSql).toContain("lifecycle_stage = 'opportunity'");
    expect(codigoSql).toContain("qualified_at    = coalesce(qualified_at, now())");
  });

  it("as funções que contornam a RLS não ficam expostas na API", () => {
    expect(codigoSql).toContain("REVOKE ALL ON FUNCTION public.titulo_de_negocio");
    expect(codigoSql).toContain("REVOKE ALL ON FUNCTION public.criar_negocio_de_entrada");
  });

  it("o dono é gravado, senão a RLS esconde o negócio de quem cadastrou", () => {
    expect(codigoSql).toContain("v_owner_id");
  });
});

describe("o card não mostra o nome duas vezes", () => {
  const kanban = semComentarios(readFileSync("src/components/crm/DealsKanban.tsx", "utf8"));

  /**
   * Sem prefixo, título e subtítulo ficam IDÊNTICOS -- o "Lead:" mascarava a
   * repetição em vez de evitá-la. O nome sai do subtítulo quando o título já é
   * ele; a empresa continua aparecendo.
   */
  it("o nome sai do subtítulo quando o título já é ele", () => {
    expect(kanban).toContain("nome !== deal.title");
  });
});

describe("a captação de lead segue a mesma convenção", () => {
  const fn = semComentarios(readFileSync("supabase/functions/lead-capture/index.ts", "utf8"));

  it("não recoloca o prefixo", () => {
    expect(fn).not.toMatch(/`Lead: \$\{/);
    expect(fn).toContain("deal_name || fullName");
  });
});
