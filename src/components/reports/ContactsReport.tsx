import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
} from "recharts";
import { Download } from "lucide-react";
import { LIFECYCLE_LABELS, type LifecycleStage } from "@/lib/contact-options";
import {
  Contact, Profile,
  pct, CHART_COLORS, tooltipStyle, MONTHS_PT,
  downloadCSV,
} from "@/components/reports/types";

export function ContactsReport({ contacts, members }: { contacts: Contact[]; members: Profile[] }) {
  // Monthly growth (last 12 months)
  const monthlyGrowth = useMemo(() => {
    const now = new Date();
    const data: { month: string; novos: number; total: number }[] = [];
    let cumulative = 0;
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const newInMonth = contacts.filter((c) => {
        if (!c.created_at) return false;
        const cd = new Date(c.created_at);
        return cd >= d && cd < nextMonth;
      }).length;
      cumulative += newInMonth;
      data.push({ month: MONTHS_PT[d.getMonth()], novos: newInMonth, total: cumulative });
    }
    return data;
  }, [contacts]);

  /**
   * Por estágio do CICLO DE VIDA, não pela coluna legada `status`.
   *
   * `status` tem 4 valores e `lifecycle_stage` tem 6, e o gatilho que
   * sincroniza as duas mapeia COM PERDA: `contacted` colapsa em `lead`, e
   * `opportunity` colapsa em `prospect`. Este gráfico mostrava quatro fatias
   * onde a tela de Contatos mostra seis -- "Contatado" e "Em negociação"
   * simplesmente não existiam aqui.
   *
   * Os rótulos também eram três em inglês ("Lead", "Prospect", "Churned") numa
   * interface em português.
   */
  const byStatus = useMemo(() => {
    const map = new Map<LifecycleStage, number>();
    for (const c of contacts) {
      const estagio = (c.lifecycle_stage || "lead") as LifecycleStage;
      map.set(estagio, (map.get(estagio) || 0) + 1);
    }
    // Ordem do avanço, não ordem de aparição: a fatia maior mudava de cor
    // conforme o dado, porque a cor vem do índice.
    return (Object.keys(LIFECYCLE_LABELS) as LifecycleStage[])
      .filter((e) => map.has(e))
      .map((e) => ({ name: LIFECYCLE_LABELS[e], value: map.get(e)! }));
  }, [contacts]);

  const totalCustomers = contacts.filter((c) => c.lifecycle_stage === "customer").length;

  /**
   * Conversão lead → cliente.
   *
   * O denominador era `lead + prospect + customer`, ou seja, TODOS menos os
   * descartados -- e descartado é justamente quem entrou e não converteu.
   * Tirá-lo da conta inflava a taxa: dez contatos, um cliente e cinco
   * descartados davam 20% em vez de 10%.
   *
   * Todo contato entra como lead, então o denominador honesto é o total.
   */
  const conversionRate = pct(totalCustomers, contacts.length);

  // By owner
  const byOwner = useMemo(() =>
    members.map((m) => ({
      name: m.name || m.email || "—",
      count: contacts.filter((c) => c.owner_id === m.id).length,
    })).filter((m) => m.count > 0).sort((a, b) => b.count - a.count),
    [members, contacts]
  );

  const exportCSV = () => {
    downloadCSV(contacts.map((c) => ({
      Nome: `${c.first_name} ${c.last_name || ""}`.trim(),
      "Ciclo de vida": LIFECYCLE_LABELS[(c.lifecycle_stage || "lead") as LifecycleStage], Score: c.lead_score,
      Dono: members.find((m) => m.id === c.owner_id)?.name || "",
      Criado: c.created_at,
    })), "relatorio-contatos");
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="grid gap-3 grid-cols-3">
        <Card><CardContent className="p-3 text-center"><p className="text-2xl font-bold">{contacts.length}</p><p className="text-[9px] text-muted-foreground uppercase">Total Contatos</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-2xl font-bold text-success">{totalCustomers}</p><p className="text-[9px] text-muted-foreground uppercase">Clientes</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-2xl font-bold text-primary">{conversionRate}%</p><p className="text-[9px] text-muted-foreground uppercase">Lead → Cliente</p></CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Crescimento Mensal</CardTitle>
              <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={exportCSV}><Download className="h-3 w-3 mr-1" />CSV</Button>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={monthlyGrowth}>
                <defs>
                  <linearGradient id="contactGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="total" stroke="hsl(var(--primary))" fill="url(#contactGrad)" strokeWidth={2} name="Cumulativo" />
                <Bar dataKey="novos" fill="hsl(var(--success))" radius={[3, 3, 0, 0]} name="Novos" />
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Distribuição por Status</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {byStatus.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {byOwner.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Contatos por Dono</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byOwner}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Contatos" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
