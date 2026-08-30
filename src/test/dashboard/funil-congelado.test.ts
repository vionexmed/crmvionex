/**
 * O funil de um mês fechado para de mudar depois de fechado.
 *
 * `sdr_funnel` janelava por `contacts.created_at` -- quando o contato entrou --
 * mas lia `contacts.lifecycle_stage`, o estágio ATUAL. Um contato criado em
 * julho, contatado em julho e que virou cliente em setembro contava como
 * CLIENTE no funil de julho.
 *
 * Quem comparasse o relatório de julho tirado em agosto com o mesmo relatório
 * tirado em outubro veria números diferentes sem que nada tivesse acontecido em
 * julho. E não havia como reconstruir: a tabela guarda só o estágio atual.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SQL = readFileSync(
  "supabase/migrations/20260830120000_historico_de_ciclo_de_vida.sql",
  "utf8",
);

describe("a tabela de histórico", () => {
  it("guarda uma linha por transição", () => {
    expect(SQL).toContain("CREATE TABLE IF NOT EXISTS public.contact_lifecycle_events");
    expect(SQL).toMatch(/stage\s+public\.lifecycle_stage NOT NULL/);
    expect(SQL).toMatch(/changed_at timestamptz NOT NULL/);
  });

  /**
   * Quatro chaves estrangeiras neste projeto não têm `ON DELETE` e por isso
   * BLOQUEIAM a exclusão do pai. O histórico não tem valor sem o contato, então
   * acompanha a exclusão em vez de impedi-la.
   */
  it("a chave para contatos apaga junto, não bloqueia", () => {
    expect(SQL).toMatch(/contact_id uuid NOT NULL REFERENCES public\.contacts\(id\) ON DELETE CASCADE/);
  });

  /**
   * Histórico que a aplicação pode reescrever não é histórico. RLS ligada com
   * policy de leitura e NENHUMA de escrita: quem grava é o gatilho, que roda
   * como SECURITY DEFINER.
   */
  it("só o gatilho escreve", () => {
    expect(SQL).toContain("ENABLE ROW LEVEL SECURITY");
    expect(SQL).toMatch(/CREATE POLICY[\s\S]*?FOR SELECT/);
    expect(SQL).not.toMatch(/FOR INSERT|FOR UPDATE|FOR DELETE/);
  });

  it("tem índice para a pergunta que o funil faz", () => {
    // "dado um contato e um instante, qual o estágio mais avançado até lá"
    expect(SQL).toMatch(/ON public\.contact_lifecycle_events \(contact_id, changed_at DESC\)/);
  });
});

describe("o gatilho", () => {
  /**
   * `sync_contact_lifecycle` é BEFORE e ainda pode REESCREVER
   * `lifecycle_stage` -- no INSERT o `status` legado vence. Gravar o histórico
   * antes dele registraria um estágio que nunca existiu.
   */
  it("é AFTER, para não registrar estágio que o outro gatilho reescreve", () => {
    expect(SQL).toMatch(/AFTER INSERT OR UPDATE OF lifecycle_stage ON public\.contacts/);
    expect(SQL).not.toMatch(/BEFORE INSERT OR UPDATE OF lifecycle_stage/);
  });

  /**
   * Sem registrar o INSERT, um contato criado já como 'customer' -- importação
   * de planilha -- não teria linha nenhuma e sumiria do funil.
   */
  it("registra a entrada também, não só as mudanças", () => {
    expect(SQL).toMatch(/IF TG_OP = 'INSERT' THEN[\s\S]*?INSERT INTO public\.contact_lifecycle_events/);
  });

  it("não fica exposta na API", () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.registrar_transicao_de_ciclo\(\)/);
  });
});

describe("o funil lê o estágio DA DATA", () => {
  it("usa estagio_do_contato_em em vez do estágio atual", () => {
    const funil = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.sdr_funnel"));
    expect(funil).toContain("public.estagio_do_contato_em(c.id, _to)");
  });

  /**
   * Sem `_to` a janela é aberta e a foto é agora -- mesmo comportamento de
   * antes, e o certo para "todo o período". Congelar aí não faria sentido:
   * não há fim para congelar.
   */
  it("sem janela, a foto é agora", () => {
    const funil = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.sdr_funnel"));
    expect(funil).toMatch(/WHEN _to IS NULL THEN c\.lifecycle_stage/);
  });

  /**
   * O ciclo de vida pode RETROCEDER -- um cliente que vira descartado. O funil
   * conta quem CHEGOU a cada etapa, não quem está nela agora, então a função
   * devolve o mais avançado alcançado, não o último cronológico.
   */
  it("devolve o estágio mais avançado alcançado, não o último", () => {
    const f = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.estagio_do_contato_em"));
    expect(f).toMatch(/ORDER BY\s*\n\s*CASE e\.stage/);
    expect(f).toContain("WHEN 'customer' THEN 5");
    // Descartado é saída, então vale MENOS que lead na ordem de avanço.
    expect(f).toContain("WHEN 'disqualified' THEN 0");
  });

  /**
   * Quem foi descartado em setembro ainda contava no funil de julho. Filtrar
   * antes de resolver o estágio na data descartaria a pessoa retroativamente.
   */
  it("filtra descartado DEPOIS de resolver o estágio na data", () => {
    const funil = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.sdr_funnel"));
    const iBase = funil.indexOf("WITH base AS");
    const iFiltro = funil.indexOf("IS DISTINCT FROM 'disqualified'");
    const iEstagio = funil.indexOf("estagio_do_contato_em");
    expect(iEstagio).toBeGreaterThan(iBase);
    expect(iFiltro).toBeGreaterThan(iEstagio);
  });

  it("cada etapa continua sendo subconjunto da anterior", () => {
    // É o que faz um funil ser legível: as barras têm de decrescer. Etapas que
    // contassem coortes diferentes poderiam crescer no meio.
    const funil = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.sdr_funnel"));
    expect(funil).toMatch(/WHERE s IN \('contacted', 'qualified', 'opportunity', 'customer'\)/);
    expect(funil).toMatch(/WHERE s IN \('qualified', 'opportunity', 'customer'\)/);
    expect(funil).toMatch(/WHERE s = 'customer'/);
  });
});

describe("o backfill declara o que não consegue recuperar", () => {
  /**
   * A tabela guardou só o estágio atual e três marcas de tempo. O caminho
   * intermediário que não deixou marca não volta -- e isso tem de estar escrito,
   * para ninguém ler o histórico anterior à migração como completo.
   */
  it("reconstrói o que dá a partir das marcas existentes", () => {
    for (const marca of ["c.created_at", "c.qualified_at", "c.disqualified_at", "c.lifecycle_changed_at"]) {
      expect(SQL, `${marca} não usada no backfill`).toContain(marca);
    }
  });

  it("é idempotente", () => {
    // Reaplicar a migração não pode duplicar histórico.
    const inserts = SQL.match(/INSERT INTO public\.contact_lifecycle_events[\s\S]*?;/g) ?? [];
    const doBackfill = inserts.filter((i) => i.includes("FROM public.contacts c"));
    expect(doBackfill.length).toBeGreaterThanOrEqual(4);
    for (const i of doBackfill) expect(i).toContain("NOT EXISTS");
  });
});
