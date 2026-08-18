/**
 * Uma linha do drill-down de KPI: quem está por trás do número.
 *
 * Serve contato e negócio — a função sdr_metric_leads devolve os dois no mesmo
 * formato, e `tipo` decide só para onde o clique navega.
 */
import { format } from "date-fns";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn, initials } from "@/lib/utils";
import type { LinhaDrilldown } from "@/hooks/useSdrMetricLeads";

const moeda = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export function LeadRow({
  linha,
  onClick,
  className,
}: {
  linha: LinhaDrilldown;
  onClick?: () => void;
  className?: string;
}) {
  // Meta da direita: valor no negócio, data nas demais. Nunca as duas — a
  // linha é estreita e o que importa muda conforme a métrica.
  const meta =
    linha.valor !== null
      ? moeda(linha.valor)
      : linha.quando
        ? format(new Date(linha.quando), "dd/MM HH:mm")
        : null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
        onClick ? "hover:bg-muted/60" : "cursor-default",
        className,
      )}
    >
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
          {initials(linha.titulo)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">{linha.titulo}</p>
        {(linha.subtitulo || linha.detalhe) && (
          <p className="truncate text-[10px] text-muted-foreground">
            {[linha.subtitulo, linha.detalhe].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5">
        {meta && <span className="text-[10px] tabular-nums text-muted-foreground">{meta}</span>}
        {/* Só taxa de resposta preenche `respondeu`; nas outras fica fora. */}
        {linha.respondeu !== null && (
          <span
            className={cn(
              "rounded-full px-1.5 py-px text-[9px] font-medium",
              linha.respondeu
                ? "bg-success/10 text-success"
                : "bg-muted text-muted-foreground",
            )}
          >
            {linha.respondeu ? "respondeu" : "sem resposta"}
          </span>
        )}
      </div>
    </button>
  );
}
