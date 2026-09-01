/**
 * Série temporal em SVG puro — substitui o AreaChart do recharts no painel.
 *
 * Existe porque o recharts custa 407 kB minificado (1,3 MB em dev) e o painel
 * usava dele só área, eixo e tooltip. Aqui o desenho é um `path` por série.
 */
import { useId } from "react";
import { useHoverTooltip } from "./useHoverTooltip";

export type Serie = {
  nome: string;
  cor: string;
  pontos: number[];
  preencher?: boolean;
  /**
   * Escala própria, com o eixo do lado direito.
   *
   * Existe para séries de GRANDEZAS diferentes no mesmo gráfico -- investimento
   * em reais e contagem de leads. Numa escala comum a contagem vira uma linha
   * colada no zero e não se lê.
   *
   * Dois eixos são difíceis de ler de propósito: as duas escalas são
   * arbitrárias, e cruzamentos entre as linhas não significam nada. Use só
   * quando as grandezas realmente não se comparam.
   */
  eixoDireito?: boolean;
};

const A = 100; // largura do viewBox; a altura real vem do CSS
const H = 100;

function caminho(pontos: number[], max: number, fechar: boolean): string {
  if (pontos.length < 2) return "";
  const passo = A / (pontos.length - 1);
  const y = (v: number) => H - (max > 0 ? (v / max) * H : 0);

  const linha = pontos
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * passo).toFixed(2)},${y(p).toFixed(2)}`)
    .join(" ");

  // Fecha até a base para poder preencher com gradiente.
  return fechar ? `${linha} L${A},${H} L0,${H} Z` : linha;
}

export function AreaSeries({
  rotulos,
  series,
  altura = 220,
  formatar = (v: number) => String(v),
}: {
  rotulos: string[];
  series: Serie[];
  altura?: number;
  formatar?: (v: number) => string;
}) {
  const idGrad = useId().replace(/:/g, "");
  const { hover, aoMover, aoSair } = useHoverTooltip(rotulos.length);

  // Uma escala por eixo. As séries do mesmo eixo compartilham o máximo -- é o
  // que as torna comparáveis entre si.
  const daEsquerda = series.filter((s) => !s.eixoDireito);
  const daDireita = series.filter((s) => s.eixoDireito);
  const maxEsq = Math.max(1, ...daEsquerda.flatMap((s) => s.pontos));
  const maxDir = Math.max(1, ...daDireita.flatMap((s) => s.pontos));
  const escalaDe = (s: Serie) => (s.eixoDireito ? maxDir : maxEsq);
  const max = maxEsq;

  // Rótulos ralos — com 30 dias, mostrar todos vira borrão.
  const passoRotulo = Math.max(1, Math.ceil(rotulos.length / 8));
  const marcasY = [max, Math.round(max / 2), 0];

  return (
    <div className="flex gap-2">
      {/* Eixo Y fora do SVG: não distorce com preserveAspectRatio="none" */}
      <div
        className="flex shrink-0 flex-col justify-between py-0.5 text-right text-label tabular-nums text-muted-foreground"
        style={{ height: altura }}
        aria-hidden
      >
        {marcasY.map((m, i) => <span key={i}>{formatar(m)}</span>)}
      </div>

      <div className="min-w-0 flex-1">
        <div
          className="relative"
          style={{ height: altura }}
          onMouseMove={aoMover}
          onMouseLeave={aoSair}
          onTouchMove={aoMover}
          onTouchEnd={aoSair}
        >
          <svg
            viewBox={`0 0 ${A} ${H}`}
            preserveAspectRatio="none"
            className="h-full w-full overflow-visible"
            role="img"
            aria-label={`Evolução de ${series.map((s) => s.nome).join(", ")}`}
          >
            {/* Um gradiente POR SÉRIE. Havia um só, com a cor da primeira: duas
                séries preenchidas ficavam com o mesmo fundo, e a segunda
                parecia pertencer à primeira. */}
            <defs>
              {series.map((s, i) => (
                <linearGradient key={s.nome} id={`g-${idGrad}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.cor} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={s.cor} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>

            {/* Grade discreta nas mesmas marcas do eixo Y */}
            {[0, 0.5, 1].map((f) => (
              <line
                key={f}
                x1="0" x2={A} y1={H * f} y2={H * f}
                stroke="currentColor" strokeWidth="0.5"
                className="text-border" vectorEffect="non-scaling-stroke"
              />
            ))}

            {series.map((s, i) => (
              <g key={s.nome}>
                {s.preencher && (
                  <path d={caminho(s.pontos, escalaDe(s), true)} fill={`url(#g-${idGrad}-${i})`} stroke="none" />
                )}
                <path
                  d={caminho(s.pontos, escalaDe(s), false)}
                  fill="none" stroke={s.cor} strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}

            {hover && (
              <line
                x1={(hover.indice / Math.max(1, rotulos.length - 1)) * A}
                x2={(hover.indice / Math.max(1, rotulos.length - 1)) * A}
                y1="0" y2={H}
                stroke="currentColor" strokeWidth="1"
                className="text-muted-foreground" vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {hover && (
            <div
              className="pointer-events-none absolute z-10 min-w-[128px] rounded-md border border-border bg-popover p-2 text-label shadow-md"
              style={{
                left: Math.min(hover.x + 10, 9999),
                top: 4,
                // Vira para a esquerda perto da borda direita.
                transform: hover.indice > rotulos.length * 0.7 ? "translateX(-110%)" : undefined,
              }}
            >
              <p className="mb-1 font-medium">{rotulos[hover.indice]}</p>
              {series.map((s) => (
                <p key={s.nome} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.cor }} />
                    {s.nome}
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatar(s.pontos[hover.indice] ?? 0)}
                  </span>
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="mt-1 flex justify-between text-label tabular-nums text-muted-foreground" aria-hidden>
          {rotulos.filter((_, i) => i % passoRotulo === 0).map((r, i) => <span key={i}>{r}</span>)}
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {series.map((s) => (
            <span key={s.nome} className="flex items-center gap-1.5 text-label text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: s.cor }} />
              {s.nome}
            </span>
          ))}
        </div>
      </div>

      {daDireita.length > 0 && (
        // Eixo secundário, do lado direito. Só aparece quando alguma série usa
        // escala própria -- sem isso ele seria uma coluna de números sem dono.
        <div
          className="flex shrink-0 flex-col justify-between py-0.5 text-left text-label tabular-nums text-muted-foreground"
          style={{ height: altura }}
          aria-hidden
        >
          {[maxDir, Math.round(maxDir / 2), 0].map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </div>
      )}
    </div>
  );
}
