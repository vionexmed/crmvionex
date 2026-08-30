/**
 * Tile de métrica do painel de SDR.
 *
 * Extraído do markup que estava repetido 6× inline em src/pages/Dashboard.tsx —
 * com 16 métricas, repetir 18 linhas por tile seria inviável.
 *
 * Três estados:
 *  - valor real     → número + variação contra o período anterior;
 *  - sem fonte      → "—" + selo, para métrica que não tem dado no banco;
 *  - não calculável → "—" discreto, quando o período não tem dado (ex.: taxa
 *                     de entrega sem nenhum envio). Não é 0 — 0 seria mentira.
 */
import type { ReactNode } from "react";
import { LucideIcon, TrendingUp, TrendingDown, Info } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatarNumero } from "@/lib/formato";

export type StatFormat = "number" | "percent" | "duration";
export type StatAccent = "primary" | "success" | "warning" | "destructive";

// Classes precisam ser estáticas para o Tailwind detectar — nada de `bg-${accent}`.
//
// `bar` e `bubble` saíram junto com a barra colorida do topo e a bolha do
// ícone. Sobrou a cor do ícone, que é a única que ainda diz algo: distingue
// métrica de volume (primary) de métrica de qualidade (success/warning).
const ACCENT: Record<StatAccent, { icon: string }> = {
  primary: { icon: "text-primary" },
  success: { icon: "text-success" },
  warning: { icon: "text-warning" },
  destructive: { icon: "text-destructive" },
};

export interface StatCardProps {
  label: string;
  value: number | null;
  previous?: number | null;
  format?: StatFormat;
  icon: LucideIcon;
  accent?: StatAccent;
  /** Rota ao clicar no tile. Sem isso o tile não é clicável. */
  href?: string;
  /** Explicação/ressalva mostrada no ícone de informação. */
  hint?: string;
  /**
   * Segundo número, na mesma linha do principal.
   *
   * Existe porque "Abordagens realizadas" conta EVENTOS -- 1 ligação + 1 e-mail
   * para a mesma pessoa dão 2 -- e lido sozinho parece contagem de gente. Os dois
   * números medem coisas diferentes e úteis: toques dizem quanto o time produziu,
   * pessoas dizem quantas portas foram batidas. Mostrar só um obriga a escolher
   * qual pergunta o painel responde.
   */
  secundario?: { valor: number | null; rotulo: string };
  /** Métrica sem fonte de dado no banco — mostra selo e apaga o tile. */
  noSource?: boolean;
  /** Métrica de fila (valor "agora"), sem comparação com período anterior. */
  noComparison?: boolean;
  /**
   * Dentro de uma faixa: sem moldura própria.
   *
   * Quatro tiles com borda em fila são quatro CAIXAS, e o olho conta caixas
   * antes de ler números. Numa faixa, a moldura é uma só e a divisória entre
   * eles é uma linha -- os quatro números viram uma leitura, não quatro.
   */
  emFaixa?: boolean;
  /** Série do período para a linha de tendência. Vem pronta do painel. */
  trend?: number[];
  /** Destaque: usado na faixa das métricas principais. */
  emphasis?: boolean;
  /**
   * Envolve o valor com a prévia que revela as linhas por trás do número, no
   * hover. Recebe o valor já formatado.
   */
  drilldown?: (valor: ReactNode) => ReactNode;
  /**
   * Ação ao clicar no card. Tem precedência sobre `href`.
   *
   * Existe porque um card com drill-down não deve navegar para uma lista que
   * ignora o período — mas também não pode virar área morta com um alvo de
   * clique do tamanho de um dígito. O card inteiro abre o detalhe; o hover no
   * número dá a prévia.
   */
  onCardClick?: () => void;
}

/**
 * Linha de tendência em SVG puro. Montar uma instância de biblioteca de
 * gráfico por tile custaria caro com 16 tiles — e aqui só precisamos de uma
 * polyline sem eixo, sem tooltip e sem interação.
 */
