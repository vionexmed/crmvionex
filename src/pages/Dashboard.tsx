/**
 * Painel de SDR.
 *
 * Responde pela operação de prospecção: quanto lead entrou, quantas abordagens
 * saíram, quanto respondeu, e quanto disso virou reunião, oportunidade e venda.
 * As métricas medem o funil INDEPENDENTE de quem executa — hoje uma pessoa do
 * comercial, adiante o SDR de IA — para a tela não precisar ser reescrita.
 *
 * Cinco métricas não têm fonte de dado no banco hoje e aparecem marcadas como
 * "sem fonte", nunca com número aproximado. Ver SEM_FONTE em useSdrMetrics.ts.
 *
 * Os KPIs de vendas que ficavam aqui (receita, win rate, ticket, ciclo, meta,
 * negócios em risco) seguem disponíveis em Relatórios.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LucideIcon } from "lucide-react";
import {
  UserPlus, MessageCircle, Instagram, Globe, Linkedin,
  Send, CheckCheck, Reply, MessagesSquare,
  CalendarCheck, Briefcase, Trophy, Sparkles,
  Timer, Hourglass, UserCheck,
  Gauge, RefreshCw, TriangleAlert,
  LineChart, ListFilter, Bot,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { StatCard, type StatAccent, type StatFormat } from "@/components/dashboard/StatCard";
import { DashboardAIChat } from "@/components/crm/DashboardAIChat";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/contexts/AuthContext";
import {
  useSdrMetrics, sdrMetricsKeys, SDR_PERIOD_LABELS,
  type SdrPeriod, type MetricKey,
} from "@/hooks/useSdrMetrics";
import { useSdrCharts, sdrChartsKeys } from "@/hooks/useSdrCharts";
import { sdrMetricLeadsKeys, type MetricDrilldownKey } from "@/hooks/useSdrMetricLeads";
import { MetricDrilldown } from "@/components/dashboard/MetricDrilldown";
import { MetricLeadsSheet } from "@/components/dashboard/MetricLeadsSheet";
// Import ESTÁTICO: os gráficos agora são SVG puro, sem biblioteca. Não há mais
// peso a postergar, então carregar sob demanda só adicionava uma espera — os
// gráficos entram na mesma pintura dos números.
import SdrChartsPanel from "@/components/dashboard/SdrChartsPanel";
import { PageTabs } from "@/components/layout/PageTabs";
import { formatarHora } from "@/lib/formato";
import { Secao } from "@/components/layout/Secao";

type TileConfig = {
  key: MetricKey;
  label: string;
  icon: LucideIcon;
  accent?: StatAccent;
  format?: StatFormat;
  href?: string;
  hint?: string;
  noSource?: boolean;
  noComparison?: boolean;
  /** Métrica com lista por trás do número. Ver useSdrMetricLeads. */
  drilldown?: MetricDrilldownKey;
};

type Group = { title: string; description: string; tiles: TileConfig[] };

