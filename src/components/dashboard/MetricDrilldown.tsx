/**
 * Drill-down de um KPI do painel: de número para nome.
 *
 * O hover mostra uma prévia; o clique no número abre a lista completa num
 * painel lateral. Os dois moram no mesmo arquivo porque são a mesma interação —
 * o rodapé da prévia é o que abre o painel.
 *
 * Por que o painel lateral em vez de navegar para /leads ou /activities: essas
 * páginas não têm filtro por período (os filtros são estado local, não URL),
 * então o destino ignoraria o recorte que o usuário está olhando e mostraria
 * tudo. Sair do painel para ver menos contexto não ajuda.
 *
 * Sobre o recorte da lista, ver useSdrMetricLeads: admin vê a organização, os
 * demais só a própria carteira — e a diferença contra o número do card é dita
 * na tela, não escondida.
 */
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { SDR_PERIOD_LABELS, type SdrPeriod } from "@/hooks/useSdrMetrics";
import {
  useSdrMetricLeads,
  resumoDrilldown,
  type LinhaDrilldown,
  type MetricDrilldownKey,
} from "@/hooks/useSdrMetricLeads";
import { LeadRow } from "@/components/dashboard/LeadRow";

/** Quantas linhas a prévia do hover mostra, e quantas o painel lateral busca. */
const PREVIA = 5;
const COMPLETO = 200;

const COPY: Record<MetricDrilldownKey, { titulo: string; vazio: string; nota?: string }> = {
  leadsRecebidos: { titulo: "Quem chegou", vazio: "Nenhum lead no período." },
  abordagens: { titulo: "Quem foi abordado", vazio: "Nenhuma abordagem no período." },
  taxaResposta: {
    titulo: "Abordados no período",
    vazio: "Ninguém foi abordado por WhatsApp no período.",
    // A ordem não é cronológica de propósito: numa taxa de resposta, o que gera
    // ação é a lista de quem falta cobrar.
    nota: "sem resposta primeiro",
  },
  oportunidades: { titulo: "Negócios criados", vazio: "Nenhum negócio no período." },
};

function Lista({
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
  children,
}: {
  metric: MetricDrilldownKey;
  period: SdrPeriod;
  /** Valor do card. Serve para fechar a conta contra o que a lista mostra. */
  total: number | null;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [hoverAberto, setHoverAberto] = useState(false);
  const [painelAberto, setPainelAberto] = useState(false);

  // `ativo` mantém as duas consultas paradas até a interação. Sem isso, os
  // quatro tiles em destaque disparariam quatro consultas no carregamento do
  // painel — para uma lista que ninguém pediu para ver ainda.
  const previa = useSdrMetricLeads(metric, period, PREVIA, hoverAberto || painelAberto);
  const completo = useSdrMetricLeads(metric, period, COMPLETO, painelAberto);

  const linhasPrevia = previa.data ?? [];
  const resumo = resumoDrilldown({ metric, total, linhas: linhasPrevia, limite: PREVIA, admin: isAdmin });
  const temMais = resumo.truncado;

  const abrirLinha = (linha: LinhaDrilldown) => {
    setPainelAberto(false);
    setHoverAberto(false);
    navigate(`/deals/${linha.id}`);
  };

  const nota = COPY[metric].nota;

  return (
    <>
      <HoverCard open={hoverAberto} onOpenChange={setHoverAberto} openDelay={120} closeDelay={100}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            // O Card em volta navega no clique. Sem parar a propagação, apontar
            // para o número levaria embora da página — o portal do Radix sai do
            // DOM do card, mas o evento sintético do React sobe pela árvore de
            // componentes do mesmo jeito.
            onClick={(e) => {
              e.stopPropagation();
              setPainelAberto(true);
            }}
            aria-label={`Ver quem compõe ${COPY[metric].titulo.toLowerCase()}`}
            className="rounded-sm text-left underline decoration-dotted decoration-from-font underline-offset-4 outline-none transition-colors hover:decoration-solid focus-visible:ring-2 focus-visible:ring-ring"
          >
            {children}
          </button>
        </HoverCardTrigger>

        <HoverCardContent className="p-0" onClick={(e) => e.stopPropagation()}>
          <div className="border-b px-3 py-2">
            <p className="text-[11px] font-semibold text-foreground">{COPY[metric].titulo}</p>
            <p className="text-[10px] text-muted-foreground">
              {[SDR_PERIOD_LABELS[period], nota].filter(Boolean).join(" · ")}
            </p>
          </div>

          <div className="max-h-64 overflow-y-auto">
            <Lista
              linhas={linhasPrevia}
              carregando={previa.isLoading}
              erro={!!previa.error}
              metric={metric}
              onAbrir={abrirLinha}
            />
          </div>

          {(resumo.textoResto || temMais) && (
            <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
              {/* Só aparece quando a lista NÃO está truncada: com a lista
                  cortada no limite, a diferença é paginação, e chamá-la de
                  carteira alheia seria mentira. */}
              <span className="text-[10px] text-muted-foreground">{resumo.textoResto}</span>
              {temMais && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPainelAberto(true);
                  }}
                  className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-primary hover:underline"
                >
                  ver a lista completa <ArrowRight className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )}
        </HoverCardContent>
      </HoverCard>

      <Sheet open={painelAberto} onOpenChange={setPainelAberto}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b px-5 py-4 text-left">
            <SheetTitle className="font-heading text-base">{COPY[metric].titulo}</SheetTitle>
            <SheetDescription className="text-xs">
              {[SDR_PERIOD_LABELS[period], nota].filter(Boolean).join(" · ")}
              {!isAdmin && " · somente a sua carteira"}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-3 py-2">
            <Lista
              linhas={completo.data ?? []}
              carregando={completo.isLoading}
              erro={!!completo.error}
              metric={metric}
              onAbrir={abrirLinha}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
