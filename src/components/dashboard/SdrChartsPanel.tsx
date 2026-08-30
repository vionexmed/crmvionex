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
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Skeleton className="h-[290px] rounded-lg" />
          <Skeleton className="h-[240px] rounded-lg" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-[265px] rounded-lg" />
          <Skeleton className="h-[265px] rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    /**
     * Coluna principal larga, lateral estreita.
     *
     * Era uma PILHA: os quatro gráficos empilhados, todos com o mesmo peso, e
     * nada dizia qual olhar primeiro. Mas eles respondem perguntas de níveis
     * diferentes:
     *
     *   coluna larga    o que ACONTECEU — a evolução no tempo, e quem fez
     *   coluna estreita onde está travando, e de onde veio — consulta pontual
     *
     * `2fr / 1fr` em vez de `2/3 + 1/3` fixo: com `minmax(0, …)` as colunas
     * podem encolher abaixo do conteúdo, que é o que impede um rótulo longo de
     * empurrar a grade.
     *
     * No celular vira uma coluna só, e a ordem do DOM é a ordem de leitura:
     * evolução, pessoas, funil, canais.
     */
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
      <div className="space-y-4">
        <GraficoEvolucao dados={charts?.serie ?? []} />

        {/* Desempenho individual é restrito: mostrar a todos contradiria a
            privacidade entre pares. A função no banco também recusa não-admin. */}
        {isAdmin && charts?.pessoas && charts.pessoas.length > 0 && (
          <GraficoPessoas dados={charts.pessoas} />
        )}
      </div>

      <div className="space-y-4">
        <GraficoFunil dados={charts?.funil ?? []} />
        <GraficoCanais dados={charts?.canais ?? []} />
      </div>
    </div>
  );
}
