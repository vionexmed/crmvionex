/**
 * Todo contato entra no funil, e o número de oportunidades continua honesto.
 *
 * A primeira coluna do quadro chamava "Lead" e ficava permanentemente vazia,
 * porque os leads moravam numa página separada -- o mesmo conceito em dois
 * lugares. Agora todo contato nasce com um negócio na etapa de entrada, e dá
 * para acompanhar o processo de qualquer pessoa desde o cadastro.
 *
 * Isso quebraria "Oportunidades geradas", que é `count(*) FROM deals`: importar
 * 500 pessoas anunciaria 500 oportunidades sem ninguém ter avaliado nenhuma --
 * o mesmo defeito que "Abordagens realizadas" tinha. Por isso oportunidade
 * passou a ser negócio que SAIU da etapa de entrada.
 *
 * Estes testes travam as duas metades: ninguém entra fora do funil, e estar no
 * funil não conta como oportunidade.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const FUNIL = "supabase/migrations/20260826170000_contato_entra_no_funil.sql";
const METRICAS = "supabase/migrations/20260826140000_abordagem_realizada.sql";
const LISTA = "supabase/migrations/20260826120000_rastrear_abordagens.sql";

const sql = readFileSync(FUNIL, "utf8");

describe("o negócio de entrada nasce com o contato", () => {
  /**
   * No banco, não nas telas. São seis caminhos de criação de contato -- modal,
   * CSV, wizard, webhook do WhatsApp, API pública e lead-capture -- e cobrir
   * cinco deixaria o sexto criando gente invisível no funil, que é exatamente o
   * defeito sendo consertado.
   */
  it("é um gatilho no banco, não código de tela", () => {
    expect(sql).toMatch(/AFTER INSERT ON public\.contacts/);
    expect(sql).toContain("criar_negocio_de_entrada");
  });

  it("é idempotente: contato com negócio não ganha outro", () => {
    // Nada no banco impede N negócios por contato, então a guarda é aqui.
    expect(sql).toMatch(/IF EXISTS \(SELECT 1 FROM public\.deals WHERE contact_id = _contact_id\)/);
  });

  /**
   * Levantar exceção faria o INSERT do CONTATO falhar. Perder o cadastro porque
   * a organização ainda não configurou funil seria muito pior do que ficar sem
   * o card.
   */
  it("organização sem funil não impede o cadastro do contato", () => {
    expect(sql).toContain("IF v_pipeline IS NULL THEN RETURN NULL; END IF;");
    expect(sql).toContain("IF v_stage_id IS NULL THEN RETURN NULL; END IF;");
  });

  it("grava o dono, senão a RLS esconde o negócio de quem cadastrou", () => {
    expect(sql).toMatch(/owner_id\)\s*\n\s*VALUES/);
    expect(sql).toContain("v_owner_id");
  });

  it("existe backfill para quem já estava cadastrado", () => {
    expect(sql).toMatch(/FOR r IN SELECT id FROM public\.contacts c/);
  });
});

describe("a etapa de entrada é identificada por ordem, não por nome", () => {
  /**
   * O usuário já avisou que vai renomear "Lead". Um número de painel não pode
   * depender de um rótulo editável numa tela de configuração.
   */
  it("etapa_de_entrada ordena por order", () => {
    expect(sql).toMatch(/etapa_de_entrada[\s\S]{0,400}ORDER BY "order" ASC/);
  });

  it("nenhuma função procura a etapa pelo nome 'Lead'", () => {
    expect(sql).not.toMatch(/name\s*=\s*'Lead'/i);
    expect(readFileSync(METRICAS, "utf8")).not.toMatch(/name\s*=\s*'Lead'/i);
  });
});

describe("estar no funil não conta como oportunidade", () => {
  const metricas = readFileSync(METRICAS, "utf8");
  const lista = readFileSync(LISTA, "utf8");

  it.each([
    ["sdr_metrics", metricas],
    ["sdr_metric_leads", lista],
  ])("%s exclui a etapa de entrada", (_nome, texto) => {
    expect(texto).toContain("public.etapa_de_entrada(");
    expect(texto).toContain("d.stage_id IS NULL");
  });

  /**
   * Card e lista têm de contar a mesma coisa. Divergir aqui reintroduz o
   * problema que o drill-down existe para resolver: um número que a lista não
   * consegue explicar.
   */
  it("card e lista usam o mesmo recorte", () => {
    const recorte = "d.stage_id <> public.etapa_de_entrada(";
    expect(metricas).toContain(recorte);
    expect(lista).toContain(recorte);
  });
});

describe("qualificar move o negócio, não cria um segundo", () => {
  it("qualify_lead atualiza a etapa em vez de sempre inserir", () => {
    expect(sql).toMatch(/UPDATE deals SET stage_id = coalesce\(v_proxima, v_entrada\)/);
  });

  it("move para a etapa SEGUINTE à de entrada", () => {
    // Qualificar não pode deixar o card onde já estava: seria um botão que não
    // faz nada visível.
    expect(sql).toMatch(/"order" > \(SELECT "order" FROM pipeline_stages WHERE id = v_entrada\)/);
  });

  it("funil de uma etapa só não quebra", () => {
    // coalesce(v_proxima, v_entrada): sem próxima etapa, fica onde está e o que
    // muda é o ciclo de vida do contato.
    expect(sql).toContain("coalesce(v_proxima, v_entrada)");
  });
});

describe("lead-capture não duplica o negócio do gatilho", () => {
  const fn = readFileSync("supabase/functions/lead-capture/index.ts", "utf8");

  it("ajusta o negócio existente em vez de inserir outro", () => {
    const bloco = fn.slice(fn.indexOf("if (firstStage)"), fn.indexOf("contact.created"));
    expect(bloco).toContain('.from("deals")');
    expect(bloco).toContain(".update(");
    expect(bloco).not.toContain(".insert(");
  });
});

