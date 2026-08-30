import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DealWithRelations } from "@/lib/api/deals";
import type { Database } from "@/integrations/supabase/types";
import { formatarMoeda } from "@/lib/formato";
import { indexarPorId } from "@/lib/utils";
import {
  FAIXAS_PREVISAO, calcularPrevisao, totaisDaPrevisao,
} from "@/lib/previsao";

type Stage = Database["public"]["Tables"]["pipeline_stages"]["Row"];


interface DealsForecastProps {
  deals: DealWithRelations[];
  stages: Stage[];
}

export function DealsForecast({ deals, stages }: DealsForecastProps) {
  // O cálculo mora em `lib/previsao`. Era duplicado aqui e em
  // `reports/ForecastReport`, com os mesmos limiares e nomes diferentes para a
  // mesma coisa -- "Comprometido" aqui, "Pessimista" lá.
  //
  // Sem `meses`: esta aba mostra todos os meses em que há negócio. O relatório
  // pede uma janela de 3.
  const buckets = useMemo(() => calcularPrevisao(deals), [deals]);
  const totals = useMemo(() => totaisDaPrevisao(buckets), [buckets]);

  const porEtapa = useMemo(() => indexarPorId(stages), [stages]);

  if (deals.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border py-20">
        <p className="text-muted-foreground">Nenhum negócio aberto para previsão</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Os rótulos e limiares vêm de FAIXAS_PREVISAO, a mesma lista que o
          relatório usa -- é o que impede as duas telas de voltarem a chamar o
          mesmo número por nomes diferentes. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {FAIXAS_PREVISAO.map((faixa) => (
          <Card key={faixa.chave}>
            <CardHeader>
              <CardTitle className="font-medium text-muted-foreground">
                {faixa.rotulo} <span className="text-xs">(≥{faixa.minimo}%)</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span className={`text-2xl font-bold ${faixa.cor}`}>
                {formatarMoeda(totals[faixa.chave])}
              </span>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader>
            <CardTitle className="font-medium text-muted-foreground">Valor em aberto</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold text-foreground">{formatarMoeda(totals.pipeline)}</span>
          </CardContent>
        </Card>
      </div>

      {/* Monthly breakdown */}
      <div className="space-y-3">
        {buckets.map((bucket) => (
          <Card key={bucket.chave}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="capitalize">{bucket.rotulo}</CardTitle>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-success" />
                    <span className="text-muted-foreground">Comprometido:</span>
                    <span className="font-semibold text-success">{formatarMoeda(bucket.comprometido)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-primary" />
                    <span className="text-muted-foreground">Provável:</span>
                    <span className="font-semibold text-primary">{formatarMoeda(bucket.provavel)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-muted-foreground" />
                    <span className="text-muted-foreground">Em aberto:</span>
                    <span className="font-semibold">{formatarMoeda(bucket.pipeline)}</span>
                  </div>
                </div>
              </div>

              {/* Stacked bar */}
              <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-muted">
                {bucket.pipeline > 0 && (
                  <>
                    <div
                      className="h-full bg-success float-left rounded-l-full"
                      style={{ width: `${(bucket.comprometido / bucket.pipeline) * 100}%` }}
                    />
                    <div
                      className="h-full bg-primary float-left"
                      style={{ width: `${((bucket.provavel - bucket.comprometido) / bucket.pipeline) * 100}%` }}
                    />
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {bucket.negocios.map((deal) => {
                  const stageName = (deal.stage_id && porEtapa.get(deal.stage_id)?.name) || "—";
                  return (
                    <div key={deal.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                      <div className="flex items-center gap-3">
                        <span className="font-medium">{deal.title}</span>
                        {deal.company && <span className="text-muted-foreground">· {deal.company.name}</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="secondary" className="text-xs">{stageName}</Badge>
                        <Badge variant="secondary" className="text-xs">{deal.probability || 0}%</Badge>
                        <span className="font-semibold text-primary">
                          {formatarMoeda(Number(deal.value) || 0, deal.currency || "BRL")}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
