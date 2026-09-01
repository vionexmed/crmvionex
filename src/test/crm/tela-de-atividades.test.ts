/**
 * A tela de Atividades, depois de enxugar a carga visual.
 *
 * Ela tinha QUINZE pílulas em duas fileiras, montadas à mão, com dois desenhos
 * diferentes de "selecionado" — sólido em cima, tingido embaixo — para dois
 * controles que o olho lê como o mesmo tipo de coisa.
 *
 * E o pior defeito não era pílula nenhuma: com dez atividades concluídas e o
 * filtro no padrão "Para fazer", a tabela dizia "Nenhuma atividade encontrada —
 * registre uma ligação para começar o histórico" enquanto a barra logo acima
 * contava "Todas (10)". A tela se contradizendo em dois centímetros.
 *
 * Nenhuma opção foi removida: os quinze filtros continuam todos lá.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const semComentarios = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const TELA = semComentarios(readFileSync("src/pages/Activities.tsx", "utf8"));

describe("os filtros usam os primitivos, não pílula à mão", () => {
  /**
   * O comentário do próprio arquivo registrava que o grupo de pílulas já fora
   * consolidado cinco vezes e que esta cópia passou batido duas. Era a sexta —
   * e é por isso que a regra vira teste em vez de recado.
   */
  it("o tipo de atividade vem do SegmentedControl", () => {
    expect(TELA).toContain("<SegmentedControl");
    expect(TELA).toContain('rotuloGrupo="Tipo de atividade"');
  });

  it("tipo, busca e responsável ficam na mesma barra", () => {
    expect(TELA).toContain("<BarraDeFiltros");
  });

  /**
   * O desenho de pílula montada à mão que sumiu. A varredura é pela CLASSE
   * inteira e não por `bg-primary` solto: o marcador de "hoje" do calendário
   * usa a mesma cor num círculo de 20px, e ele não é pílula de filtro nem está
   * no escopo desta mudança.
   */
  it("ninguém remonta a pílula à mão", () => {
    expect(TELA).not.toMatch(/px-3 py-1\.5 text-xs font-medium rounded-md/);
  });
});

describe("o período é lido como dois eixos", () => {
  /**
   * Sete filtros respondem "o que vence quando" e dois respondem "o que já
   * aconteceu" — e os dois grupos até ORDENAM diferente. O código sempre soube;
   * faltava a tela dizer.
   */
  it("os grupos vêm de HISTORICO, não de uma segunda lista", () => {
    expect(TELA).toContain("HISTORICO.includes(k)");
    expect(TELA).toContain("[\"Histórico\", HISTORICO]");
    // A lista literal aparece UMA vez: a declaração. Uma segunda cópia
    // divergiria no dia em que alguém acrescentasse o décimo filtro.
    expect((TELA.match(/\["feitas", "todas"\]/g) ?? []).length).toBe(1);
  });

  it("os nove filtros continuam todos na tela", () => {
    for (const chave of [
      "todo", "overdue", "today", "tomorrow",
      "this_week", "next_week", "next_30_days", "feitas", "todas",
    ]) {
      expect(TELA, `${chave} sumiu de dateFilterLabels`).toContain(`${chave}:`);
    }
  });

  /**
   * A contagem era `count > 0 &&`, então sete chips apareciam sem número — e
   * não havia como saber que "Hoje" estava vazio antes de clicar.
   */
  it("a contagem aparece inclusive quando é zero", () => {
    expect(TELA).not.toMatch(/\{count > 0 && \(/);
    expect(TELA).toContain("count === 0 && \"opacity-45\"");
  });
});

describe("o estado vazio diz a causa", () => {
  /**
   * O TESTE QUE MAIS IMPORTA aqui. A mensagem era uma só para três situações,
   * e a errada é a que aparecia no caso mais comum: filtro escondendo tudo.
   */
  it("distingue vazio de verdade, busca e filtro", () => {
    expect(TELA).toContain("activities.length === 0");
    expect(TELA).toContain("if (termo)");
  });

  /** Sem citar o total, a mensagem de filtro continuaria sugerindo que não há
   *  nada — que é exatamente o erro que ela existe para corrigir. */
  it("a mensagem de filtro oferece ver todas, com o total", () => {
    expect(TELA).toContain("Ver todas ({activities.length})");
    expect(TELA).toContain('setDateFilter("todas")');
  });

  it("o texto de histórico só aparece quando não há atividade nenhuma", () => {
    const i = TELA.indexOf("activities.length === 0");
    const j = TELA.indexOf("if (termo)");
    expect(TELA.slice(i, j)).toContain("começar o histórico");
  });
});

describe("a tabela não reparte a mesma pessoa em quatro colunas", () => {
  /**
   * E-mail, telefone e organização eram três colunas com dados da MESMA pessoa
   * que a coluna ao lado já nomeia — e as quatro juntas espremiam o Assunto,
   * que é o que se lê.
   */
  it("as colunas de contato viraram uma", () => {
    for (const coluna of [
      "<TableHead>E-mail</TableHead>",
      "<TableHead>Telefone</TableHead>",
      "<TableHead>Organização</TableHead>",
    ]) {
      expect(TELA).not.toContain(coluna);
    }
    expect(TELA).toContain("Pessoa de contato");
  });

  /** `colSpan` fixo é o número que silenciosamente deixa de bater quando uma
   *  coluna some. O navegador perdoa; quem lê o código, não. */
  it("o colSpan do estado vazio bate com o cabeçalho", () => {
    const colunas = (TELA.match(/<TableHead[\s>]/g) ?? []).length;
    expect(TELA).toContain(`colSpan={${colunas}}`);
  });

  /** A lista escrevia `first_name last_name` cru: um cadastro em CAIXA ALTA
   *  aparecia gritando aqui e normalizado na tela de Contatos. */
  it("o nome sai do formatador compartilhado", () => {
    expect(TELA).toContain("nomeDoContato(contact.first_name, contact.last_name)");
    expect(TELA).toContain("formatarTelefone(contact.phone)");
  });
});
