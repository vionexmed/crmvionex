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

/**
 * A LISTAGEM AINDA EMBUTE AS ATIVIDADES -- e hoje ninguém lê.
 *
 * O card do quadro mostrava última interação, próxima ação e todas as notas.
 * Essas três linhas saíram quando o card passou a seguir a referência, que tem
 * quatro linhas e para. O embed continua em `dealsApi.list`: tirá-lo arrasta a
 * invalidação de cache entre negócios e atividades (ver useActivities.ts), que
 * é outra mudança.
 *
 * Os testes abaixo guardam o EMBED, não mais o que o card faz com ele. Se
 * alguém for remover o embed, é aqui que a decisão está escrita.
 */
describe("a listagem embute as atividades", () => {
  it("o embed existe", () => {
    expect(api).toContain("atividades:activities!activities_deal_id_fkey");
  });

  /**
   * O filtro `.eq("notas.type","note")` saiu, e essa é a correção: ligação,
   * reunião e e-mail ficavam de fora, quando são justamente o que responde
   * "o que aconteceu com esse cliente".
   */
  it("não filtra por tipo", () => {
    expect(api).not.toMatch(/\.eq\("(notas|atividades)\.type"/);
  });

  it("traz os campos que distinguem feito de agendado", () => {
    for (const campo of ["type", "due_date", "completed_at"]) {
      expect(api).toContain(campo);
    }
  });
});

/**
 * O CARD DO QUADRO, no desenho da referência.
 *
 * Quatro linhas e para: título com caixa de seleção, subtítulo, `valor · data`,
 * divisória e quatro botões redondos.
 */
describe("o card do quadro segue a referência", () => {
  it("o valor fica na terceira linha, não no rodapé", () => {
    // Ele terminava depois das notas, então em cards de alturas diferentes o
    // número aparecia em alturas diferentes -- comparar dois negócios da mesma
    // coluna exigia procurar.
    const i = kanban.indexOf("const DealCard");
    const card = kanban.slice(i, kanban.indexOf("const StageColumn") + 1 || undefined);
    expect(card.indexOf("formatarMoeda(")).toBeGreaterThan(-1);
    expect(card.indexOf("formatarMoeda(")).toBeLessThan(card.indexOf("border-t border-border"));
  });

  /** A referência escreve o valor na mesma fonte do resto; `num` é a mono. */
  it("o valor não usa a fonte mono", () => {
    expect(kanban).not.toMatch(/className="num[^"]*"[^>]*>\s*\{formatarMoeda/);
  });

  it("são quatro botões, e o e-mail apaga sem endereço", () => {
    for (const chave of ['chave: "abrir"', 'chave: "editar"', 'chave: "email"', 'chave: "agenda"']) {
      expect(kanban).toContain(chave);
    }
    // Sem endereço não há para onde mandar; sem compositor não há como mandar.
    expect(kanban).toContain("desabilitado: !email || !onComposeEmail");
  });

  /**
   * O ENVELOPE ABRE O COMPOSITOR DO CRM, e nunca um `mailto:`.
   *
   * O `mailto:` jogava a pessoa para fora: a mensagem saía pelo cliente de
   * e-mail do sistema, sem passar pela conta conectada, sem assinatura e sem
   * virar histórico. Quem abrisse o negócio depois não veria e-mail nenhum --
   * e não veria porque, do ponto de vista do CRM, nenhum foi enviado.
   *
   * A regressão é silenciosa nos dois sentidos: o `mailto:` FUNCIONA (abre o
   * Mail e a pessoa manda), e o histórico faltando só aparece semanas depois,
   * quando alguém procura a conversa.
   */
  it("o envelope não volta a ser mailto:", () => {
    expect(kanban).not.toContain("mailto:");
    expect(kanban).toContain("aoClicar: () => onComposeEmail?.(deal)");
  });

  it("a página abre o compositor amarrado ao negócio", () => {
    const deals = semComentarios(ler("src/pages/Deals.tsx"));
    expect(deals).toContain("<EmailComposeModal");
    expect(deals).toContain("onComposeEmail={escreverEmail}");
    // Endereço, contato E negócio -- é o `defaultDealId` que faz o envio virar
    // histórico DESTE negócio, e não mensagem solta.
    expect(deals).toContain("defaultDealId={negocioParaEmail?.id}");
    expect(deals).toMatch(/defaultContactId=\{negocioParaEmail\?\.contact_id/);
    /** `memo` no card: arrow inline aqui renderizaria os 861 cards a cada movimento. */
    expect(deals).toContain("const escreverEmail = useCallback(");
  });

  /**
   * O teste que importa nesta leva. A caixa de seleção alimenta a MESMA seleção
   * da visão de lista, e a barra de ações em lote aparece nas duas -- senão
   * marcar no quadro não levaria a ação nenhuma, que é o controle morto que o
   * resto deste arquivo evita.
   */
  it("a caixa de seleção leva à ação em lote", () => {
    expect(kanban).toContain("onAlternarSelecao");
    const deals = semComentarios(ler("src/pages/Deals.tsx"));
    expect(deals).toContain("selectedDeals={selectedDeals}");
    expect(deals).toContain("onSelectionChange={setSelectedDeals}");
    // A barra existe no quadro, e não só dentro de DealsList.
    expect(deals).toMatch(/viewMode === "kanban" && selectedDeals\.size > 0/);
    expect(deals).toContain("<BarraDeSelecao");
  });

  /** Sem as duas props a caixa não aparece: não há barra para receber o clique. */
  it("sem barra, sem caixa", () => {
    expect(kanban).toContain("onAlternarSelecao={onSelectionChange ? alternarSelecao : undefined}");
  });

  it("a largura do clone acompanha a da coluna", () => {
    // Já esteve dessincronizado: o clone tinha w-[220px] fixo enquanto a coluna
    // ia a sm:w-[240px].
    expect((kanban.match(/w-\[264px\]/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((kanban.match(/w-\[288px\]/g) ?? []).length).toBeGreaterThanOrEqual(2);
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
