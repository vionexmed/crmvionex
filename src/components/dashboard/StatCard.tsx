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
const ACCENT: Record<StatAccent, { icon: string; fundo: string }> = {
  primary: { icon: "text-primary", fundo: "bg-primary/10" },
  success: { icon: "text-success", fundo: "bg-success/10" },
  warning: { icon: "text-warning", fundo: "bg-warning/10" },
  destructive: { icon: "text-destructive", fundo: "bg-destructive/10" },
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
    // Cartão levantado, com o número mandando dentro dele.
    //
    // A versão original tinha barra colorida de 3px no topo, bolha circular no
    // ícone e sombra -- e o valor competia com os três. Cheguei a tirar tudo,
    // inclusive a sombra, e ficou chapado demais: sem barra e sem elevação, o
    // cartão deixava de ser um objeto e virava um retângulo desenhado.
    //
    // O meio-termo: o cartão volta a se levantar do fundo e o ícone volta a
    // aparecer, mas a barra colorida não -- ela era a terceira coisa dizendo
    // "sou importante", depois da sombra e do número.
    <div
      className={cn(
        "group relative rounded-lg bg-card vx-respiro transition-shadow",
        /*
         * Na faixa a elevação é do contêiner, não de cada célula.
         *
         * `rounded-none` e a divisória NA CÉLULA corrigem dois defeitos que
         * apareciam juntos na aba Indicadores:
         *
         * 1. o cartão mantinha `rounded-lg` dentro de uma grade de fio de
         *    cabelo, e o canto arredondado deixava a cor da grade vazar --
         *    quatro pequenas mordidas cinzas em cada célula;
         * 2. a grade separava as células com `gap-px` sobre `bg-border`, e a cor
         *    da linha aparecia inteira em toda célula SEM cartão. Os grupos têm
         *    5, 4, 4 e 3 métricas numa grade de 5, 3 ou 2 colunas: em quase todo
         *    tamanho de tela sobrava célula, e cada uma virava um retângulo
         *    cinza sólido do tamanho de um cartão.
         *
         * Com a linha desenhada pela célula, célula que não existe não desenha
         * nada -- e o fundo do contêiner passou a ser `bg-card`, então o que
         * sobra é fundo de cartão, não cor de borda.
         *
         * DE QUE LADO, e isto é o que fecha o problema.
         *
         * A primeira versão usava `border-b border-r`: cada célula desenhava
         * para BAIXO e para a DIREITA. Numa linha incompleta -- que é a regra
         * aqui, com grupos de 5, 4, 4 e 3 numa grade de 5, 3 ou 2 colunas -- a
         * última célula desenhava uma divisória apontando para o vazio, e a linha
         * de cima desenhava um trecho horizontal por baixo de célula que não
         * existe. Contei: até 3 traços verticais soltos e até 5 trechos
         * horizontais sobrando, variando por tamanho de tela. Traço de 1px
         * separando nada de nada é exatamente o que faz a tela parecer quebrada.
         *
         * `border-t border-l` inverte: a célula desenha para CIMA e para a
         * ESQUERDA, ou seja em direção a vizinhos que SEMPRE existem -- a
         * primeira coluna e a primeira linha são recortadas pela margem negativa
         * do contêiner. Célula que falta não tem quem desenhe para ela. Zero
         * traços soltos, em qualquer contagem de células e de colunas, sem
         * `nth-child`.
         */
        emFaixa ? "min-w-0 rounded-none border-l border-t border-border" : "vx-elevado",
        clickable && "cursor-pointer hover:shadow-[0_2px_4px_hsl(217_72%_14%/0.08),0_8px_20px_hsl(217_72%_14%/0.08)]",
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
                <TooltipContent className="max-w-[260px] text-label leading-relaxed">
                  {hint}
                </TooltipContent>
              </Tooltip>
            )}
            {/* Quadrado com raio, não bolha. A bolha circular dava ao ícone o
                contorno de um botão -- e ele não é clicável. O fundo tênue o
                assenta sem fingir que se pode tocar. */}
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md",
                noSource ? "bg-muted" : theme.fundo,
              )}
            >
              <Icon className={cn("h-3.5 w-3.5", noSource ? "text-muted-foreground/50" : theme.icon)} />
            </span>
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
