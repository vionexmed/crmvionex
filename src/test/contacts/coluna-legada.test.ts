/**
 * `contacts.status` é LEGADO, e ninguém deve mais lê-lo.
 *
 * O mapa entre as duas colunas tem PERDA. `lifecycle_stage` tem 6 valores,
 * `status` tem 4, e o gatilho `sync_contact_lifecycle` colapsa dois pares:
 *
 *     lead        -> lead        contacted   -> lead
 *     qualified   -> prospect    opportunity -> prospect
 *     customer    -> customer    disqualified-> churned
 *
 * Quem lê `status` não consegue distinguir "novo lead" de "contatado", nem
 * "qualificado" de "em negociação". Era por isso que o relatório de contatos e
 * a tela de contatos contavam coisas diferentes: quatro grupos contra seis.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Telas que liam a coluna legada e agora leem o ciclo de vida. */
const MIGRADOS = [
  "src/components/reports/ContactsReport.tsx",
  "src/components/reports/CustomReportBuilder.tsx",
  "src/components/crm/ContactsKanbanByOwner.tsx",
  "src/pages/LeadScoring.tsx",
  "src/components/crm/CSVImportModal.tsx",
];

describe("nenhuma tela de contato lê a coluna legada", () => {
  it.each(MIGRADOS)("%s", (arquivo) => {
    const src = semComentarios(readFileSync(arquivo, "utf8"));
    const suspeitas: string[] = [];
    src.split("\n").forEach((l, i) => {
      // Leitura do status DE UMA LINHA DE CONTATO. `d.status` (negócio) e
      // `a.status` (anúncio do Meta) são outras colunas e ficam.
      if (!/\b(?:c|contact|record)\.status\b/.test(l)) return;
      // `delete record.status` é o oposto de ler: é o que impede o gatilho de
      // fazer o contato nascer qualificado. Ver o bloco de CSV abaixo.
      if (l.includes("delete ")) return;
      suspeitas.push(`${i + 1}: ${l.trim()}`);
    });
    expect(suspeitas, `ainda lê contacts.status\n${suspeitas.join("\n")}`).toEqual([]);
  });

  /**
   * A única leitura de `status` que fica é a do FILTRO SALVO -- que é uma chave
   * de JSON no banco, não a coluna do contato. Ela existe para que segmento
   * criado antes desta migração continue filtrando, e o teste abaixo cobre o
   * comportamento dela.
   */
  it("a única leitura remanescente é a do filtro salvo", () => {
    const src = semComentarios(readFileSync("src/pages/LeadScoring.tsx", "utf8"));
    const linhas = src.split("\n").filter((l) => /\bf\.status\b/.test(l));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain("ESTAGIOS_DO_STATUS_LEGADO");
  });

  it("o tipo Contact dos relatórios não expõe status", () => {
    // Enquanto o campo existir no tipo, alguém volta a ler.
    const src = readFileSync("src/components/reports/types.ts", "utf8");
    const tipo = src.slice(src.indexOf("export type Contact ="));
    expect(tipo.slice(0, 300)).toContain("lifecycle_stage");
    expect(tipo.slice(0, 300)).not.toMatch(/\bstatus: string/);
  });

  it("as consultas trazem a coluna certa", () => {
    for (const arquivo of ["src/pages/Reports.tsx", "src/pages/LeadScoring.tsx"]) {
      const src = semComentarios(readFileSync(arquivo, "utf8"));
      const sel = src.slice(src.indexOf('from("contacts")'));
      expect(sel.slice(0, 400), arquivo).toContain("lifecycle_stage");
    }
  });
});

describe("a importação de CSV não grava status", () => {
  const src = readFileSync("src/components/crm/CSVImportModal.tsx", "utf8");

  /**
   * No INSERT o gatilho dá a vitória ao `status`: gravar `status = 'prospect'`
   * faz o contato nascer com `lifecycle_stage = 'qualified'` -- qualificado sem
   * ninguém ter olhado para ele, e por isso invisível na tela de Leads.
   */
  it("apaga o campo status antes de inserir", () => {
    expect(semComentarios(src)).toContain("delete record.status;");
  });

  it("grava o ciclo de vida", () => {
    expect(semComentarios(src)).toContain("record.lifecycle_stage = estagio");
  });

  it("aceita rótulo em português e valor legado", () => {
    // Quem exporta do CRM e reimporta traz o RÓTULO, não o valor do banco.
    for (const chave of ["contatado", "em negociação", "cliente", "prospect", "churned"]) {
      expect(src).toContain(`  ${chave.includes(" ") ? `"${chave}"` : chave}:`);
    }
  });

  it("prospect legado entra como qualificado, não como em negociação", () => {
    // `prospect` cobria os dois; afirmar o mais avançado seria inventar.
    expect(src).toMatch(/prospect: "qualified"/);
  });
});

describe("o filtro de segmento salvo continua filtrando", () => {
  const src = readFileSync("src/pages/LeadScoring.tsx", "utf8");

  /**
   * Segmento é gravado como JSON no banco, então a chave antiga sobrevive a
   * qualquer refactor. Renomear `status` para `lifecycleStage` sem ler as duas
   * faria todo segmento já salvo parar de filtrar EM SILÊNCIO -- sem erro de
   * tipo, sem erro em tela, só um segmento que de repente inclui todo mundo.
   */
  it("lê a chave antiga além da nova", () => {
    expect(src).toContain("f.lifecycleStage");
    expect(src).toContain("f.status");
  });

  it("o status legado abre nos DOIS estágios que ele cobria", () => {
    // `status='lead'` valia para quem está em `lead` OU em `contacted`.
    // Devolver só um dos dois encolheria o segmento sem avisar.
    expect(src).toMatch(/lead: \["lead", "contacted"\]/);
    expect(src).toMatch(/prospect: \["qualified", "opportunity"\]/);
  });

  it("grava com a chave nova", () => {
    expect(src).toMatch(/lifecycleStage: segFilters\.estagio/);
  });
});
