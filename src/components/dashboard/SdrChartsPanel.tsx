/**
 * Bloco de gráficos do painel — layout e estado de carregamento.
 *
 * Já foi carregado sob demanda, quando os gráficos dependiam do recharts
 * (407 kB). Agora são SVG puro e o import é estático: não há peso a postergar.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { GraficoEvolucao, GraficoFunil, GraficoCanais, GraficoPessoas } from "./SdrCharts";
import type { SdrCharts } from "@/hooks/useSdrCharts";

export default function SdrChartsPanel({
  charts,
  carregando,
  isAdmin,
}: {
  charts: SdrCharts | undefined;
  carregando: boolean;
  isAdmin: boolean;
}) {
  // Esqueleto enquanto a consulta de agregação não volta. Antes morava em
  // arquivo próprio, para o import estático do fallback não arrastar o recharts.
  // Sem recharts, essa separação deixou de ter motivo.
  if (carregando) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[290px] rounded-lg" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[280px] rounded-lg" />
          <Skeleton className="h-[280px] rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GraficoEvolucao dados={charts?.serie ?? []} />

      <div className="grid gap-4 lg:grid-cols-2">
        <GraficoFunil dados={charts?.funil ?? []} />
        <GraficoCanais dados={charts?.canais ?? []} />
      </div>

      {/* Desempenho individual é restrito: mostrar a todos contradiria a
          privacidade entre pares. A função no banco também recusa não-admin. */}
      {isAdmin && charts?.pessoas && charts.pessoas.length > 0 && (
        <GraficoPessoas dados={charts.pessoas} />
      )}
    </div>
  );
}
