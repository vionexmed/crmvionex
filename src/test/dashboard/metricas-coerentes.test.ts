/**
 * O painel não pode se contradizer na mesma tela.
 *
 * Em 26/08 realinhei `sdr_metrics`, `sdr_series` e `sdr_metric_leads` para
 * contarem abordagem REALIZADA, e deixei três coisas para trás: `sdr_by_owner`,
 * `sdr_funnel` e a métrica `reunioes`.
 *
 * O resultado foi pior que o problema original. Antes tudo estava uniformemente
 * errado; depois ficou inconsistente — o card "Abordagens realizadas" e o gráfico
 * logo ABAIXO dele passaram a contar coisas diferentes. Quem vê não sabe em qual
 * número acreditar.
 *
 * Estes testes existem para que a próxima mudança de critério não deixe outra
 * função para trás.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const ler = (p: string) => readFileSync(p, "utf8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "").replace(/\/\/.*$/gm, "");

const NOVA = semComentarios(
  ler("supabase/migrations/20260827140000_metricas_coerentes.sql"),
);

describe("todas as funções usam o mesmo critério de abordagem", () => {
  /**
   * O gráfico "Desempenho por pessoa" somava só `activities`, por `created_at`,
   * sem conclusão, sem e-mail e sem WhatsApp. Somava menos que o card e a
   * diferença não tinha explicação na tela.
   */
  it("sdr_by_owner exige conclusão e janela pela conclusão", () => {
    const bloco = NOVA.slice(
      NOVA.indexOf("FUNCTION public.sdr_by_owner"),
      NOVA.indexOf("FUNCTION public.sdr_funnel"),
    );
    expect(bloco).toContain("a.completed_at IS NOT NULL");
    expect(bloco).toMatch(/_from IS NULL OR a\.completed_at >= _from/);
    expect(bloco).not.toMatch(/_from IS NULL OR a\.created_at >= _from/);
  });

  it("sdr_by_owner soma os três canais, não só atividade", () => {
    const bloco = NOVA.slice(
      NOVA.indexOf("FUNCTION public.sdr_by_owner"),
      NOVA.indexOf("FUNCTION public.sdr_funnel"),
    );
    expect(bloco).toContain("FROM public.emails e");
    expect(bloco).toContain("FROM public.whatsapp_messages w");
    expect(bloco).toContain("e.status = 'sent'");
    expect(bloco).toContain("IN ('sent', 'delivered', 'read')");
  });

  /**
   * Reunião agendada para setembro contava em "Reuniões geradas" de agosto e NÃO
   * contava em "Abordagens realizadas" — dois cards vizinhos, dois critérios para
   * o mesmo evento.
   */
  it("a métrica de reuniões exige conclusão", () => {
    const bloco = NOVA.slice(NOVA.indexOf("FUNCTION public.sdr_metrics"));
    const reuniao = bloco.slice(bloco.indexOf("a.type = 'meeting'"));
    expect(reuniao.slice(0, 300)).toContain("a.completed_at IS NOT NULL");
    expect(reuniao.slice(0, 300)).not.toMatch(/a\.created_at >= _from/);
  });
});

/**
 * Venda ganha: o card e o gráfico logo abaixo dele contavam diferente.
 *
 * `sdr_metrics.vendas_sdr` sempre exigiu `contact_id IS NOT NULL` — a métrica é
 * venda ORIGINADA pelo SDR, e sem contato vinculado não há a quem atribuir. A
 * CTE `ganhos` de `sdr_by_owner` filtrava só `status = 'won'`, então um negócio
 * ganho criado direto no quadro, sem contato, entrava no gráfico e não entrava
 * no card. Dois totais vizinhos para o mesmo mês, sem nada explicando.
 *
 * Os testes acima travam o critério de ABORDAGEM. Este trava o ramo de `deals`,
 * que passou despercebido, e lê a definição VIGENTE de cada função — não a
 * migração em que ela nasceu — porque é a última que manda no banco.
 */