function Sparkline({ points, className }: { points: number[]; className?: string }) {
  if (points.length < 2) return null;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const w = 100;
  const h = 24;

  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
      className={cn("h-6 w-full", className)}
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5"
            vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatValue(value: number, format: StatFormat): string {
  if (format === "percent") return `${value}%`;
  if (format === "duration") {
    if (value < 60) return `${value} min`;
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    if (hours < 24) return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return formatarNumero(value);
}

/** Variação percentual. null quando não há base de comparação. */
function variation(value: number | null, previous: number | null | undefined): number | null {
  if (value === null || previous === null || previous === undefined) return null;
  if (previous === 0) return value === 0 ? 0 : null;
  return Math.round(((value - previous) / previous) * 100);
}

export function StatCard({
  label,
  value,
  previous,
  format = "number",
  icon: Icon,
  accent = "primary",
  href,
  hint,
  secundario,
  noSource = false,
  noComparison = false,
  trend,
  emphasis = false,
  emFaixa = false,
  drilldown,
  onCardClick,
}: StatCardProps) {
  const navigate = useNavigate();
  const theme = ACCENT[accent];
  const clickable = (!!onCardClick || !!href) && !noSource;
  const delta = noSource || noComparison ? null : variation(value, previous);
  const mostrarTendencia = !noSource && value !== null && (trend?.length ?? 0) > 1;

  // Para tempo de resposta, cair é bom.
  const lowerIsBetter = format === "duration";
  const positive = delta !== null && (lowerIsBetter ? delta < 0 : delta > 0);

  return (
    // O NÚMERO é o elemento, não o cartão.
    //
    // Antes: barra colorida de 3px no topo, bolha de ícone circular, sombra,
    // e o valor competindo com tudo isso. Quatro tiles lado a lado viravam
    // quatro objetos decorados, e para ler os quatro números era preciso
    // atravessar a decoração de cada um.
    //
    // Agora o cartão é uma superfície plana com uma linha, e a hierarquia é
    // tipográfica: rótulo pequeno acima, número grande, variação pequena
    // abaixo. O ícone some -- ele nomeava a métrica que o rótulo já nomeia.
    <div
      className={cn(
        "group relative p-4 transition-colors",
        // Fundo próprio: é ele que tapa a grade e deixa só o vão de 1px à
        // mostra, formando a divisória.
        emFaixa ? "min-w-0 bg-background" : "rounded-[var(--radius)] border border-border",
        clickable && "cursor-pointer hover:bg-muted/60",
        noSource && "opacity-60",
      )}
      onClick={clickable ? () => (onCardClick ? onCardClick() : navigate(href!)) : undefined}
    >
      <div className="contents">
        <div className="mb-2 flex items-start justify-between gap-2">
          <span className="text-label font-medium text-muted-foreground">
            {label}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {hint && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Sobre ${label}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                  >
                    <Info className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[260px] text-meta leading-relaxed">
                  {hint}
                </TooltipContent>
              </Tooltip>
            )}
            {/* Sem bolha. O ícone vira uma marca discreta ao lado do rótulo --
                a bolha circular colorida dava a ele o peso de um botão, e ele
                não é clicável nem nomeia nada que o rótulo já não nomeie. */}
            <Icon className={cn("h-3.5 w-3.5", noSource ? "text-muted-foreground/50" : theme.icon)} />
          </div>
        </div>

        {(() => {
          const valor = (
            <span
              className={cn(
                // `font-bold` virou `font-semibold`: no tamanho de 30px o bold
                // do Poppins fecha os contornos e o número fica pesado demais
                // ao lado do rótulo de 11px.
                "block font-heading font-semibold tracking-tight tabular-nums",
                emphasis ? "text-3xl leading-none" : "text-[22px] leading-none",
                value === null ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {value === null ? "—" : formatValue(value, format)}
            </span>
          );

          if (secundario && secundario.valor !== null && value !== null) {
            const comSecundario = (
              <span className="flex items-baseline gap-1.5">
                {valor}
                <span className="text-xs font-medium text-muted-foreground">
                  · {formatValue(secundario.valor, "number")} {secundario.rotulo}
                </span>
              </span>
            );
            return drilldown && !noSource ? drilldown(comSecundario) : comSecundario;
          }
          // Sem fonte de dado não há linha para revelar — o "—" não é clicável.
          return drilldown && !noSource && value !== null ? drilldown(valor) : valor;
        })()}

        {mostrarTendencia && (
          <Sparkline points={trend!} className={cn("mt-2", theme.icon)} />
        )}

        {noSource ? (
          // Texto, não selo. O selo dava a "sem fonte" o mesmo peso visual de
          // um estado do dado -- e um tile sem fonte já está apagado a 60%; o
          // selo por cima disso chamava atenção para justamente o que não tem
          // o que mostrar.
          <p className="mt-1.5 text-label text-muted-foreground/70">sem fonte de dado</p>
        ) : delta !== null ? (
          <div
            className={cn(
              "mt-1.5 flex items-center gap-0.5 text-label font-medium",
              positive ? "text-success" : delta === 0 ? "text-muted-foreground" : "text-destructive",
            )}
          >
            {delta !== 0 &&
              (positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />)}
            {delta > 0 ? "+" : ""}
            {delta}% vs. anterior
          </div>
        ) : (
          <p className="mt-1.5 text-label text-muted-foreground">
            {noComparison ? "no momento" : value === null ? "sem dados no período" : "–"}
          </p>
        )}
      </div>
    </div>
  );
}
