/**
 * Barra horizontal em div — mesmo padrão que o funil já usava.
 * Substitui o BarChart do recharts sem trazer a biblioteca.
 */
export function BarRow({
  rotulo,
  valores,
  max,
  formatar = (v: number) => String(v),
}: {
  rotulo: string;
  valores: { nome: string; valor: number; cor: string }[];
  max: number;
  formatar?: (v: number) => string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] font-medium">{rotulo}</span>
        <span className="flex shrink-0 items-baseline gap-2.5 text-[10px] tabular-nums text-muted-foreground">
          {valores.map((v) => (
            <span key={v.nome} className="flex items-center gap-1" title={v.nome}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: v.cor }} />
              {formatar(v.valor)}
            </span>
          ))}
        </span>
      </div>
      <div className="flex h-2 w-full gap-px overflow-hidden rounded-sm bg-muted">
        {valores.map((v) => (
          <div
            key={v.nome}
            className="h-full transition-all"
            style={{
              width: `${max > 0 ? (v.valor / max) * 100 : 0}%`,
              backgroundColor: v.cor,
            }}
            title={`${v.nome}: ${formatar(v.valor)}`}
          />
        ))}
      </div>
    </div>
  );
}