describe("venda ganha tem o mesmo critério no card e no gráfico", () => {
  const CORRECAO = "20260927120200_criterio_vendas_sdr.sql";
  const DIR = "supabase/migrations";
  const ARQUIVOS = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

  /**
   * O corpo da função como a ÚLTIMA migração que a declara deixou — é essa que
   * manda no banco depois de aplicar tudo. Apontar para um arquivo fixo faria o
   * teste passar a conferir uma definição que já foi substituída.
   */
  const vigente = (fn: string) => {
    const marca = `FUNCTION public.${fn}(`;
    const arquivo = [...ARQUIVOS].reverse().find((f) => ler(`${DIR}/${f}`).includes(marca));
    if (!arquivo) throw new Error(`nenhuma migração declara ${fn}`);
    const sql = semComentarios(ler(`${DIR}/${arquivo}`));
    const i = sql.indexOf(marca);
    const resto = sql.slice(i + marca.length);
    const prox = resto.indexOf("FUNCTION public.");
    return prox < 0 ? sql.slice(i) : sql.slice(i, i + marca.length + prox);
  };

  const BY_OWNER = vigente("sdr_by_owner");
  const METRICS = vigente("sdr_metrics");

  /** O ramo de venda de cada função, isolado pelo filtro de ganho. */
  const ramoDeVenda = (bloco: string) => {
    const i = bloco.indexOf("d.status = 'won'");
    if (i < 0) throw new Error("ramo de venda não encontrado");
    return bloco.slice(i, i + 200);
  };

  it("sdr_by_owner exige contato vinculado, como sdr_metrics", () => {
    expect(ramoDeVenda(BY_OWNER)).toContain("d.contact_id IS NOT NULL");
  });

  it("sdr_metrics continua exigindo contato vinculado", () => {
    expect(ramoDeVenda(METRICS)).toContain("d.contact_id IS NOT NULL");
  });

  /** Janela pelo fechamento nas duas: por `created_at` um mês fechado mudaria. */
  it("as duas janelam por close_date", () => {
    for (const bloco of [BY_OWNER, METRICS]) {
      expect(ramoDeVenda(bloco)).toMatch(/_from IS NULL OR d\.close_date >= _from/);
      expect(ramoDeVenda(bloco)).not.toMatch(/_from IS NULL OR d\.created_at >= _from/);
    }
  });

  /**
   * O alinhamento só vale enquanto ninguém redeclarar uma função do painel de
   * volta ao critério antigo. As migrações ANTERIORES à correção ficam de fora
   * de propósito: elas guardam o estado da época, e reescrever história não é
   * uma opção.
   */
  it("nenhuma migração posterior reintroduz venda sem contato", () => {
    const posteriores = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql") && f > CORRECAO);

    for (const arquivo of posteriores) {
      const sql = semComentarios(ler(`supabase/migrations/${arquivo}`));
      const ganhos = (sql.match(/d\.status = 'won'/g) ?? []).length;
      const comContato = (sql.match(/d\.status = 'won' AND d\.contact_id IS NOT NULL/g) ?? []).length;
      expect(comContato, `${arquivo}: filtro de venda sem contact_id`).toBe(ganhos);
    }
  });

  /** `CREATE OR REPLACE` não troca o tipo de retorno — e aqui ele não muda. */
  it("a migração corrige sem DROP e mantém a assinatura", () => {
    const sql = ler("supabase/migrations/20260927120200_criterio_vendas_sdr.sql");
    expect(sql).not.toMatch(/^DROP FUNCTION/m);
    expect(sql).toContain(
      "RETURNS TABLE (pessoa text, leads int, abordagens int, reunioes int, vendas int)",
    );
  });
});