const GROUPS: Group[] = [
  {
    title: "Entrada",
    description: "De onde e quanto lead está chegando",
    tiles: [
      {
        key: "leadsRecebidos", label: "Leads recebidos", icon: UserPlus, accent: "primary", href: "/leads", drilldown: "leadsRecebidos",
        hint: "Contatos criados no período. Conta por data de criação, não por status — a qualificação sobrescreve lead → prospect e apagaria o histórico.",
      },
      {
        key: "leadsWhatsapp", label: "Leads WhatsApp", icon: MessageCircle, accent: "success", href: "/leads",
        hint: "Leads criados no período que nos escreveram por WhatsApp. Derivado das mensagens recebidas — o webhook não grava a origem no contato.",
      },
      {
        key: "leadsInstagram", label: "Leads Instagram", icon: Instagram, noSource: true,
        hint: "Sem fonte: nada no sistema grava Instagram como origem. A classificação atual agrupa Instagram dentro de \"Meta Ads\", e a integração de anúncios não cria contato.",
      },
      {
        key: "leadsGoogle", label: "Leads Google", icon: Globe, noSource: true,
        hint: "Sem fonte: não existe integração com Google Ads, e nenhuma entrada garante utm_source=google.",
      },
      {
        key: "leadsLinkedin", label: "Leads LinkedIn", icon: Linkedin, noSource: true,
        hint: "Sem fonte: o campo de LinkedIn no contato é o perfil dele, não a origem do lead. Não há integração nem valor de origem para LinkedIn.",
      },
    ],
  },
  {
    title: "Abordagem",
    description: "O que saiu para o lead e o que voltou",
    tiles: [
      {
        key: "abordagens", label: "Abordagens realizadas", icon: Send, accent: "primary", href: "/activities", drilldown: "abordagens",
        hint: "Abordagens que de fato aconteceram: atividade concluída (pela data da conclusão), e-mail que saiu, e mensagem de WhatsApp aceita pela Meta. Agendada e não feita não conta, e tentativa que falhou também não.",
      },
      {
        key: "taxaEntrega", label: "Taxa de entrega", icon: CheckCheck, accent: "success", format: "percent",
        hint: "Mensagens de WhatsApp entregues ou lidas sobre o total enviado, pelos callbacks da Meta. Cobre só WhatsApp: e-mail não tem captura de bounce, e envio que falha é apagado do registro.",
      },
      {
        key: "taxaResposta", label: "Taxa de resposta", icon: Reply, accent: "success", format: "percent", drilldown: "taxaResposta",
        hint: "Leads que responderam depois de serem abordados, sobre os abordados no período — por WhatsApp. Resposta que chega fora da janela do período não é contada.",
      },
      {
        key: "conversasIniciadas", label: "Conversas iniciadas", icon: MessagesSquare, accent: "primary", href: "/conversations",
        hint: "Contatos distintos com pelo menos uma mensagem de WhatsApp no período. Não existe entidade de conversa no banco — é derivado por contato.",
      },
    ],
  },
  {
    title: "Conversão",
    description: "O que a abordagem produziu",
    tiles: [
      {
        key: "reunioes", label: "Reuniões geradas", icon: CalendarCheck, accent: "primary", href: "/activities",
        hint: "Reuniões concluídas no período, pela data da conclusão. Depende de alguém registrar: nada cria reunião automaticamente e não há integração de agenda.",
      },
      {
        key: "oportunidades", label: "Oportunidades geradas", icon: Briefcase, accent: "primary", href: "/deals", drilldown: "oportunidades",
        hint: "Negócios que SAÍRAM da etapa de entrada. Como todo contato passa a entrar no funil automaticamente, estar nele é o padrão — o feito é ter avançado. Estar no funil não conta como oportunidade.",
      },
      {
        key: "vendasSdr", label: "Vendas originadas pelo SDR", icon: Trophy, accent: "success", href: "/deals",
        hint: "Negócios ganhos com contato vinculado, pela data de fechamento. É aproximação: o negócio não guarda quem o originou, e ganho sem data de fechamento não entra.",
      },
      {
        key: "qualificadosIA", label: "Leads qualificados pela IA", icon: Sparkles, noSource: true,
        hint: "Sem fonte: a qualificação existe, mas só é disparada por clique humano. As funções de IA do CRM devolvem texto e não gravam nada — falta registrar quem qualificou.",
      },
    ],
  },
  {
    title: "Operação",
    description: "Velocidade e fila de atendimento",
    tiles: [
      {
        key: "tempoRespostaMin", label: "Tempo médio de resposta", icon: Timer, accent: "warning", format: "duration",
        hint: "Do momento em que o lead escreve até a nossa primeira resposta, por WhatsApp. É a única fonte com direção e horário de servidor confiáveis. Cair é bom.",
      },
      {
        key: "aguardandoHumano", label: "Aguardando atendimento", icon: Hourglass, accent: "destructive", href: "/leads", noComparison: true,
        hint: "Leads sem nenhuma abordagem registrada: nenhuma atividade, nenhum e-mail, nenhuma mensagem. É a fila do momento, por isso não compara com o período anterior.",
      },
      {
        key: "transferidosHumano", label: "Transferidos para humano", icon: UserCheck, noSource: true,
        hint: "Sem fonte: não existe registro de passagem de bastão. Os campos que serviriam para isso foram removidos do banco numa migração anterior.",
      },
    ],
  },
];

const PERIODS: SdrPeriod[] = ["today", "this_week", "this_month", "last_month", "this_quarter", "this_year", "all"];

/** Métricas em destaque na faixa superior — o que se olha primeiro. */
const DESTAQUE: MetricKey[] = ["leadsRecebidos", "abordagens", "taxaResposta", "oportunidades"];

