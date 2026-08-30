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
import {
  useSdrMetricLeads,
  resumoDrilldown,
  type MetricDrilldownKey,
} from "@/hooks/useSdrMetricLeads";
import { Lista } from "@/components/dashboard/MetricDrilldown";
import { COPY, COMPLETO } from "@/components/dashboard/metric-drilldown-copy";

export function MetricLeadsSheet({
  metric,
  period,
  total,
  onClose,
}: {
  /** null = fechado. */
  metric: MetricDrilldownKey | null;
  period: SdrPeriod;
  /** Valor do card. Sem ele não há como fechar a conta com o que a lista mostra. */
  total: number | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  // Hooks não podem ser condicionais: a consulta fica parada por `enabled`
  // enquanto não há métrica, e "leadsRecebidos" é só um valor de repouso.
  const lista = useSdrMetricLeads(metric ?? "leadsRecebidos", period, COMPLETO, !!metric);

  const nota = metric ? COPY[metric].nota : undefined;

  // A linha do resto vivia só na prévia do hover. O painel mostrava a lista sem
  // explicar a diferença contra o número do card — e "4 abordagens" com uma
  // linha só lê como bug, que é exatamente o que aconteceu.
  const linhas = lista.data ?? [];
  const resumo = resumoDrilldown({
    metric: metric ?? "leadsRecebidos",
    total,
    linhas,
    limite: COMPLETO,
    admin: isAdmin,
  });

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

            {/* Antes da lista, não depois: a pessoa precisa saber que o número
                não cabe todo aqui ANTES de contar as linhas e concluir que
                falta dado. */}
            {resumo.textoResto && (
              <div className="border-b bg-muted/30 px-5 py-2.5">
                <p className="text-meta leading-relaxed text-muted-foreground">
                  A lista mostra <strong className="text-foreground">{resumo.visivel}</strong> de{" "}
                  <strong className="text-foreground">{total}</strong>. {resumo.textoResto}
                  {metric === "abordagens" && (
                    <>
                      {" "}— abordagem conta atividade, e-mail e WhatsApp enviados, e nem toda
                      mensagem está vinculada a um lead.
                    </>
                  )}
                </p>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-3 py-2">
              <Lista
                linhas={linhas}
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
