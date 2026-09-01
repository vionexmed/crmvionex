/**
 * Criar a pessoa pelo formulário de negócio não pode gerar DOIS negócios.
 *
 * A armadilha: o gatilho `contato_entra_no_funil` (migração 20260826170000) cria
 * um negócio A CADA contato inserido. Criar o contato e depois inserir o negócio
 * do formulário produz dois -- o do gatilho, na etapa de entrada, e o nosso. A
 * pessoa marca uma caixinha e ganha uma ficha duplicada no quadro.
 *
 * Nada em tempo de compilação pega isso: o gatilho vive no banco, e os dois
 * inserts são válidos. Só aparece olhando o quadro depois.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const DEALS = semComentarios(readFileSync("src/pages/Deals.tsx", "utf8"));

describe("o gatilho do funil continua existindo", () => {
  /**
   * Se o gatilho for removido um dia, o cuidado abaixo vira código morto -- e
   * pior, o caminho do `negocioDoGatilho` nunca acharia nada e o negócio sairia
   * pelo `createDeal`, que é o certo nesse mundo. Este teste é o aviso de que a
   * premissa mudou.
   */
  it("existe um AFTER INSERT em contacts que cria negócio", () => {
    const dir = "supabase/migrations";
    const todas = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    expect(todas).toMatch(/CREATE TRIGGER contato_entra_no_funil[\s\S]*?AFTER INSERT ON public\.contacts/);
    expect(todas).toContain("criar_negocio_de_entrada");
  });
});

describe("criar contato pelo formulário de negócio", () => {
  it("procura o negócio que o gatilho criou", () => {
    // Sem esta busca, o insert do formulário seria o SEGUNDO negócio.
    expect(DEALS).toContain("negocioDoGatilho");
    expect(DEALS).toMatch(/from\("deals"\)[\s\S]{0,200}eq\("contact_id"/);
  });

  it("atualiza o do gatilho em vez de inserir outro", () => {
    const i = DEALS.indexOf("if (negocioDoGatilho)");
    expect(i, "o caminho que aproveita o negócio do gatilho sumiu").toBeGreaterThan(-1);
    // O ramo verdadeiro atualiza; o falso é que insere.
    const ramo = DEALS.slice(i, i + 700);
    expect(ramo).toContain("updateDeal");
    expect(ramo.indexOf("updateDeal")).toBeLessThan(
      ramo.indexOf("createDeal") === -1 ? Infinity : ramo.indexOf("createDeal"),
    );
  });

  /**
   * `lifecycle_stage`, NUNCA `status`.
   *
   * O gatilho `sync_contact_lifecycle` deixa o status legado mandar no INSERT:
   * escrever `status` faria a pessoa nascer "qualificada" sem ninguém ter
   * qualificado, e por isso ela sumiria da tela de Leads. Está no CLAUDE.md.
   */
  it("o contato nasce como lead, sem tocar no status legado", () => {
    const i = DEALS.indexOf("contactsApi.create(");
    expect(i, "a criação do contato sumiu").toBeGreaterThan(-1);
    const chamada = DEALS.slice(i, i + 500);
    expect(chamada).toContain('lifecycle_stage: "lead"');
    expect(chamada, "escrever `status` faz o contato nascer qualificado")
      .not.toMatch(/\bstatus:/);
  });

  /**
   * A caixinha é OPCIONAL e CONDICIONAL: só num negócio novo, com título escrito
   * e sem contato escolhido. Permanente, seria ruído; marcada por engano num
   * negócio que já tem pessoa, criaria duplicada.
   */
  it("a caixinha só aparece quando faz sentido", () => {
    expect(DEALS).toMatch(/!editing && !form\.contact_id && !!form\.title\?\.trim\(\)/);
  });

  it("desmarca ao abrir o formulário, para não vazar entre um negócio e outro", () => {
    // Sem isto, marcar num negócio e abrir o próximo já vem marcado -- e cria
    // uma pessoa que ninguém pediu.
    const aberturas = DEALS.split("setCriarContato(false)").length - 1;
    expect(aberturas, "esperado desmarcar em openNew, abrirEdicao e ao salvar")
      .toBeGreaterThanOrEqual(3);
  });
});
