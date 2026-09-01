import { Link } from "react-router-dom";
import { ChevronRight, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useActivities } from "@/hooks/queries/useActivities";
import { ATIVIDADE_ICONE, ATIVIDADE_ROTULO } from "@/lib/atividade-tipos";
import { formatarDataCurta } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * O QUE PRECISA DE MIM AGORA — a coluna "Priority tasks" da referência.
 *
 * O painel respondia "como foi o período" e parava aí: para saber o que fazer a
 * seguir era preciso trocar de tela. É a diferença entre um relatório e um
 * painel de trabalho, e era o que faltava.
 *
 * PENDENTE COM PRAZO, e nessa ordem. Sem prazo não há o que cobrar — a
 * atividade viraria uma linha permanente sem urgência nenhuma, que é o mesmo
 * critério que o card do kanban usa para a próxima ação.
 *
 * Cinco linhas e um link. A lista completa é a tela de Atividades; repetir ela
 * aqui faria o painel competir com ela em vez de apontar para ela.
 */
export function AFazer() {
  const { data: atividades = [], isLoading } = useActivities();

  const inicioDeHoje = new Date();
  inicioDeHoje.setHours(0, 0, 0, 0);

  const pendentes = atividades
    .filter((a) => !a.completed_at && a.due_date)
    .sort((x, y) => new Date(x.due_date!).getTime() - new Date(y.due_date!).getTime())
    .slice(0, 5);

  return (
    <section className="vx-elevado flex flex-col rounded-lg bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
        <h3 className="vx-titulo-secao">A fazer</h3>
        <Link
          to="/activities"
          className="shrink-0 text-label font-medium text-primary hover:underline"
        >
          Ver todas
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 rounded-md" />)}
        </div>
      ) : pendentes.length === 0 ? (
        /* Sem pendência é uma BOA notícia, e o painel deve dizer isso em vez de
           mostrar uma caixa vazia — o mesmo erro que a tela de Atividades tinha,
           onde "nada encontrado" aparecia com dez atividades no banco. */
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-5 py-10 text-center">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <p className="text-xs font-medium">Nada em aberto com prazo</p>
          <p className="text-label text-muted-foreground">
            Atividade sem prazo não aparece aqui.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {pendentes.map((a) => {
            const Icone = ATIVIDADE_ICONE[a.type];
            const atrasada = new Date(a.due_date!) < inicioDeHoje;
            return (
              <li key={a.id}>
                <Link
                  to="/activities"
                  className="flex items-center gap-2.5 px-5 py-3 transition-colors hover:bg-accent/40"
                >
                  <Icone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{a.title}</span>
                    <span className="block truncate text-label text-muted-foreground">
                      {ATIVIDADE_ROTULO[a.type]}
                    </span>
                  </span>
                  {/* Atrasada é a única que muda de cor: é o que precisa de
                      resposta hoje, e o resto é só quando. */}
                  <span
                    className={cn(
                      "shrink-0 whitespace-nowrap text-label tabular-nums",
                      atrasada ? "font-semibold text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {formatarDataCurta(a.due_date)}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
