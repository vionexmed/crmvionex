/**
 * Rosca em SVG puro — substitui o PieChart do recharts no painel.
 *
 * Desenhada com um círculo por fatia usando stroke-dasharray: mais simples e
 * previsível que montar path de arco à mão, e o hover é por fatia.
 */
import { useHoverIndex } from "./useHoverTooltip";

export type Fatia = { nome: string; valor: number; cor: string };

export function Donut({
  fatias,
  tamanho = 168,
  espessura = 26,
  formatar = (v: number) => String(v),
}: {
  fatias: Fatia[];
  tamanho?: number;
  espessura?: number;
  formatar?: (v: number) => string;
}) {
  const { indice, apontar, limpar } = useHoverIndex();
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  if (total <= 0) return null;

  const r = 50 - espessura / 2 / (tamanho / 100);
  const circ = 2 * Math.PI * r;

  let acumulado = 0;
  const arcos = fatias.map((f, i) => {
    const fracao = f.valor / total;
    const arco = { ...f, i, fracao, offset: acumulado };
    acumulado += fracao;
    return arco;
  });

  const emFoco = indice !== null ? arcos[indice] : null;

  return (
    <div className="relative shrink-0" style={{ width: tamanho, height: tamanho }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label="Distribuição por canal">
        {arcos.map((a) => (
          <circle
            key={a.nome}
            cx="50" cy="50" r={r}
            fill="none"
            stroke={a.cor}
            strokeWidth={espessura / (tamanho / 100)}
            // 1px de folga entre fatias, para elas se distinguirem sem borda.
            strokeDasharray={`${Math.max(0, a.fracao * circ - 0.6)} ${circ}`}
            strokeDashoffset={-a.offset * circ}
            className="cursor-default transition-opacity"
            opacity={indice === null || indice === a.i ? 1 : 0.35}
            onMouseEnter={() => apontar(a.i)}
            onMouseLeave={limpar}
          />
        ))}
      </svg>

      {/* Centro: total, ou a fatia apontada */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        {emFoco ? (
          <>
            <span className="font-heading text-lg font-bold tabular-nums leading-none">
              {Math.round(emFoco.fracao * 100)}%
            </span>
            <span className="mt-0.5 max-w-[72%] truncate text-label text-muted-foreground">
              {emFoco.nome}
            </span>
          </>
        ) : (
          <>
            <span className="font-heading text-lg font-bold tabular-nums leading-none">
              {formatar(total)}
            </span>
            <span className="mt-0.5 text-label text-muted-foreground">no total</span>
          </>
        )}
      </div>
    </div>
  );
}
