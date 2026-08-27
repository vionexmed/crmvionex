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

/**
 * Relacionamentos que o PostgREST conhece, extraídos dos tipos gerados.
 *
 * Guarda as DUAS pontas de cada chave: quem a declara e para onde ela aponta.
 *
 * A primeira versão guardava só o destino, e isso a fazia entender embed em uma
 * direção só. Ela reprovou o primeiro embed reverso legítimo do projeto:
 *
 *   deals  →  contact:contacts!deals_contact_id_fkey(*)
 *     a chave é DE deals PARA contacts -- destino = tabela embutida
 *
 *   deals  →  notas:activities!activities_deal_id_fkey(...)
 *     a chave é DE activities PARA deals -- destino = tabela PAI
 *
 * Nos dois casos o embed é válido; o que muda é qual ponta da chave corresponde
 * à tabela embutida. Sem as duas pontas, o teste ou recusa embed correto ou
 * aceita chave inventada.
 */
type Ponta = { declaradaEm: string; aponta: string };

function relacionamentosConhecidos(): Map<string, Ponta> {
  const tipos = readFileSync("src/integrations/supabase/types.ts", "utf8");
  const mapa = new Map<string, Ponta>();

  // Cada tabela abre com `      <nome>: {` e lista as chaves dela em
  // `Relationships`. Percorrer nessa ordem dá o dono de cada chave.
  const tabelas = [...tipos.matchAll(/^ {6}(\w+): \{$/gm)];
  for (let i = 0; i < tabelas.length; i++) {
    const nome = tabelas[i][1];
    const inicio = tabelas[i].index!;
    const fim = i + 1 < tabelas.length ? tabelas[i + 1].index! : tipos.length;
    const bloco = tipos.slice(inicio, fim);
    const re = /foreignKeyName:\s*"([^"]+)"[\s\S]{0,200}?referencedRelation:\s*"([^"]+)"/g;
    for (const m of bloco.matchAll(re)) {
      mapa.set(m[1], { declaradaEm: nome, aponta: m[2] });
    }
  }
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
      const ponta = conhecidos.get(constraint);
      expect(
        ponta,
        `${arquivo}: o embed "${apelido}:${tabela}!${constraint}" usa uma constraint que o PostgREST não conhece. Resolva o dado no cliente.`,
      ).toBeDefined();

      // Uma das duas pontas da chave tem de ser a tabela embutida: destino no
      // embed direto (deals -> contacts), origem no reverso (deals -> activities).
      const liga = ponta!.aponta === tabela || ponta!.declaradaEm === tabela;
      expect(
        liga,
        `${arquivo}: "${constraint}" liga "${ponta!.declaradaEm}" a "${ponta!.aponta}", e nenhuma das duas é "${tabela}". O embed vai falhar com PGRST200 em toda chamada.`,
      ).toBe(true);
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
