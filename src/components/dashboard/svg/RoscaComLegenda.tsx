import { Donut, type Fatia } from "./Donut";

/**
 * Rosca com a legenda ao lado — o par que substitui `PieChart` + `Legend` do
 * recharts.
 *
 * A `Legend` do recharts empilha os rótulos abaixo do gráfico, sem valor nem
 * percentual: dá para ver as cores e não dá para ler os números. A legenda em
 * lista mostra nome, valor e percentual na mesma linha, que é o que alguém
 * olhando um relatório quer saber.
 *
 * O padrão já existia inline em `GraficoCanais`; aqui ele fica reutilizável.
 */
export function RoscaComLegenda({
  fatias,
  formatar = (v: number) => String(v),
  /** Quantas linhas de legenda mostrar. O resto vira "e mais N". */
  maximoNaLegenda = 6,
  tamanho,
}: {
  fatias: Fatia[];
  formatar?: (v: number) => string;
  maximoNaLegenda?: number;
  tamanho?: number;
}) {
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  if (total <= 0) return null;

  // Maior primeiro: numa lista cortada, o que fica de fora deve ser o menos
  // relevante. `.slice()` antes de ordenar porque `.sort()` é in place e o
  // array vem do chamador.
  const ordenadas = [...fatias].sort((a, b) => b.valor - a.valor);
  const visiveis = ordenadas.slice(0, maximoNaLegenda);
  const ocultas = ordenadas.length - visiveis.length;

  return (
    // `flex-wrap` e `justify-center`: na coluna estreita do painel, rosca de
    // 168px mais a legenda não cabem lado a lado, e sem quebrar a legenda
    // esmagaria até "WhatsApp" virar "Wha…". Quebrando, a rosca fica em cima e
    // a legenda embaixo, com a largura toda.
    //
    // `min-w-[180px]` na legenda é o gatilho: abaixo disso ela desce.
    <div className="flex flex-wrap items-center justify-center gap-4">
      <Donut fatias={ordenadas} formatar={formatar} tamanho={tamanho} />
      <ul className="w-full min-w-[180px] flex-1 space-y-1.5 sm:w-auto">
        {visiveis.map((f) => (
          <li key={f.nome} className="flex items-center gap-2 text-label">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: f.cor }} />
            <span className="flex-1 truncate">{f.nome}</span>
            <span className="font-medium tabular-nums">{formatar(f.valor)}</span>
            <span className="w-9 text-right tabular-nums text-muted-foreground">
              {Math.round((f.valor / total) * 100)}%
            </span>
          </li>
        ))}
        {ocultas > 0 && (
          // Dizer quantas ficaram de fora, em vez de cortar em silêncio -- é o
          // mesmo princípio do teto declarado nas consultas.
          <li className="pl-4 text-label text-muted-foreground">e mais {ocultas}</li>
        )}
      </ul>
    </div>
  );
}
