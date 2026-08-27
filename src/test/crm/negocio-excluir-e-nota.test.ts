/**
 * Excluir o negócio, e ver a última nota no card.
 *
 * As duas coisas encostam num defeito já conhecido: `activities.deal_id` foi
 * criado sem cláusula ON DELETE, então vale NO ACTION e o Postgres RECUSA apagar
 * um negócio que tenha histórico. É a mesma família da exclusão de contato, que
 * aparecia como "[object Object]" na tela.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ler = (p: string) => readFileSync(p, "utf8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const api = semComentarios(ler("src/lib/api/deals.ts"));
const tela = semComentarios(ler("src/pages/DealDetail.tsx"));
const kanban = semComentarios(ler("src/components/crm/DealsKanban.tsx"));

describe("excluir negócio conta os vínculos antes", () => {
  it("existe contagem de vínculos", () => {
    expect(api).toContain("contarVinculos:");
    expect(api).toMatch(/\.eq\("deal_id", id\)/);
  });

  /**
   * A ordem é obrigatória: as atividades vão primeiro, senão o Postgres recusa
   * o DELETE do negócio.
   */
  it("apaga as atividades antes do negócio", () => {
    const bloco = api.slice(api.indexOf("delete: async"));
    const iAtividades = bloco.indexOf('from("activities").delete()');
    const iNegocio = bloco.indexOf("TABLES.DEALS).delete()");
    expect(iAtividades).toBeGreaterThan(-1);
    expect(iNegocio).toBeGreaterThan(iAtividades);
  });

  /**
   * `comVinculos` apaga histórico. O default TEM de ser não apagar: um chamador
   * que esqueça o parâmetro não pode destruir atividades por omissão.
   */
  it("não apaga vínculos por omissão", () => {
    expect(api).toMatch(/delete: async \(id: string, comVinculos = false\)/);
  });

  it("a tela mostra o erro real, não [object Object]", () => {
    expect(tela).toContain("mensagemErro(e)");
    expect(tela).not.toContain("e instanceof Error ? e.message : String(e)");
  });

  /**
   * Confirmação só quando há o que perder. Perguntar em operação sem
   * consequência treina as pessoas a clicar sem ler.
   */
  it("sem atividade nenhuma, exclui direto", () => {
    expect(tela).toMatch(/if \(vinculos\.atividades === 0\)[\s\S]{0,120}executarExclusao\(false\)/);
  });

  it("a confirmação diz quantas atividades vão embora", () => {
    expect(tela).toContain("exclusao?.atividades");
  });

  it("depois de excluir, sai da página do negócio que não existe mais", () => {
    const bloco = tela.slice(tela.indexOf("const executarExclusao"));
    expect(bloco.slice(0, 600)).toContain('navigate("/deals")');
  });

  /**
   * Excluir também para negócio fechado: é justamente o duplicado ou o de teste
   * que se quer tirar do caminho, e esses costumam estar marcados como ganho ou
   * perdido.
   */
  it("o botão não depende de o negócio estar aberto", () => {
    const i = tela.indexOf('aria-label="Excluir negócio"');
    expect(i).toBeGreaterThan(-1);
    // O bloco de ganho/perdido é o que fica dentro do teste de status; o de
    // excluir tem de estar fora dele.
    const antes = tela.slice(0, i);
    const ultimoStatusOpen = antes.lastIndexOf('deal.status === "open"');
    const fechaFragmento = antes.lastIndexOf("</>");
    expect(fechaFragmento).toBeGreaterThan(ultimoStatusOpen);
  });
});

describe("a nota aparece no card", () => {
  it("a listagem embute as notas", () => {
    expect(api).toContain("notas:activities!activities_deal_id_fkey");
  });

  /**
   * Sem o filtro por tipo viriam ligações, reuniões e tarefas -- payload maior
   * para dado que o card não usa.
   */
  it("só notas, não toda atividade", () => {
    expect(api).toMatch(/\.eq\("notas\.type", "note"\)/);
  });

  it("o card mostra a nota mais recente", () => {
    expect(kanban).toContain("ultimaNota");
    expect(kanban).toMatch(/new Date\(b\.created_at \?\? 0\)\.getTime\(\) - new Date\(a\.created_at \?\? 0\)\.getTime\(\)/);
  });

  /**
   * `sort` muta o array. Sem a cópia, a ordem de `deal.notas` mudaria embaixo do
   * react-query -- que trata o cache como imutável.
   */
  it("ordena numa cópia, não no array do cache", () => {
    expect(kanban).toContain("[...notas].sort(");
  });

  it("cai no título quando a nota não tem corpo", () => {
    expect(kanban).toMatch(/ultimaNota\.body\?\.trim\(\) \|\| ultimaNota\.title\?\.trim\(\)/);
  });

  it("card sem nota não mostra a caixa vazia", () => {
    expect(kanban).toContain("{textoNota && (");
  });
});
