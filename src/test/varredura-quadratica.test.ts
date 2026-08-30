/**
 * `.find()` dentro de `.map()`, e `.sort()` em array que não é cópia.
 *
 * Os dois são baratos de escrever e caros de rodar, e nenhum dos dois aparece
 * como erro em lugar nenhum -- só como lentidão que ninguém sabe explicar.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { indexarPorId, indexarPor } from "@/lib/utils";

describe("indexarPorId", () => {
  const itens = [{ id: "a", n: 1 }, { id: "b", n: 2 }];

  it("indexa por id", () => {
    const i = indexarPorId(itens);
    expect(i.get("a")?.n).toBe(1);
    expect(i.get("b")?.n).toBe(2);
  });

  /**
   * Aceitar null é o que permite `indexarPorId(companies)` antes da consulta
   * resolver, sem cada chamador repetir `|| []`.
   */
  it("lista ausente vira índice vazio, não quebra", () => {
    expect(indexarPorId(null).size).toBe(0);
    expect(indexarPorId(undefined).size).toBe(0);
  });

  it("id que não existe devolve undefined", () => {
    // O `.find()` que estes substituem também devolvia undefined -- manter isso
    // é o que deixa `?.name || "—"` continuar funcionando nos chamadores.
    expect(indexarPorId(itens).get("z")).toBeUndefined();
  });

  it("id repetido: o último vence", () => {
    // Mesma semântica de sobrescrita do Map. `.find()` devolveria o PRIMEIRO --
    // divergência que só apareceria com dado duplicado, que não deveria existir
    // porque id é chave primária.
    expect(indexarPorId([{ id: "a", n: 1 }, { id: "a", n: 9 }]).get("a")?.n).toBe(9);
  });

  it("indexarPor aceita chave que não é id", () => {
    const i = indexarPor([{ email: "x@y.z", n: 1 }], (o) => o.email);
    expect(i.get("x@y.z")?.n).toBe(1);
  });
});

describe("as buscas onde os dois lados crescem usam índice", () => {
  /**
   * Contatos × empresas, inscrições × contatos, histórico × contatos, negócios ×
   * donos: mil de cada lado dão um milhão de comparações POR RENDER.
   *
   * As buscas em `stages` (seis etapas) e em `members` (dezenas) ficaram com
   * `.find()` de propósito: sobre lista de tamanho constante o índice não
   * paga o próprio custo, e trocar seria churn sem ganho medível.
   */
  const casos: [string, string][] = [
    ["src/components/crm/ContactsKanbanByOwner.tsx", "porEmpresa"],
    ["src/pages/EmailSequences.tsx", "porContato"],
    ["src/pages/LeadScoring.tsx", "porContato"],
    ["src/pages/Deals.tsx", "porDono"],
    ["src/pages/Automations.tsx", "porAutomacao"],
  ];

  it.each(casos)("%s constrói %s em useMemo", (arquivo, indice) => {
    const src = readFileSync(arquivo, "utf8");
    // Dentro de useMemo: construir o índice a cada render trocaria uma
    // varredura por outra.
    expect(src).toMatch(new RegExp(`const ${indice} = useMemo\\(\\(\\) => indexarPor`));
    expect(src).toContain(`${indice}.get(`);
  });
});

describe("nenhum .sort() muta array que veio de fora", () => {
  /**
   * `.sort()` ordena IN PLACE. Aplicado a um resultado de `useMemo` ou a uma
   * prop, reordena o array que outros componentes leem -- e faz isso durante o
   * render, que é exatamente o que o StrictMode do React existe para expor.
   *
   * Seguro é `.sort()` sobre array recém-criado: depois de `.filter()`,
   * `.map()`, `Array.from()` ou de um spread.
   */
  const ARQUIVOS = [
    "src/pages/Deals.tsx",
    "src/pages/Activities.tsx",
    "src/components/reports/ForecastReport.tsx",
    "src/components/crm/DealsForecast.tsx",
    "src/components/crm/DealsKanban.tsx",
    "src/components/crm/AtRiskPanel.tsx",
    "src/components/settings/PipelinesTab.tsx",
  ];

  // Arrays construídos localmente dentro da própria função: ordenar não alcança
  // ninguém de fora.
  const LOCAIS = new Set(["result", "lista"]);

  it.each(ARQUIVOS)("%s", (arquivo) => {
    const src = readFileSync(arquivo, "utf8");
    const suspeitos: string[] = [];
    src.split("\n").forEach((l, i) => {
      // `algo.sort(` ou `algo.prop.sort(` -- ou seja, sort logo depois de um
      // identificador, não depois de um `)` ou `]`.
      const m = l.match(/(?:^|[^.\w)\]])([a-z]\w*)(?:\.\w+)?\.sort\(/);
      if (m && !LOCAIS.has(m[1])) suspeitos.push(`${arquivo}:${i + 1} ${l.trim().slice(0, 70)}`);
    });
    expect(suspeitos, suspeitos.join("\n")).toEqual([]);
  });
});
