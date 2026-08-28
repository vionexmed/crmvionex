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
import { readFileSync } from "node:fs";

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
