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

describe("a última interação aparece no card", () => {
  it("a listagem embute as atividades", () => {
    expect(api).toContain("atividades:activities!activities_deal_id_fkey");
  });

  /**
   * O filtro `.eq("notas.type","note")` saiu, e essa é a correção: ligação,
   * reunião e e-mail ficavam de fora do card, quando são justamente o que
   * responde "o que aconteceu com esse cliente".
   */
  it("não filtra mais por tipo", () => {
    expect(api).not.toMatch(/\.eq\("(notas|atividades)\.type"/);
  });

  it("traz os campos que as duas linhas precisam", () => {
    for (const campo of ["type", "due_date", "completed_at"]) {
      expect(api).toContain(campo);
    }
  });

  /**
   * O teste que mais importa. Sem `completed_at`, o card diria "ligação há 2
   * dias" para uma ligação que ninguém fez -- e discordaria de "Abordagens
   * realizadas" no painel sobre o mesmo evento.
   */
  it("só atividade concluída conta como interação", () => {
    expect(kanban).toMatch(/filter\(\(a\) => a\.completed_at\)/);
  });

  it("ordena pela hora em que aconteceu", () => {
    expect(kanban).toContain("aconteceuEm(b) - aconteceuEm(a)");
  });

  /**
   * `sort` muta. Aqui é seguro porque vem sempre depois de `filter`, que devolve
   * array novo -- ordenar `deal.atividades` direto mutaria o cache do
   * react-query.
   */
  it("nunca ordena o array do cache direto", () => {
    expect(kanban).not.toMatch(/deal\.atividades\s*\.sort|atividades\.sort\(/);
  });

  it("cai no título quando a atividade não tem corpo", () => {
    expect(kanban).toMatch(/a\.body\?\.trim\(\) \|\| a\.title\?\.trim\(\)/);
  });

  it("card sem atividade não mostra caixa vazia", () => {
    expect(kanban).toContain("{ultimaInteracao && (");
  });
});

describe("a próxima ação aparece quando existe", () => {
  it("exige pendente E com prazo", () => {
    // Sem prazo não há o que cobrar, e a linha viraria permanente sem informar
    // urgência nenhuma.
    expect(kanban).toMatch(/filter\(\(a\) => !a\.completed_at && a\.due_date\)/);
  });

  it("pega o prazo mais próximo", () => {
    expect(kanban).toMatch(/new Date\(a\.due_date!\)\.getTime\(\) - new Date\(b\.due_date!\)\.getTime\(\)/);
  });

  /** Vencer hoje não está atrasado. Mesmo critério do chip de close_date. */
  it("compara atraso por dia, não por instante", () => {
    expect(kanban).toContain("inicioDeHoje.setHours(0, 0, 0, 0)");
    expect(kanban).toMatch(/new Date\(proximaAcao\.due_date\) < inicioDeHoje/);
  });

  it("só aparece quando existe", () => {
    expect(kanban).toContain("{proximaAcao && (");
  });
});

describe("registrar atividade grava quando aconteceu", () => {
  /**
   * Era o defeito de baixo, e o mais sério: o formulário de registro não tem
   * campo de prazo -- é um log do que aconteceu -- e não gravava completed_at.
   * Resultado: a ligação registrada não contava em "Abordagens realizadas", e a
   * tela de Atividades a mostrava pendente para sempre.
   */
  const telas = [
    ["DealDetail", tela],
    ["ContactDrawer", semComentarios(ler("src/components/crm/ContactDrawer.tsx"))],
  ] as const;

  it.each(telas)("%s grava completed_at", (_nome, src) => {
    expect(src).toMatch(/completed_at: ATIVIDADE_JA_ACONTECEU\.includes\(activityForm\.type\)/);
  });

  it("tarefa fica pendente: é o que falta fazer", () => {
    const tipos = ler("src/lib/atividade-tipos.ts");
    expect(tipos).toMatch(/ATIVIDADE_JA_ACONTECEU[^=]*=\s*\["note", "call", "email", "meeting"\]/);
    expect(tipos).not.toMatch(/ATIVIDADE_JA_ACONTECEU[^;]*"task"/);
  });
});

describe("mexer em atividade atualiza o card", () => {
  /**
   * A listagem de negócios embute as atividades. Invalidando só ["activities"],
   * criar uma nota não atualizava o card -- e a pessoa achava que o registro não
   * tinha funcionado.
   */
  it("invalidar atividade invalida negócios também", () => {
    const hook = semComentarios(ler("src/hooks/queries/useActivities.ts"));
    expect(hook).toContain("invalidarAtividadeENegocios");
    expect(hook).toMatch(/queryKey: \["deals"\]/);
  });
});

describe("o mapa de tipos de atividade tem um dono só", () => {
  /**
   * Estava em seis cópias, com divergências reais: `meeting` usava CalendarDays
   * em duas telas e Calendar em outras duas, e o rótulo era "Email" aqui e
   * "E-mail" em dashboard/canais.ts.
   */
  const consumidores = [
    "src/pages/DealDetail.tsx",
    "src/components/crm/ContactDrawer.tsx",
  ];

  it.each(consumidores)("%s importa do módulo compartilhado", (arq) => {
    expect(ler(arq)).toContain('from "@/lib/atividade-tipos"');
  });

  it.each(consumidores)("%s não declara o próprio mapa", (arq) => {
    const src = semComentarios(ler(arq));
    expect(src).not.toMatch(/call: Phone, email: Mail/);
  });
});

describe("o card mostra TODAS as notas", () => {
  /**
   * Mostrava só a interação mais recente, então o segundo registro do mesmo
   * negócio ficava invisível: você anotava e o card não mudava, o que faz
   * parecer que o registro não funcionou.
   */
  it("lista as notas, não só a última", () => {
    expect(kanban).toMatch(/const notas = concluidas\.filter\(\(a\) => a\.type === "note"\)/);
    expect(kanban).toContain("{notas.map((n) => (");
  });

  it("não impõe teto", () => {
    // O pedido foi explicitamente que o card cresça com elas. O limite prático
    // é a coluna rolar, o que já acontece.
    const bloco = kanban.slice(kanban.indexOf("const notas ="), kanban.indexOf("const ultimaInteracao"));
    expect(bloco).not.toMatch(/\.slice\(0,\s*\d/);
  });

  /**
   * Ligação e reunião costumam ter título genérico ("Ligação"). Empilhar cinco
   * linhas dizendo "Ligação" não informaria nada -- por isso só nota vira lista,
   * e a última interação não-nota aparece separada.
   */
  it("a última interação não repete o que a lista já mostrou", () => {
    expect(kanban).toMatch(/concluidas\.find\(\(a\) => a\.type !== "note"\)/);
  });

  it("usa o formatador nativo, não o date-fns", () => {
    // "há menos de um minuto" tem 21 caracteres e foi o que quebrou o layout.
    expect(kanban).toContain("formatarTempoRelativo(");
    expect(kanban).not.toContain("formatDistanceToNow");
  });

  it("a largura do clone acompanha a da coluna", () => {
    // Já esteve dessincronizado: o clone tinha w-[220px] fixo enquanto a coluna
    // ia a sm:w-[240px].
    expect((kanban.match(/w-\[264px\]/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((kanban.match(/w-\[288px\]/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
