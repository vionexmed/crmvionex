import { BarRow } from "./BarRow";

/**
 * Um grupo de barras horizontais com legenda — substitui o `BarChart` vertical
 * do recharts.
 *
 * A troca de vertical para horizontal não é preferência: no gráfico vertical o
 * nome de cada pessoa vira rótulo de eixo X, e com mais de quatro nomes o
 * recharts os rotaciona ou os corta. Na horizontal o nome fica na sua linha,
 * legível, e a lista cresce para baixo sem apertar nada.
 */
export function BarrasAgrupadas<T>({
  linhas,
  rotulo,
  series,
  formatar = (v: number) => String(v),
  vazio = "Sem dados",
}: {
  linhas: T[];
  /** O nome que identifica a linha — a pessoa, a etapa, o mês. */
  rotulo: (item: T) => string;
  /** Cada série tem um nome, uma cor e como extrair o valor da linha. */
  series: { nome: string; cor: string; valor: (item: T) => number }[];
  formatar?: (v: number) => string;
  vazio?: string;
}) {
  // Escala compartilhada: cada barra é lida contra o MESMO máximo, senão a
  // maior barra de cada linha teria sempre a largura total e a comparação entre
  // linhas ficaria impossível.
  const max = Math.max(1, ...linhas.flatMap((l) => series.map((s) => s.valor(l))));
  const comMovimento = linhas.filter((l) => series.some((s) => s.valor(l) > 0));

  if (comMovimento.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-center text-xs text-muted-foreground">
        {vazio}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {comMovimento.map((item, i) => (
        <BarRow
          key={`${rotulo(item)}-${i}`}
          rotulo={rotulo(item)}
          max={max}
          formatar={formatar}
          valores={series.map((s) => ({ nome: s.nome, valor: s.valor(item), cor: s.cor }))}
        />
      ))}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2">
        {series.map((s) => (
          <span key={s.nome} className="flex items-center gap-1.5 text-label text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: s.cor }} />
            {s.nome}
          </span>
        ))}
      </div>
    </div>
  );
}
