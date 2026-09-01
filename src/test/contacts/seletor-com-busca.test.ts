/**
 * Escolher uma pessoa numa lista que não cabe na tela.
 *
 * Eram QUATRO `<Select>` puros — Atividades, Negócios, Lead Scoring e o
 * compositor de e-mail —, cada um despejando a lista inteira de contatos em
 * ordem de cadastro, sem busca. Com algumas dezenas de contatos já obriga a
 * rolar procurando um nome; com centenas, rolar é a única saída.
 *
 * O que este arquivo tranca é a regressão, e ela é do tipo silencioso: um
 * `<Select>` novo com contatos dentro FUNCIONA. Ele só não tem busca — e quem
 * escreveu não vai notar, porque em ambiente de teste a lista tem três nomes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const semComentarios = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const TSX = (function varrer(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) varrer(caminho, saida);
    else if (nome.endsWith(".tsx")) saida.push(caminho);
  }
  return saida;
})("src");

const SELETOR = semComentarios(readFileSync("src/components/crm/SeletorDeContato.tsx", "utf8"));

describe("o seletor de contato tem busca", () => {
  it("existe campo de busca", () => {
    expect(SELETOR).toContain("<CommandInput");
    expect(SELETOR).toMatch(/placeholder="Buscar por nome/);
  });

  /**
   * O `value` do cmdk é ao mesmo tempo o texto que a busca compara E a
   * identidade do item. Sem o e-mail, buscar por endereço não acha nada; sem o
   * id, dois homônimos viram o mesmo item e escolher um seleciona o outro.
   */
  it("a busca casa nome e e-mail, e o item é único", () => {
    expect(SELETOR).toContain("value={`${nome} ${c.email || \"\"} ${c.id}`}");
  });

  it("diz quando não achou, em vez de mostrar lista vazia", () => {
    expect(SELETOR).toContain("<CommandEmpty");
    expect(SELETOR).toContain("Nenhum contato encontrado.");
  });
});

describe("nenhuma tela monta o próprio seletor de contato", () => {
  /**
   * O padrão que sumiu: `contacts.map(...)` gerando `<SelectItem>` dentro de um
   * `<Select>`. Quatro telas faziam isso, com três aparências diferentes — e
   * uma quinta cópia seria a quarta aparência.
   *
   * A varredura é sobre `SelectItem` alimentado por uma coleção de contatos,
   * não sobre `<Select>` em geral: etapa, funil e responsável seguem sendo
   * `<Select>` de propósito, porque são listas curtas e fechadas.
   */
  it("ninguém despeja contatos num Select", () => {
    const infratores: string[] = [];
    for (const arquivo of TSX) {
      if (arquivo.endsWith("SeletorDeContato.tsx")) continue;
      const src = semComentarios(readFileSync(arquivo, "utf8"));
      // `contacts.map(` / `availableContacts.map(` … seguido de SelectItem no
      // mesmo trecho.
      for (const m of src.matchAll(/\b(\w*[Cc]ontacts|contatos)\.map\(([\s\S]{0,320}?)\)/g)) {
        if (m[2].includes("<SelectItem")) infratores.push(`${arquivo} — ${m[1]}.map`);
      }
    }
    expect(infratores, infratores.join("\n")).toEqual([]);
  });

  /** As quatro telas que tinham o problema usam o componente. */
  it.each([
    "src/pages/Activities.tsx",
    "src/pages/Deals.tsx",
    "src/pages/LeadScoring.tsx",
    "src/components/crm/EmailComposeModal.tsx",
  ])("%s usa SeletorDeContato", (arquivo) => {
    expect(semComentarios(readFileSync(arquivo, "utf8"))).toContain("<SeletorDeContato");
  });
});
