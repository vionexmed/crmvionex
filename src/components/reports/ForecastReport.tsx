import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Deal, Stage, Profile,
  fmt, tooltipStyle,
} from "@/components/reports/types";

export function ForecastReport({ deals, stages, members, ownerFilter, pipelineFilter }: {
  deals: Deal[]; stages: Stage[]; members: Profile[]; ownerFilter: string; pipelineFilter: string;
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

  // Next 3 months buckets
  const buckets = useMemo(() => {
    const now = new Date();
    const result: { key: string; label: string; pessimist: number; realist: number; optimist: number; pipeline: number; deals: Deal[] }[] = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
      result.push({ key, label, pessimist: 0, realist: 0, optimist: 0, pipeline: 0, deals: [] });
    }
    openDeals.forEach((deal) => {
      const cd = deal.close_date ? new Date(deal.close_date) : new Date();
      const key = `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, "0")}`;
      const bucket = result.find((b) => b.key === key);
      if (!bucket) return;
      const val = Number(deal.value) || 0;
      const prob = Number(deal.probability) || 0;
      bucket.pipeline += val;
      if (prob >= 80) bucket.pessimist += val;
      if (prob >= 50) bucket.realist += val;
      if (prob >= 30) bucket.optimist += val;
      bucket.deals.push(deal);
    });
    return result;
  }, [openDeals]);

  const totals = buckets.reduce((a, b) => ({
    pessimist: a.pessimist + b.pessimist, realist: a.realist + b.realist,
    optimist: a.optimist + b.optimist, pipeline: a.pipeline + b.pipeline,
  }), { pessimist: 0, realist: 0, optimist: 0, pipeline: 0 });

  // Chart data
  const chartData = buckets.map((b) => ({
    month: b.label, Pessimista: b.pessimist, Realista: b.realist, Otimista: b.optimist,
  }));

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
        <Card><CardContent className="p-3"><p className="text-[9px] text-muted-foreground uppercase">Pessimista (≥80%)</p><p className="text-xl font-bold text-destructive">{fmt(totals.pessimist)}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-[9px] text-muted-foreground uppercase">Realista (≥50%)</p><p className="text-xl font-bold text-primary">{fmt(totals.realist)}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-[9px] text-muted-foreground uppercase">Otimista (≥30%)</p><p className="text-xl font-bold text-success">{fmt(totals.optimist)}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-[9px] text-muted-foreground uppercase">Valor em aberto</p><p className="text-xl font-bold">{fmt(totals.pipeline)}</p></CardContent></Card>
      </div>

      {/* Comparison chart */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Previsão de Receita — Próximos 3 Meses</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmt(v)} />
              <Bar dataKey="Pessimista" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Realista" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Otimista" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Monthly deal breakdown */}
      {buckets.map((bucket) => (
        <Card key={bucket.key}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm capitalize">{bucket.label}</CardTitle>
              <div className="flex items-center gap-3 text-[10px]">
                <span><span className="inline-block h-2 w-2 rounded-full bg-destructive mr-1" />Pess: {fmt(bucket.pessimist)}</span>
                <span><span className="inline-block h-2 w-2 rounded-full bg-primary mr-1" />Real: {fmt(bucket.realist)}</span>
                <span><span className="inline-block h-2 w-2 rounded-full bg-success mr-1" />Otim: {fmt(bucket.optimist)}</span>
              </div>
            </div>
            {/* Stacked bar */}
            {bucket.pipeline > 0 && (
              <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-muted flex">
                <div className="h-full bg-destructive" style={{ width: `${(bucket.pessimist / bucket.pipeline) * 100}%` }} />
                <div className="h-full bg-primary" style={{ width: `${((bucket.realist - bucket.pessimist) / bucket.pipeline) * 100}%` }} />
                <div className="h-full bg-success" style={{ width: `${((bucket.optimist - bucket.realist) / bucket.pipeline) * 100}%` }} />
              </div>
            )}
          </CardHeader>
          {bucket.deals.length > 0 && (
            <CardContent>
              <div className="space-y-1">
                {bucket.deals.sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)).map((deal) => {
                  const prob = Number(deal.probability) || 0;
                  const stageName = stages.find((s) => s.id === deal.stage_id)?.name || "—";
                  const scenario = prob >= 80 ? "Pessimista" : prob >= 50 ? "Realista" : prob >= 30 ? "Otimista" : "Fora";
                  const scenarioColor = prob >= 80 ? "text-destructive" : prob >= 50 ? "text-primary" : prob >= 30 ? "text-success" : "text-muted-foreground";
                  return (
                    <div key={deal.id} className="flex items-center justify-between rounded-md border p-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">{deal.title}</span>
                        <Badge variant="secondary" className="text-[8px] shrink-0">{stageName}</Badge>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className={`text-[8px] ${scenarioColor}`}>{scenario}</Badge>
                        <Select
                          value={String(prob)}
                          onValueChange={(v) => updateProbability(deal.id, Number(v))}
                        >
                          <SelectTrigger className="h-5 w-16 text-[9px] border-dashed"><SelectValue /></SelectTrigger>
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
