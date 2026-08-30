/**
 * Gráficos do painel de SDR — SVG puro, sem biblioteca de gráfico.
 *
 * O recharts custa 407 kB minificado (1,3 MB em desenvolvimento) e o painel
 * usava dele apenas área, barra, rosca, eixo e tooltip. Como o funil já era
 * desenhado com divs e a linha de tendência dos tiles já era SVG à mão, o
 * caminho natural foi desenhar os quatro. O recharts segue no projeto para
 * Relatórios e Marketing — só saiu do caminho do painel.
 *
 * Todos recebem dado já agregado pelo banco: nenhum agrupa linha no cliente,
 * porque isso quebraria a privacidade entre pessoas montada no Plano 2.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CHART_COLORS } from "@/components/reports/types";
import { AreaSeries } from "./svg/AreaSeries";
import { Donut } from "./svg/Donut";
import { BarRow } from "./svg/BarRow";
import type { PontoSerie, EtapaFunil, FatiaCanal, LinhaPessoa } from "@/hooks/useSdrCharts";
import { formatarNumero } from "@/lib/formato";

const fmt = (v: number) => formatarNumero(v);

/** dd/MM sem o off-by-one de fuso que `new Date("2026-08-17")` causa. */
const rotuloDia = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center text-center text-xs text-muted-foreground">
      {texto}
    </div>
  );
}

// ── Evolução no tempo ────────────────────────────────────────────────────────
export function GraficoEvolucao({ dados }: { dados: PontoSerie[] }) {
  const temDado = dados.some((d) => d.leads || d.abordagens || d.respostas);

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Evolução no período</CardTitle>
        <CardDescription className="text-meta">
          Leads que entraram, abordagens que saíram e respostas que voltaram
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        {!temDado ? (
          <Vazio texto="Nenhum movimento registrado neste período." />
        ) : (
          <AreaSeries
            rotulos={dados.map((d) => rotuloDia(d.dia))}
            formatar={fmt}
            series={[
              { nome: "Leads", cor: CHART_COLORS[0], pontos: dados.map((d) => d.leads), preencher: true },
              { nome: "Abordagens", cor: CHART_COLORS[1], pontos: dados.map((d) => d.abordagens) },
              { nome: "Respostas", cor: CHART_COLORS[2], pontos: dados.map((d) => d.respostas) },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ── Funil ────────────────────────────────────────────────────────────────────
export function GraficoFunil({ dados }: { dados: EtapaFunil[] }) {
  const topo = dados[0]?.total ?? 0;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Funil de conversão</CardTitle>
        <CardDescription className="text-meta">
          Quantos chegaram a cada etapa, e a perda entre elas
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        {topo === 0 ? (
          <Vazio texto="Nenhum lead no período." />
        ) : (
          <div className="space-y-2.5">
            {dados.map((etapa, i) => {
              const largura = topo > 0 ? Math.max(2, (etapa.total / topo) * 100) : 0;
              const anterior = i > 0 ? dados[i - 1].total : null;
              const conversao = anterior && anterior > 0
                ? Math.round((etapa.total / anterior) * 100)
                : null;

              return (
                <div key={etapa.etapa}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-meta">
                    <span className="font-medium">{etapa.etapa}</span>
                    <span className="flex items-baseline gap-2">
                      {conversao !== null && (
                        <span
                          className="tabular-nums text-muted-foreground"
                          title={`${conversao}% avançaram de "${dados[i - 1].etapa}"`}
                        >
                          {conversao}%
                        </span>
                      )}
                      <span className="font-heading text-sm font-bold tabular-nums">
                        {fmt(etapa.total)}
                      </span>
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-sm bg-muted">
                    <div
                      className="h-full rounded-sm transition-all"
                      style={{
                        width: `${largura}%`,
                        backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Canais ───────────────────────────────────────────────────────────────────
export function GraficoCanais({ dados }: { dados: FatiaCanal[] }) {
  const total = dados.reduce((s, d) => s + d.total, 0);
  // Enquanto o vocabulário de origem não for unificado (Plano 6), a maior parte
  // dos leads cai em "Não informado" — melhor avisar do que deixar interpretar.
  const naoInformado = dados.find((d) => d.canal === "Não informado")?.total ?? 0;
  const maioriaSemOrigem = total > 0 && naoInformado / total > 0.5;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Leads por canal</CardTitle>
            <CardDescription className="text-meta">De onde cada lead chegou</CardDescription>
          </div>
          {maioriaSemOrigem && (
            <Badge variant="outline" className="shrink-0 text-micro">origem incompleta</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {total === 0 ? (
          <Vazio texto="Nenhum lead no período." />
        ) : (
          <div className="flex items-center gap-4">
            <Donut
              formatar={fmt}
              fatias={dados.map((d, i) => ({
                nome: d.canal,
                valor: d.total,
                cor: CHART_COLORS[i % CHART_COLORS.length],
              }))}
            />
            <ul className="min-w-0 flex-1 space-y-1.5">
              {dados.slice(0, 6).map((d, i) => (
                <li key={d.canal} className="flex items-center gap-2 text-meta">
                  <span className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="flex-1 truncate">{d.canal}</span>
                  <span className="tabular-nums font-medium">{fmt(d.total)}</span>
                  <span className="w-9 text-right tabular-nums text-muted-foreground">
                    {Math.round((d.total / total) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {maioriaSemOrigem && (
          <p className="mt-3 text-label leading-relaxed text-muted-foreground">
            A maioria dos leads está sem origem gravada. O número só fica confiável depois de
            padronizar a captação.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Desempenho por pessoa (admin) ────────────────────────────────────────────
export function GraficoPessoas({ dados }: { dados: LinhaPessoa[] }) {
  const comMovimento = dados.filter((d) => d.leads || d.abordagens || d.reunioes || d.vendas);
  const max = Math.max(1, ...comMovimento.flatMap((d) => [d.leads, d.abordagens, d.reunioes, d.vendas]));

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Desempenho por pessoa</CardTitle>
            <CardDescription className="text-meta">
              Leads recebidos, abordagens, reuniões e vendas no período
            </CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0 text-micro">só administradores</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        {comMovimento.length === 0 ? (
          <Vazio texto="Nenhuma atividade registrada por pessoa neste período." />
        ) : (
          <>
            {comMovimento.map((p) => (
              <BarRow
                key={p.pessoa}
                rotulo={p.pessoa}
                max={max}
                formatar={fmt}
                valores={[
                  { nome: "Leads", valor: p.leads, cor: CHART_COLORS[0] },
                  { nome: "Abordagens", valor: p.abordagens, cor: CHART_COLORS[1] },
                  { nome: "Reuniões", valor: p.reunioes, cor: CHART_COLORS[2] },
                  { nome: "Vendas", valor: p.vendas, cor: CHART_COLORS[3] },
                ]}
              />
            ))}
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2">
              {["Leads", "Abordagens", "Reuniões", "Vendas"].map((n, i) => (
                <span key={n} className="flex items-center gap-1.5 text-label text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: CHART_COLORS[i] }} />
                  {n}
                </span>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
