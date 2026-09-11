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
}: {
  charts: SdrCharts | undefined;
  carregando: boolean;
}) {
  // Esqueleto enquanto a consulta de agregação não volta. Antes morava em
  // arquivo próprio, para o import estático do fallback não arrastar o recharts.
  // Sem recharts, essa separação deixou de ter motivo.
  /*
    A GRADE É UMA SÓ, e as posições são explícitas.

    Eram DUAS PILHAS independentes -- um `space-y-4` por coluna. Cada pilha
    fluía sozinha, então a fileira de baixo começava em alturas diferentes: o
    "Funil de conversão" tem descrição de duas linhas e o "Evolução" de uma, e
    esses ~17px de diferença empurravam a coluna da direita inteira para baixo.
    O olho lê isso como cartão torto, e não como texto mais longo.

    Numa grade de verdade a fileira é uma unidade: as duas células dividem a
    mesma altura e a de baixo começa no mesmo lugar nas duas colunas.

    A ORDEM DO DOM continua sendo a de leitura no celular -- evolução, pessoas,
    funil, canais --, e a posição em `lg` vem de `col-start`/`row-start`. O
    caminho fácil seria reordenar o DOM para evolução/funil/pessoas/canais, e
    aí o celular passaria a intercalar coluna larga com estreita.
  */
  const AREA = {
    evolucao: "lg:col-start-1 lg:row-start-1",
    pessoas: "lg:col-start-1 lg:row-start-2",
    funil: "lg:col-start-2 lg:row-start-1",
    canais: "lg:col-start-2 lg:row-start-2",
  } as const;

  if (carregando) {
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* O esqueleto usa a MESMA grade: com duas pilhas aqui e grade depois,
            a tela saltava de um arranjo para outro ao terminar de carregar. */}
        <Skeleton className={`h-[290px] rounded-lg ${AREA.evolucao}`} />
        <Skeleton className={`h-[290px] rounded-lg ${AREA.funil}`} />
        <Skeleton className={`h-[240px] rounded-lg ${AREA.pessoas}`} />
        <Skeleton className={`h-[240px] rounded-lg ${AREA.canais}`} />
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
     * SEM `items-start`: é ele que deixaria cada cartão com a altura do próprio
     * conteúdo, e aí os dois de uma fileira terminariam em alturas diferentes.
     * Esticando, a fileira lê como uma fileira.
     */
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <GraficoEvolucao dados={charts?.serie ?? []} className={AREA.evolucao} />

      <GraficoFunil dados={charts?.funil ?? []} className={AREA.funil} />

      {/* Deixou de ser restrito a admin junto com o resto do CRM: os eventos
          que compõem o número da pessoa já estão à vista da equipe. */}
      {charts?.pessoas && charts.pessoas.length > 0 && (
        <GraficoPessoas dados={charts.pessoas} className={AREA.pessoas} />
      )}

      <GraficoCanais dados={charts?.canais ?? []} className={AREA.canais} />
    </div>
  );
}
