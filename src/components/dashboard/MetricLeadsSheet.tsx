/**
 * Painel lateral com a lista completa por trás de um KPI.
 *
 * Uma instância serve os quatro tiles — `metric` null significa fechado. Antes
 * cada MetricDrilldown carregava o próprio painel, o que deixava quatro Sheets
 * adormecidos no painel para no máximo um ser usado por vez.
 *
 * Por que painel e não navegar para /leads ou /activities: essas páginas não
 * têm filtro por período (os filtros são estado local, não URL), então o
 * destino ignoraria o recorte que a pessoa está olhando e mostraria tudo. Sair
 * do painel para ver menos contexto não ajuda.
 */
import { useNavigate } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { SDR_PERIOD_LABELS, type SdrPeriod } from "@/hooks/useSdrMetrics";
import { useSdrMetricLeads, type MetricDrilldownKey } from "@/hooks/useSdrMetricLeads";
import { Lista } from "@/components/dashboard/MetricDrilldown";
import { COPY, COMPLETO } from "@/components/dashboard/metric-drilldown-copy";

export function MetricLeadsSheet({
  metric,
  period,
  onClose,
}: {
  /** null = fechado. */
  metric: MetricDrilldownKey | null;
  period: SdrPeriod;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  // Hooks não podem ser condicionais: a consulta fica parada por `enabled`
  // enquanto não há métrica, e "leadsRecebidos" é só um valor de repouso.
  const lista = useSdrMetricLeads(metric ?? "leadsRecebidos", period, COMPLETO, !!metric);

  const nota = metric ? COPY[metric].nota : undefined;

  return (
    <Sheet open={!!metric} onOpenChange={(aberto) => !aberto && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        {metric && (
          <>
            <SheetHeader className="border-b px-5 py-4 text-left">
              <SheetTitle className="font-heading text-base">{COPY[metric].titulo}</SheetTitle>
              <SheetDescription className="text-xs">
                {[SDR_PERIOD_LABELS[period], nota].filter(Boolean).join(" · ")}
                {/* Dito na cara: a lista de quem não é admin é a carteira dele,
                    não a organização — senão o total do card parece errado. */}
                {!isAdmin && " · somente a sua carteira"}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-3 py-2">
              <Lista
                linhas={lista.data ?? []}
                carregando={lista.isLoading}
                erro={!!lista.error}
                metric={metric}
                onAbrir={(linha) => {
                  onClose();
                  navigate(`/deals/${linha.id}`);
                }}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