describe("o card de abordagens mostra toques E pessoas", () => {
  it("sdr_metrics devolve pessoas_abordadas", () => {
    expect(NOVA).toContain("pessoas_abordadas   int");
  });

  /**
   * Contatos DISTINTOS — se contasse linhas, seria o mesmo número de toques e a
   * segunda coluna não informaria nada.
   */
  it("conta contatos distintos, não linhas", () => {
    expect(NOVA).toMatch(/count\(DISTINCT alvo\)/);
  });

  it("soma os três canais", () => {
    const bloco = NOVA.slice(NOVA.indexOf("count(DISTINCT alvo)"));
    const uniao = bloco.slice(0, bloco.indexOf(") toques"));
    expect(uniao).toContain("FROM public.activities");
    expect(uniao).toContain("FROM public.emails");
    expect(uniao).toContain("FROM public.whatsapp_messages");
    expect((uniao.match(/UNION ALL/g) ?? []).length).toBe(2);
  });

  /**
   * Sem contato vinculado não dá para afirmar que uma pessoa foi abordada. O
   * evento continua contando como toque; só não conta como gente.
   */
  it("ignora quem não tem contato vinculado", () => {
    const bloco = NOVA.slice(NOVA.indexOf("count(DISTINCT alvo)"));
    const uniao = bloco.slice(0, bloco.indexOf(") toques"));
    expect((uniao.match(/contact_id IS NOT NULL/g) ?? []).length).toBe(3);
  });

  it("DROP antes de CREATE, porque a coluna nova muda o tipo de retorno", () => {
    // CREATE OR REPLACE não troca RETURNS TABLE — falha em execução, não na
    // criação.
    const iDrop = NOVA.indexOf("DROP FUNCTION IF EXISTS public.sdr_metrics");
    const iCreate = NOVA.indexOf("CREATE FUNCTION public.sdr_metrics");
    expect(iDrop).toBeGreaterThan(-1);
    expect(iCreate).toBeGreaterThan(iDrop);
  });

  it("a tela consome o número novo", () => {
    const hook = semComentarios(ler("src/hooks/useSdrMetrics.ts"));
    expect(hook).toContain("pessoas_abordadas: number");
    expect(hook).toContain("pessoasAbordadas: atual?.pessoas_abordadas");

    const painel = semComentarios(ler("src/pages/Dashboard.tsx"));
    expect(painel).toMatch(/tile\.key === "abordagens"/);
  });
});

describe("registrar atividade vincula os DOIS lados", () => {
  /**
   * `DealDetail` gravava só `deal_id` e o painel — que junta por `contact_id` —
   * rotulava toda linha como "Sem lead vinculado". `ContactDrawer` fazia o
   * espelho: gravava só `contact_id`, e a atividade não aparecia no card do
   * kanban.
   */
  it("DealDetail grava o contato do negócio", () => {
    const tela = semComentarios(ler("src/pages/DealDetail.tsx"));
    expect(tela).toContain("contact_id: deal.contact_id");
  });

  it("ContactDrawer grava o negócio, quando não há ambiguidade", () => {
    const tela = semComentarios(ler("src/components/crm/ContactDrawer.tsx"));
    expect(tela).toContain("deal_id: negocioUnico");
    // Com dois negócios abertos, escolher um seria adivinhar.
    expect(tela).toMatch(/abertos\.length === 1 \? abertos\[0\]\.id : null/);
  });
});

describe("a data da abordagem não depende de por onde foi registrada", () => {
  /**
   * `Activities` tem campo de prazo; as outras duas telas não. Então a ausência
   * de prazo é o sinal de que é registro, e não agendamento — e a regra fica
   * mais precisa lá, em vez de mais frouxa.
   */
  it("Activities marca conclusão quando não há prazo", () => {
    const tela = semComentarios(ler("src/pages/Activities.tsx"));
    expect(tela).toMatch(/!isEdit && !dueDate && ATIVIDADE_JA_ACONTECEU\.includes\(type\)/);
  });

  it("editar não marca conclusão em silêncio", () => {
    // A conclusão é do checkbox: é decisão de quem clica.
    const tela = semComentarios(ler("src/pages/Activities.tsx"));
    expect(tela).toContain("!isEdit &&");
  });
});

describe("as cores de atividade sobrevivem ao tema escuro", () => {
  /**
   * Eu escrevi este mapa com paleta fixa do Tailwind, justamente no módulo criado
   * para acabar com divergência. Cor fixa não tem variante escura.
   */
  it("ATIVIDADE_COR usa só token semântico", () => {
    const tipos = semComentarios(ler("src/lib/atividade-tipos.ts"));
    const mapa = tipos.slice(tipos.indexOf("ATIVIDADE_COR"), tipos.indexOf("ATIVIDADE_TIPOS"));
    expect(mapa).not.toMatch(/text-(emerald|blue|amber|violet|red|green|slate|gray|zinc)-\d/);
    expect(mapa).toMatch(/text-(success|primary|warning|muted-foreground|foreground)/);
  });
});

