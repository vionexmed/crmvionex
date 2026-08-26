/**
 * Contatos e Leads eram mutuamente exclusivos, e a coluna legada era o motivo.
 *
 * `contacts` tem duas colunas de estágio: `status` (legado, 4 valores) e
 * `lifecycle_stage` (6 valores). Um trigger sincroniza as duas, e no INSERT o
 * `status` manda.
 *
 * A partir daí:
 *
 *  - a lista de Contatos filtrava `.neq("status","lead")`, então quem estava no
 *    funil desaparecia dela;
 *  - para os contatos importados não sumirem, os caminhos de criação passaram a
 *    gravar `status:'prospect'` -- o que fazia o trigger marcá-los como
 *    'qualified' sem ninguém ter qualificado, e aí eles nunca apareciam no
 *    funil. Aparecer numa tela custava desaparecer da outra.
 *
 * Estes testes travam as duas metades da correção: a lista não esconde ninguém,
 * e ninguém escreve a coluna legada. São leitura de arquivo porque o defeito
 * mora em strings de consulta e em literais de payload -- o TypeScript não vê
 * nenhum dos dois.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LIFECYCLE_LABELS, LEAD_STAGES } from "@/lib/contact-options";

const ler = (p: string) => readFileSync(p, "utf8");

/** Sem comentários: eles documentam o que NÃO fazer e reprovariam a checagem. */
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("Contatos é a lista de todas as pessoas", () => {
  const api = semComentarios(ler("src/lib/api/contacts.ts"));

  it("a consulta não exclui quem está no funil", () => {
    expect(api).not.toMatch(/\.neq\(\s*["']status["']/);
  });

  it("o filtro da lista é por ciclo de vida, não pela coluna legada", () => {
    expect(api).toContain('query.eq("lifecycle_stage"');
    expect(api).not.toMatch(/query\.eq\(\s*["']status["']/);
  });
});

describe("a coluna legada `status` não é mais escrita", () => {
  // Os caminhos de CRIAÇÃO e de EDIÇÃO. Faltar um só reintroduz o bug: basta
  // uma tela gravar `status` para o trigger sobrescrever o ciclo de vida.
  const arquivos = [
    "src/components/crm/ContactCreateModal.tsx",
    "src/components/crm/CSVImportModal.tsx",
    "src/components/setup/StepContacts.tsx",
    "src/components/crm/ContactDrawer.tsx",
    "src/pages/Contacts.tsx",
  ];

  it.each(arquivos)("%s não grava status: 'prospect'", (arq) => {
    expect(semComentarios(ler(arq))).not.toMatch(/status:\s*["']prospect["']/);
  });
});

describe("a gaveta do contato edita o ciclo de vida", () => {
  const gaveta = semComentarios(ler("src/components/crm/ContactDrawer.tsx"));

  it("salva lifecycle_stage, não status", () => {
    expect(gaveta).toContain("lifecycle_stage: form.lifecycle_stage");
    expect(gaveta).not.toMatch(/status:\s*form\.status/);
  });

  /**
   * O padrão do Select era "prospect": salvar um contato sem estágio definido o
   * marcava como qualificado. E escolher "Lead" num contato em negociação fazia
   * o trigger REBAIXAR o ciclo de vida, quebrando o invariante "só avança" e
   * devolvendo a negociação para a fila.
   */
  it("não inventa um padrão acima de lead", () => {
    expect(gaveta).not.toMatch(/form\.status\s*\|\|\s*["']prospect["']/);
    expect(gaveta).toMatch(/form\.lifecycle_stage\s*\?\?\s*["']lead["']/);
  });
});

describe("os seis estágios têm rótulo", () => {
  // Um estágio sem rótulo aparece como chave crua na tela, ou como vazio.
  const estagios = ["lead", "contacted", "qualified", "opportunity", "customer", "disqualified"];

  it.each(estagios)("%s", (e) => {
    expect(LIFECYCLE_LABELS[e as keyof typeof LIFECYCLE_LABELS]).toBeTruthy();
  });

  it("a fila de leads é só o começo do ciclo", () => {
    expect(LEAD_STAGES).toEqual(["lead", "contacted"]);
  });
});

describe("nenhum select de contato tem teto silencioso", () => {
  /**
   * `useContacts({pageSize: 1000})` devolve no máximo 1000 linhas e não avisa
   * quando corta. O contato simplesmente não aparece no select, sem erro. Com
   * leads entrando na lista, isso deixou de ser hipótese.
   */
  it("Atividades pagina em blocos", () => {
    const tela = semComentarios(ler("src/pages/Activities.tsx"));
    expect(tela).not.toMatch(/useContacts\(\s*\{\s*pageSize:\s*1000/);
    expect(tela).toContain("useAllContacts()");
  });
});
