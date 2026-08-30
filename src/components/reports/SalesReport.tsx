import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  TrendingUp, XCircle, Download, Clock, Trophy, Target,
} from "lucide-react";
import {
  Deal, Stage, Profile, Company,
  fmt, pct, CHART_COLORS, tooltipStyle, MONTHS_PT,
  downloadCSV,
} from "@/components/reports/types";

export function SalesReport({ deals, stages, members, companies }: {
  deals: Deal[]; stages: Stage[]; members: Profile[]; companies: Company[];
}) {
  const [groupBy, setGroupBy] = useState<"stage" | "owner" | "company" | "month">("stage");
  const { toast } = useToast();

  const wonDeals = deals.filter((d) => d.status === "won");
  const lostDeals = deals.filter((d) => d.status === "lost");
  const openDeals = deals.filter((d) => d.status === "open");
  const totalClosed = wonDeals.length + lostDeals.length;
  const winRate = pct(wonDeals.length, totalClosed);
  const wonValue = wonDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const avgTicket = wonDeals.length > 0 ? wonValue / wonDeals.length : 0;

  // Avg cycle
  const avgCycle = useMemo(() => {
    if (wonDeals.length === 0) return 0;
    const total = wonDeals.reduce((s, d) => {
      const c = new Date(d.created_at!); const u = d.updated_at ? new Date(d.updated_at) : new Date();
      return s + Math.floor((u.getTime() - c.getTime()) / 86400000);
    }, 0);
    return Math.round(total / wonDeals.length);
  }, [wonDeals]);

  // Funnel
  const funnelData = useMemo(() => stages.map((s, i) => {
    const count = deals.filter((d) => d.stage_id === s.id && d.status === "open").length;
    const val = deals.filter((d) => d.stage_id === s.id && d.status === "open").reduce((sum, d) => sum + (Number(d.value) || 0), 0);
    return { name: s.name, count, value: val, color: s.color || CHART_COLORS[i % CHART_COLORS.length] };
  }), [stages, deals]);

  // Waterfall
  const waterfallData = useMemo(() => [
    { name: "Abertos", value: openDeals.length, fill: "hsl(var(--primary))" },
    { name: "Ganhos", value: wonDeals.length, fill: "hsl(var(--success))" },
    { name: "Perdidos", value: lostDeals.length, fill: "hsl(var(--destructive))" },
  ], [openDeals, wonDeals, lostDeals]);

  // Loss reasons
  const lossReasons = useMemo(() => {
    const map = new Map<string, number>();
    lostDeals.forEach((d) => { const r = d.loss_reason?.trim() || "Não informado"; map.set(r, (map.get(r) || 0) + 1); });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [lostDeals]);

  // Grouped table
  const groupedData = useMemo(() => {
    const groups: Record<string, { label: string; deals: Deal[]; won: number; lost: number; value: number }> = {};
    deals.forEach((d) => {
      let key: string;
      let label: string;
      if (groupBy === "stage") {
        key = d.stage_id || "none";
        label = stages.find((s) => s.id === d.stage_id)?.name || "Sem etapa";
      } else if (groupBy === "owner") {
        key = d.owner_id || "none";
        label = members.find((m) => m.id === d.owner_id)?.name || members.find((m) => m.id === d.owner_id)?.email || "Sem dono";
      } else if (groupBy === "company") {
        key = d.company_id || "none";
        label = companies.find((c) => c.id === d.company_id)?.name || "Sem empresa";
      } else {
        const date = d.created_at ? new Date(d.created_at) : new Date();
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        label = `${MONTHS_PT[date.getMonth()]}/${date.getFullYear()}`;
      }
      if (!groups[key]) groups[key] = { label, deals: [], won: 0, lost: 0, value: 0 };
      groups[key].deals.push(d);
      if (d.status === "won") { groups[key].won++; groups[key].value += Number(d.value) || 0; }
      if (d.status === "lost") groups[key].lost++;
    });
    return Object.values(groups).sort((a, b) => b.value - a.value);
  }, [deals, groupBy, stages, members, companies]);

  // Owner performance
  const ownerStats = useMemo(() =>
    members.map((m) => {
      const md = deals.filter((d) => d.owner_id === m.id);
      const mw = md.filter((d) => d.status === "won");
      const ml = md.filter((d) => d.status === "lost");
      const mc = mw.length + ml.length;
      return {
        name: m.name || m.email || "—", total: md.length, won: mw.length, lost: ml.length,
        winRate: pct(mw.length, mc), value: mw.reduce((s, d) => s + (Number(d.value) || 0), 0),
      };
    }).filter((m) => m.total > 0).sort((a, b) => b.value - a.value),
    [members, deals]
  );

  // Conversion between stages
  const stageConversion = useMemo(() => stages.map((s, i) => {
    const count = deals.filter((d) => d.stage_id === s.id).length;
    const prevCount = i > 0 ? deals.filter((d) => d.stage_id === stages[i - 1].id).length : count;
    return { name: s.name, rate: i === 0 ? 100 : pct(count, prevCount) };
  }), [stages, deals]);

  // Avg time per stage
  const avgTimePerStage = useMemo(() => stages.map((s) => {
    const sd = deals.filter((d) => d.stage_id === s.id);
    if (sd.length === 0) return { name: s.name, days: 0 };
    const total = sd.reduce((sum, d) => {
      const c = new Date(d.created_at!); const u = d.updated_at ? new Date(d.updated_at) : new Date();
      return sum + Math.floor((u.getTime() - c.getTime()) / 86400000);
    }, 0);
    return { name: s.name, days: Math.round(total / sd.length) };
  }), [stages, deals]);

  const exportDealsCSV = () => {
    downloadCSV(deals.map((d) => ({
      Título: d.title, Valor: d.value, Status: d.status,
      Etapa: stages.find((s) => s.id === d.stage_id)?.name || "",
      Dono: members.find((m) => m.id === d.owner_id)?.name || "",
      Probabilidade: d.probability, "Data Fechamento": d.close_date,
      "Motivo Perda": d.loss_reason || "", Criado: d.created_at,
    })), "relatorio-vendas");
    toast({ title: "CSV exportado!" });
  };

  return (
    <div className="space-y-4 mt-4">
      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        {[
          { label: "Win Rate", value: `${winRate}%`, icon: Trophy, color: "text-primary" },
          { label: "Ganhos", value: `${wonDeals.length}`, sub: fmt(wonValue), icon: TrendingUp, color: "text-success" },
          { label: "Perdidos", value: `${lostDeals.length}`, icon: XCircle, color: "text-destructive" },
          { label: "Ticket Médio", value: fmt(avgTicket), icon: Target, color: "text-primary" },
          { label: "Ciclo Médio", value: `${avgCycle} dias`, icon: Clock, color: "text-warning" },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-3 flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-muted`}>
                <k.icon className={`h-4 w-4 ${k.color}`} />
              </div>
              <div>
                <p className="text-lg font-bold">{k.value}</p>
                <p className="text-micro text-muted-foreground uppercase">{k.label}</p>
                {k.sub && <p className="text-micro text-muted-foreground">{k.sub}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Waterfall */}
        <Card>
          <CardHeader><CardTitle>Waterfall de Negócios</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={waterfallData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {waterfallData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Funnel */}
        <Card>
          <CardHeader><CardTitle>Negócios por etapa</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {funnelData.map((s) => {
                const max = Math.max(...funnelData.map((f) => f.value), 1);
                return (
                  <div key={s.name}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-label font-medium">{s.name}</span>
                      <span className="text-label text-muted-foreground">{s.count} · {fmt(s.value)}</span>
                    </div>
                    <div className="h-4 rounded bg-muted overflow-hidden">
                      <div className="h-full rounded" style={{ width: `${Math.max((s.value / max) * 100, 2)}%`, backgroundColor: s.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Conversion rates */}
        <Card>
          <CardHeader><CardTitle>Taxa de conversão por etapa</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stageConversion}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={[0, 100]} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v}%`} />
                <Bar dataKey="rate" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Avg time per stage */}
        <Card>
          <CardHeader><CardTitle>Tempo médio por etapa (dias)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={avgTimePerStage} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v} dias`} />
                <Bar dataKey="days" fill="hsl(var(--warning))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Loss reasons */}
        <Card>
          <CardHeader><CardTitle>Motivos de Perda</CardTitle></CardHeader>
          <CardContent>
            {lossReasons.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={lossReasons} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2}>
                    {lossReasons.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">Nenhuma perda registrada</div>}
          </CardContent>
        </Card>
      </div>

      {/* Grouped deals table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Negócios Agrupados</CardTitle>
            <div className="flex gap-2">
              <Select value={groupBy} onValueChange={(v) => setGroupBy(v as any)}>
                <SelectTrigger className="h-7 w-32 text-label"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stage">Por etapa</SelectItem>
                  <SelectItem value="owner">Por Dono</SelectItem>
                  <SelectItem value="company">Por Empresa</SelectItem>
                  <SelectItem value="month">Por Mês</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-7 text-label" onClick={exportDealsCSV}>
                <Download className="h-3 w-3 mr-1" />CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="vx-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-label">Grupo</TableHead>
                  <TableHead className="text-label text-center">Total</TableHead>
                  <TableHead className="text-label text-center">Ganhos</TableHead>
                  <TableHead className="text-label text-center">Perdidos</TableHead>
                  <TableHead className="text-label text-center">Win Rate</TableHead>
                  <TableHead className="text-label text-right">Valor Ganho</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupedData.map((g) => (
                  <TableRow key={g.label}>
                    <TableCell className="text-xs font-medium">{g.label}</TableCell>
                    <TableCell className="text-xs text-center">{g.deals.length}</TableCell>
                    <TableCell className="text-xs text-center text-success">{g.won}</TableCell>
                    <TableCell className="text-xs text-center text-destructive">{g.lost}</TableCell>
                    <TableCell className="text-xs text-center">
                      <Badge variant={pct(g.won, g.won + g.lost) >= 50 ? "default" : "secondary"} className="text-micro">
                        {pct(g.won, g.won + g.lost)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-right font-medium">{fmt(g.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Owner performance */}
      {ownerStats.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Performance por Vendedor</CardTitle></CardHeader>
          <CardContent>
            <div className="vx-table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-label">Vendedor</TableHead>
                    <TableHead className="text-label text-center">Total</TableHead>
                    <TableHead className="text-label text-center">Ganhos</TableHead>
                    <TableHead className="text-label text-center">Perdidos</TableHead>
                    <TableHead className="text-label text-center">Win Rate</TableHead>
                    <TableHead className="text-label text-right">Receita</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ownerStats.map((o) => (
                    <TableRow key={o.name}>
                      <TableCell className="text-xs font-medium">{o.name}</TableCell>
                      <TableCell className="text-xs text-center">{o.total}</TableCell>
                      <TableCell className="text-xs text-center text-success">{o.won}</TableCell>
                      <TableCell className="text-xs text-center text-destructive">{o.lost}</TableCell>
                      <TableCell className="text-xs text-center">
                        <Badge variant={o.winRate >= 50 ? "default" : "secondary"} className="text-micro">{o.winRate}%</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-right font-medium">{fmt(o.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