describe("os textos de ajuda descrevem o que a SQL faz", () => {
  const painel = ler("src/pages/Dashboard.tsx");

  /**
   * Mudei o SQL e não mudei a explicação: o card dizia "Toda tentativa de
   * contato" enquanto a consulta contava só as realizadas.
   */
  it("abordagens não promete contar tentativa", () => {
    expect(painel).not.toContain("Toda tentativa de contato no período");
  });

  it("oportunidades não promete contar criação", () => {
    expect(painel).not.toContain("Negócios criados no período, por data de criação.");
  });

  it("reuniões fala em conclusão", () => {
    const i = painel.indexOf('label: "Reuniões geradas"');
    expect(i).toBeGreaterThan(-1);
    expect(painel.slice(i, i + 400)).toContain("concluídas");
  });
});

/**
 * Reunião não é abordagem.
 *
 * `abordagens` contava `type IN ('call', 'email', 'meeting')`. Duas
 * consequências, e a segunda é a que importa:
 *
 * 1. O MESMO evento inflava dois cartões — uma reunião realizada aparecia em
 *    "Abordagens realizadas" e em "Reuniões geradas".
 *
 * 2. Reunião é RESULTADO, não tentativa. Ninguém aborda alguém realizando uma
 *    reunião: aborda ligando ou escrevendo, e a reunião é o que se ganha com
 *    isso. Contá-la como abordagem mistura esforço com retorno, e o card deixa
 *    de responder "quantas portas eu bati".
 */
describe("reunião saiu de abordagens", () => {
  const SQL = readFileSync(
    "supabase/migrations/20260830150000_reuniao_nao_e_abordagem.sql",
    "utf8",
  );
  const semComentarios = SQL.replace(/^--.*$/gm, "");

  it("nenhuma função conta meeting como abordagem", () => {
    expect(semComentarios).not.toContain("'call', 'email', 'meeting'");
    expect(semComentarios).toContain("'call', 'email'");
  });

  /**
   * Card, gráfico e lista contam a mesma coisa em funções SEPARADAS. Mudar uma
   * só faz o painel se contradizer: clicar no número abriria uma lista com
   * outro total. Está no CLAUDE.md.
   */
  it("as quatro funções mudam juntas", () => {
    for (const fn of ["sdr_metrics", "sdr_by_owner", "sdr_series", "sdr_metric_leads"]) {
      expect(SQL, `${fn} não foi recriada`).toContain(`FUNCTION public.${fn}`);
    }
  });

  /**
   * `CREATE OR REPLACE` não troca o TIPO DE RETORNO -- e é por isso que
   * `sdr_metrics` precisou de DROP quando ganhou uma coluna. Aqui só muda o
   * filtro, então serve, e preserva as concessões que um DROP levaria junto.
   */
  it("usa CREATE OR REPLACE, sem DROP", () => {
    expect(SQL).not.toMatch(/^DROP FUNCTION/m);
    expect((SQL.match(/^CREATE OR REPLACE FUNCTION/gm) ?? [])).toHaveLength(4);
  });

  /**
   * Lá a pergunta é outra -- "houve contato com esta pessoa?" -- e uma reunião
   * realizada responde que sim. Mudar junto tiraria do funil quem foi
   * contatado só por reunião.
   */
  it("o gatilho de lead contatado NÃO muda", () => {
    // Sem comentário: o cabeçalho da migração EXPLICA por que o gatilho fica de
    // fora, e nomeia o gatilho ao fazê-lo. Sexta vez nesta base.
    expect(semComentarios).not.toContain("promover_lead_para_contatado");
  });

  it("o texto do card diz que reunião não entra", () => {
    const painelSrc = readFileSync("src/pages/Dashboard.tsx", "utf8");
    const i = painelSrc.indexOf('key: "abordagens"');
    expect(painelSrc.slice(i, i + 500)).toMatch(/REUNIÃO NÃO ENTRA/);
  });
});
