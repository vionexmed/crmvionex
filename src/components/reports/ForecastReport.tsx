import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { FAIXAS_PREVISAO, calcularPrevisao, totaisDaPrevisao } from "@/lib/previsao";
import { BarrasAgrupadas } from "@/components/dashboard/svg/BarrasAgrupadas";
import {
  Deal, Stage,
  fmt,
} from "@/components/reports/types";

export function ForecastReport({ deals, stages, ownerFilter, pipelineFilter }: {
  deals: Deal[]; stages: Stage[]; ownerFilter: string; pipelineFilter: string;
}) {
  const { toast } = useToast();

  const openDeals = useMemo(() => {
    let list = deals.filter((d) => d.status === "open");
    if (ownerFilter !== "all") list = list.filter((d) => d.owner_id === ownerFilter);
    if (pipelineFilter !== "all") {
      const pipeStages = stages.filter((s) => s.pipeline_id === pipelineFilter).map((s) => s.id);
      list = list.filter((d) => d.stage_id && pipeStages.includes(d.stage_id));
    }
    return list;
  }, [deals, ownerFilter, pipelineFilter, stages]);

  // O cálculo mora em `lib/previsao`. Era duplicado aqui e em
  // `crm/DealsForecast`, com os mesmos limiares e nomes diferentes: a faixa
  // ≥80% se chamava "Pessimista" aqui e "Comprometido" lá, e -- pior -- era
  // pintada de VERMELHO aqui e de VERDE lá. O mesmo número, lido como problema
  // numa tela e como conquista na outra.
  const buckets = useMemo(() => calcularPrevisao(openDeals, { meses: 3 }), [openDeals]);
  const totals = useMemo(() => totaisDaPrevisao(buckets), [buckets]);

  // Chart data

  // Inline probability edit
  const updateProbability = async (dealId: string, newProb: number) => {
    const { error } = await supabase.from("deals").update({ probability: newProb }).eq("id", dealId);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Probabilidade atualizada" });
    // Update local state
    const idx = deals.findIndex((d) => d.id === dealId);
    if (idx >= 0) deals[idx].probability = newProb;
  };

  return (
    <div className="space-y-4 mt-4">
      {/* Summary */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {FAIXAS_PREVISAO.map((faixa) => (
          <Card key={faixa.chave}>
            <CardContent className="p-3">
              <p className="text-label uppercase text-muted-foreground">
                {faixa.rotulo} (≥{faixa.minimo}%)
              </p>
              <p className={`text-xl font-bold ${faixa.cor}`}>{fmt(totals[faixa.chave])}</p>
            </CardContent>
          </Card>
        ))}
        <Card><CardContent className="p-3"><p className="text-label text-muted-foreground uppercase">Valor em aberto</p><p className="text-xl font-bold">{fmt(totals.pipeline)}</p></CardContent></Card>
      </div>

      {/* Comparison chart */}
      <Card>
        <CardHeader><CardTitle>Previsão de Receita — Próximos 3 Meses</CardTitle></CardHeader>
        <CardContent>
          {/* Faixa, cor e rótulo saem de FAIXAS_PREVISAO -- a mesma lista dos
              cartões acima e do selo por negócio abaixo, para que as três
              leituras da mesma coisa não possam divergir. */}
          <BarrasAgrupadas
            linhas={buckets}
            rotulo={(b) => b.rotulo}
            formatar={fmt}
            vazio="Nenhum negócio aberto nos próximos três meses"
            series={FAIXAS_PREVISAO.map((faixa) => ({
              nome: faixa.rotulo,
              cor: faixa.corCss,
              valor: (b: (typeof buckets)[number]) => b[faixa.chave],
            }))}
          />
        </CardContent>
      </Card>

      {/* Monthly deal breakdown */}
      {buckets.map((bucket) => (
        <Card key={bucket.chave}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="capitalize">{bucket.rotulo}</CardTitle>
              <div className="flex items-center gap-3 text-label">
                {FAIXAS_PREVISAO.map((faixa) => (
                  <span key={faixa.chave}>
                    <span
                      className="mr-1 inline-block h-2 w-2 rounded-full"
                      style={{ background: faixa.corCss }}
                    />
                    {faixa.rotulo}: {fmt(bucket[faixa.chave])}
                  </span>
                ))}
              </div>
            </div>
            {/* Stacked bar */}
            {bucket.pipeline > 0 && (
              <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-muted flex">
                <div className="h-full bg-success" style={{ width: `${(bucket.comprometido / bucket.pipeline) * 100}%` }} />
                <div className="h-full bg-primary" style={{ width: `${((bucket.provavel - bucket.comprometido) / bucket.pipeline) * 100}%` }} />
                <div className="h-full bg-warning" style={{ width: `${((bucket.possivel - bucket.provavel) / bucket.pipeline) * 100}%` }} />
              </div>
            )}
          </CardHeader>
          {bucket.negocios.length > 0 && (
            <CardContent>
              <div className="space-y-1">
                {/* Cópia antes de ordenar: `.sort()` é in place, e `bucket.negocios`
                    vem de um useMemo -- ordenar aqui muta o resultado
                    memoizado durante o render. */}
                {[...bucket.negocios].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)).map((deal) => {
                  const prob = Number(deal.probability) || 0;
                  const stageName = stages.find((s) => s.id === deal.stage_id)?.name || "—";
                  // A faixa do negócio sai da MESMA lista dos cartões e das
                  // barras. Antes era um terceiro encadeamento de ternários com
                  // os limiares repetidos e as cores invertidas.
                  const faixa = FAIXAS_PREVISAO.find((f) => prob >= f.minimo);
                  const scenario = faixa?.rotulo ?? "Fora da previsão";
                  const scenarioColor = faixa?.cor ?? "text-muted-foreground";
                  return (
                    <div key={deal.id} className="flex items-center justify-between rounded-md border p-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">{deal.title}</span>
                        <Badge variant="secondary" className="text-label shrink-0">{stageName}</Badge>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className={`text-label ${scenarioColor}`}>{scenario}</Badge>
                        <Select
                          value={String(prob)}
                          onValueChange={(v) => updateProbability(deal.id, Number(v))}
                        >
                          <SelectTrigger className="h-5 w-16 text-label border-dashed"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((p) => (
                              <SelectItem key={p} value={String(p)}>{p}%</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="font-bold text-primary">{fmt(Number(deal.value) || 0)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