/** De qual coluna da série cada tile tira a própria linha de tendência. */
const TENDENCIA: Partial<Record<MetricKey, "leads" | "abordagens" | "respostas">> = {
  leadsRecebidos: "leads",
  abordagens: "abordagens",
  conversasIniciadas: "respostas",
  leadsWhatsapp: "leads",
  oportunidades: "leads",
};

export default function Dashboard() {
  const { orgId } = useOrg();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<SdrPeriod>("this_month");
  /** Métrica com o painel lateral aberto. Um painel serve os quatro tiles. */
  const [painelDe, setPainelDe] = useState<MetricDrilldownKey | null>(null);

  const { data, isFetching, isLoading, dataUpdatedAt, error } = useSdrMetrics(period);
  const { data: charts, isLoading: loadingCharts } = useSdrCharts(period);
  const metrics = data?.metrics;
  const pessoasAbordadas = data?.pessoasAbordadas ?? null;

  const lastRefresh = useMemo(
    () => (dataUpdatedAt ? new Date(dataUpdatedAt) : null),
    [dataUpdatedAt],
  );

  /** A série já carregada alimenta os minigráficos — sem consulta extra. */
  const tendencias = useMemo(() => {
    const serie = charts?.serie ?? [];
    return {
      leads: serie.map((p) => p.leads),
      abordagens: serie.map((p) => p.abordagens),
      respostas: serie.map((p) => p.respostas),
    };
  }, [charts?.serie]);

  const trendDe = (key: MetricKey) => {
    const coluna = TENDENCIA[key];
    return coluna ? tendencias[coluna] : undefined;
  };

  const refresh = () => {
    if (!orgId) return;
    queryClient.invalidateQueries({ queryKey: sdrMetricsKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: sdrChartsKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: sdrMetricLeadsKeys.all(orgId) });
  };

  const tiles = GROUPS.flatMap((g) => g.tiles);
  const tilesDestaque = DESTAQUE
    .map((k) => tiles.find((t) => t.key === k))
    .filter((t): t is TileConfig => !!t);

  return (
    <PageShell
      icon={Gauge}
      kicker="Operação"
      title="Painel de SDR"
      description="Entrada, abordagem, conversão e velocidade de atendimento"
      meta={
        lastRefresh ? (
          <p className="text-meta text-muted-foreground">
            {SDR_PERIOD_LABELS[period]} · atualizado{" "}
            {formatarHora(lastRefresh)}
          </p>
        ) : undefined
      }
      actions={
        <>
          <Select value={period} onValueChange={(v) => setPeriod(v as SdrPeriod)}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p} value={p}>{SDR_PERIOD_LABELS[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={refresh}
            disabled={isFetching}
            aria-label="Atualizar métricas"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </>
      }
    >


      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Não foi possível carregar as métricas: {(error as Error).message}</span>
        </div>
      )}

      {/* Três destinos, cada um com um trabalho:
          ver o movimento, consultar um número, perguntar. Antes tudo isso vinha
          empilhado na mesma rolagem — e as 4 métricas de destaque ainda
          apareciam DUAS vezes, na faixa de cima e de novo nos grupos. */}
      <Tabs defaultValue="visao">
        <PageTabs
          abas={[
            { valor: "visao", rotulo: "Visão geral", icone: LineChart, rotuloCurto: "Visão" },
            { valor: "indicadores", rotulo: "Indicadores", icone: ListFilter },
            { valor: "assistente", rotulo: "Assistente", icone: Bot },
          ]}
        />

        {/* ── Ver o movimento ── */}
        <TabsContent value="visao" className="mt-4 space-y-4">
          {/* Uma faixa, não quatro cartões.
              A moldura é uma só e a divisória entre os números é uma linha:
              os quatro passam a ser uma leitura em vez de quatro objetos. */}
          {/* A divisória é o FUNDO aparecendo pelo vão de 1px entre as células.
              `divide-x` só divide numa direção, e com 2 colunas no celular e 4
              no computador a conta de quais células levam borda muda a cada
              quebra -- vira uma pilha de `nth-child` que erra em algum tamanho.
              Aqui a grade não sabe quantas colunas tem, e funciona igual. */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius)] border border-border bg-border lg:grid-cols-4">
            {tilesDestaque.map((tile) =>
              isLoading ? (
                <Skeleton key={tile.key} className="h-[132px]" />
              ) : (
                <StatCard
                  key={tile.key}
                  emphasis
                  emFaixa
                  label={tile.label}
                  value={metrics?.[tile.key]?.value ?? null}
                  previous={metrics?.[tile.key]?.previous ?? null}
                  format={tile.format}
                  icon={tile.icon}
                  accent={tile.accent}
                  href={tile.href}
                  hint={tile.hint}
                  // Toques E pessoas no mesmo card. Só em abordagens: é a única
                  // métrica onde a diferença entre evento e gente confunde.
                  secundario={
                    tile.key === "abordagens"
                      ? { valor: pessoasAbordadas, rotulo: "pessoas" }
                      : undefined
                  }
                  trend={trendDe(tile.key)}
                  onCardClick={tile.drilldown ? () => setPainelDe(tile.drilldown!) : undefined}
                  drilldown={
                    tile.drilldown
                      ? (valor) => (
                          <MetricDrilldown
                            metric={tile.drilldown!}
                            period={period}
                            total={metrics?.[tile.key]?.value ?? null}
                            onVerTodos={() => setPainelDe(tile.drilldown!)}
                          >
                            {valor}
                          </MetricDrilldown>
                        )
                      : undefined
                  }
                />
              ),
            )}
          </div>

          <SdrChartsPanel charts={charts} carregando={loadingCharts} isAdmin={isAdmin} />

          <MetricLeadsSheet
            metric={painelDe}
            period={period}
            total={painelDe ? (metrics?.[painelDe]?.value ?? null) : null}
            onClose={() => setPainelDe(null)}
          />
        </TabsContent>

        {/* ── Consultar um número ── */}
        <TabsContent value="indicadores" className="mt-4 space-y-6">
          {GROUPS.map((group) => (
            <Secao key={group.title} titulo={group.title} descricao={group.description}>
              {/* Mesma faixa da aba anterior. Dezesseis métricas em cartões
                  soltos eram dezesseis caixas -- e como estão em grupos de
                  três a cinco, a moldura por grupo é o que faz o grupo se ler
                  como grupo. */}
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius)] border border-border bg-border lg:grid-cols-3 xl:grid-cols-5">
                {group.tiles.map((tile) =>
                  isLoading ? (
                    <Skeleton key={tile.key} className="h-[104px]" />
                  ) : (
                    <StatCard
                      key={tile.key}
                      label={tile.label}
                      value={metrics?.[tile.key]?.value ?? null}
                      previous={metrics?.[tile.key]?.previous ?? null}
                      format={tile.format}
                      icon={tile.icon}
                      accent={tile.accent}
                      href={tile.href}
                      hint={tile.hint}
                      noSource={tile.noSource}
                      noComparison={tile.noComparison}
                      emFaixa
                    />
                  ),
                )}
              </div>
            </Secao>
          ))}

          <p className="text-meta leading-relaxed text-muted-foreground">
            Métricas marcadas como <strong>sem fonte</strong> não têm dado no banco — não são zero,
            são não medidas. Passe o mouse no ícone de informação para ver o que falta gravar.
          </p>
        </TabsContent>

        {/* ── Perguntar ── */}
        <TabsContent value="assistente" className="mt-4">
          {metrics ? (
            <DashboardAIChat
              crmData={{
                periodo: SDR_PERIOD_LABELS[period],
                leadsRecebidos: metrics.leadsRecebidos.value,
                abordagens: metrics.abordagens.value,
                taxaEntrega: metrics.taxaEntrega.value,
                taxaResposta: metrics.taxaResposta.value,
                conversasIniciadas: metrics.conversasIniciadas.value,
                reunioes: metrics.reunioes.value,
                oportunidades: metrics.oportunidades.value,
                vendasSdr: metrics.vendasSdr.value,
                tempoRespostaMin: metrics.tempoRespostaMin.value,
                aguardandoHumano: metrics.aguardandoHumano.value,
                leadsWhatsapp: metrics.leadsWhatsapp.value,
                semFonte: GROUPS.flatMap((g) => g.tiles).filter((t) => t.noSource).map((t) => t.label),
              }}
            />
          ) : (
            <Skeleton className="h-[420px] rounded-lg" />
          )}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
