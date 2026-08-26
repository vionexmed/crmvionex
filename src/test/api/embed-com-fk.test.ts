/**
 * Todo embed do PostgREST tem de apontar para uma chave estrangeira que existe.
 *
 * O bug que originou este teste: `dealsApi.getById` pedia
 * `owner:profiles!deals_owner_id_fkey(*)`. A constraint `deals_owner_id_fkey`
 * existe de verdade -- só que aponta para `auth.users`, não para `profiles`. O
 * PostgREST não atravessa `auth.users` (schema não exposto), então a consulta
 * falhava SEMPRE com PGRST200.
 *
 * O que tornava isso difícil de achar: o nome da constraint estava certo, o
 * TypeScript não reclamava (é string), e a única manifestação era clicar num
 * negócio e ser devolvido para a lista depois de ~7s. Nenhum erro na tela.
 *
 * `types.ts` é gerado a partir do banco e lista os relacionamentos que o
 * PostgREST realmente conhece. Conferir contra ele é a única checagem estática
 * possível para uma string que só é validada em tempo de execução.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const API_DIR = "src/lib/api";

/** Relacionamentos que o PostgREST conhece, extraídos dos tipos gerados. */
function relacionamentosConhecidos(): Map<string, string> {
  const tipos = readFileSync("src/integrations/supabase/types.ts", "utf8");
  const mapa = new Map<string, string>();
  // Os blocos vêm no formato:
  //   foreignKeyName: "deals_contact_id_fkey"
  //   ...
  //   referencedRelation: "contacts"
  const re =
    /foreignKeyName:\s*"([^"]+)"[\s\S]{0,200}?referencedRelation:\s*"([^"]+)"/g;
  for (const m of tipos.matchAll(re)) mapa.set(m[1], m[2]);
  return mapa;
}

/**
 * Remove comentários antes de varrer.
 *
 * Sem isto o teste se autossabota: `deals.ts` documenta no comentário qual embed
 * era impossível, e o scanner leria essa explicação como código a reprovar.
 * Ficaria impossível escrever "não faça X" sem quebrar a checagem de X.
 */
function semComentarios(conteudo: string) {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Embeds escritos à mão: `apelido:tabela!nome_da_constraint(...)`. */
function embedsDoArquivo(conteudo: string) {
  const re = /(\w+):(\w+)!(\w+_fkey)\(/g;
  return [...semComentarios(conteudo).matchAll(re)].map((m) => ({
    apelido: m[1],
    tabela: m[2],
    constraint: m[3],
  }));
}

const arquivos = readdirSync(API_DIR).filter((f) => f.endsWith(".ts"));

describe("embed do PostgREST aponta para FK que existe", () => {
  const conhecidos = relacionamentosConhecidos();

  it("os tipos gerados trazem relacionamentos (senão o teste não vale nada)", () => {
    expect(conhecidos.size).toBeGreaterThan(10);
  });

  it.each(arquivos)("%s", (arquivo) => {
    const embeds = embedsDoArquivo(readFileSync(join(API_DIR, arquivo), "utf8"));
    for (const { apelido, tabela, constraint } of embeds) {
      const alvo = conhecidos.get(constraint);
      expect(
        alvo,
        `${arquivo}: o embed "${apelido}:${tabela}!${constraint}" usa uma constraint que o PostgREST não conhece. Resolva o dado no cliente.`,
      ).toBeDefined();
      expect(
        alvo,
        `${arquivo}: "${constraint}" aponta para "${alvo}", não para "${tabela}". O embed vai falhar com PGRST200 em toda chamada.`,
      ).toBe(tabela);
    }
  });
});

describe("o responsável do negócio não volta a vir por embed", () => {
  const deals = readFileSync(join(API_DIR, "deals.ts"), "utf8");

  it("nenhuma consulta de deals embeda profiles", () => {
    expect(semComentarios(deals)).not.toMatch(/owner:profiles!/);
  });

  it("o motivo fica escrito no arquivo, para ninguém tentar de novo", () => {
    expect(deals).toContain("auth.users");
  });
});
