/**
 * Drill-down de um KPI do painel: de número para nome.
 *
 * Aqui mora só a PRÉVIA do hover. O painel lateral com a lista completa está em
 * MetricLeadsSheet, e quem o abre é o painel (Dashboard), não este componente:
 * o card inteiro é clicável, então o gatilho não pertence mais ao número.
 * Uma instância do painel serve os quatro tiles, em vez de quatro adormecidas.
 *
 * Por que o painel lateral em vez de navegar para /leads ou /activities: essas
 * páginas não têm filtro por período (os filtros são estado local, não URL),
 * então o destino ignoraria o recorte que o usuário está olhando e mostraria
 * tudo. Sair do painel para ver menos contexto não ajuda.
 *
 * A lista é da organização, igual ao card (era recortada por carteira até
 * 20260909140000). O que ainda pode sobrar contra o número do card é toque sem
 * lead vinculado, e isso é dito na tela em vez de escondido.
 */
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { SDR_PERIOD_LABELS, type SdrPeriod } from "@/hooks/useSdrMetrics";
import {
  useSdrMetricLeads,
  resumoDrilldown,
  type LinhaDrilldown,
  type MetricDrilldownKey,
} from "@/hooks/useSdrMetricLeads";
import { LeadRow } from "@/components/dashboard/LeadRow";
import { COPY, PREVIA } from "@/components/dashboard/metric-drilldown-copy";

export function Lista({
  linhas,
  carregando,
  erro,
  metric,
  onAbrir,
}: {
  linhas: LinhaDrilldown[];
  carregando: boolean;
  erro: boolean;
  metric: MetricDrilldownKey;
  onAbrir: (linha: LinhaDrilldown) => void;
}) {
  if (carregando) {
    return (
      <div className="space-y-1.5 p-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-9 rounded-md" />
        ))}
      </div>
    );
  }

  if (erro) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        Não foi possível carregar a lista.
      </p>
    );
  }

  if (linhas.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">{COPY[metric].vazio}</p>
    );
  }

  return (
    <div className="p-1">
      {linhas.map((linha) => (
        <LeadRow
          key={`${linha.tipo}-${linha.id}`}
          linha={linha}
          // Só negócio tem rota própria (/deals/:id). Contato não tem, e um
          // clique que joga o usuário na primeira página de uma lista sem
          // filtro é o mesmo beco sem saída que este painel existe para
          // resolver — então a linha de contato não finge ser clicável.
          onClick={linha.tipo === "deal" ? () => onAbrir(linha) : undefined}
        />
      ))}
    </div>
  );
}

export function MetricDrilldown({
  metric,
  period,
  total,
  onVerTodos,
  children,
}: {
  metric: MetricDrilldownKey;
  period: SdrPeriod;
  /** Valor do card. Serve para fechar a conta contra o que a lista mostra. */
  total: number | null;
  /** Abre o painel lateral. Quem o hospeda é o Dashboard. */
  onVerTodos: () => void;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const [aberto, setAberto] = useState(false);

  // `aberto` mantém a consulta parada até o hover. Sem isso, os quatro tiles em
  // destaque disparariam quatro consultas no carregamento do painel — para uma
  // lista que ninguém pediu para ver ainda.
  const previa = useSdrMetricLeads(metric, period, PREVIA, aberto);

  const linhas = previa.data ?? [];
  const resumo = resumoDrilldown({ metric, total, linhas, limite: PREVIA });
  const nota = COPY[metric].nota;

  return (
    <HoverCard open={aberto} onOpenChange={setAberto} openDelay={120} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span className="cursor-pointer underline decoration-dotted decoration-from-font underline-offset-4 transition-colors hover:decoration-solid">
          {children}
        </span>
      </HoverCardTrigger>

      {/* O clique é do card inteiro, então o conteúdo não pode disparar o do
          card por baixo: o portal do Radix sai do DOM do card, mas o evento
          sintético do React sobe pela árvore de componentes do mesmo jeito. */}
      <HoverCardContent className="p-0" onClick={(e) => e.stopPropagation()}>
        <div className="border-b px-3 py-2">
          <p className="text-label font-semibold text-foreground">{COPY[metric].titulo}</p>
          <p className="text-label text-muted-foreground">
            {[SDR_PERIOD_LABELS[period], nota].filter(Boolean).join(" · ")}
          </p>
        </div>

        <div className="max-h-64 overflow-y-auto">
          <Lista
            linhas={linhas}
            carregando={previa.isLoading}
            erro={!!previa.error}
            metric={metric}
            onAbrir={(linha) => {
              setAberto(false);
              navigate(`/deals/${linha.id}`);
            }}
          />
        </div>

        {(resumo.textoResto || resumo.truncado) && (
          <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
            {/* Só aparece com a lista NÃO truncada: cortada no limite, a
                diferença é paginação, e nomeá-la de outra coisa mentiria. */}
            <span className="text-label text-muted-foreground">{resumo.textoResto}</span>
            {resumo.truncado && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setAberto(false);
                  onVerTodos();
                }}
                className="flex shrink-0 items-center gap-1 text-label font-medium text-primary hover:underline"
              >
                ver a lista completa <ArrowRight className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
