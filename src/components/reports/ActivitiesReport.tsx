import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { Download } from "lucide-react";
import {
  ActivityRow, Profile,
  pct, CHART_COLORS, tooltipStyle,
  downloadCSV,
} from "@/components/reports/types";

export function ActivitiesReport({ activities, members }: { activities: ActivityRow[]; members: Profile[] }) {
  const typeLabels: Record<string, string> = { call: "Ligação", email: "Email", meeting: "Reunião", note: "Nota", task: "Tarefa" };

  // By type donut
  const byType = useMemo(() => {
    const map: Record<string, number> = {};
    activities.forEach((a) => { map[a.type] = (map[a.type] || 0) + 1; });
    return Object.entries(map).map(([type, count]) => ({ name: typeLabels[type] || type, value: count }));
  }, [activities]);

  type UserActivityRow = { name: string; total: number; call: number; email: number; meeting: number; note: number; task: number };
  // Per-user per-type table
  const userActivity = useMemo<UserActivityRow[]>(() => {
    return members.map((m) => {
      const ma = activities.filter((a) => a.user_id === m.id);
      return {
        name: m.name || m.email || "—", total: ma.length,
        call: ma.filter((a) => a.type === "call").length,
        email: ma.filter((a) => a.type === "email").length,
        meeting: ma.filter((a) => a.type === "meeting").length,
        note: ma.filter((a) => a.type === "note").length,
        task: ma.filter((a) => a.type === "task").length,
      };
    }).filter((m) => m.total > 0).sort((a, b) => b.total - a.total);
  }, [members, activities]);

  // Completion rate
  const completed = activities.filter((a) => a.completed_at).length;
  const completionRate = pct(completed, activities.length);

  const exportCSV = () => {
    downloadCSV(userActivity.map((u) => ({
      Vendedor: u.name, Total: u.total,
      Ligações: u.call, Emails: u.email, Reuniões: u.meeting, Notas: u.note, Tarefas: u.task,
    })), "relatorio-atividades");
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="grid gap-3 grid-cols-3">
        <Card><CardContent className="p-3 text-center"><p className="text-2xl font-bold">{activities.length}</p><p className="text-micro text-muted-foreground uppercase">Total Atividades</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-2xl font-bold text-success">{completed}</p><p className="text-micro text-muted-foreground uppercase">Concluídas</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-2xl font-bold text-primary">{completionRate}%</p><p className="text-micro text-muted-foreground uppercase">Taxa Conclusão</p></CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Atividades por Tipo</CardTitle></CardHeader>
          <CardContent>
            {byType.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={byType} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {byType.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">Sem dados</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Atividades por Vendedor</CardTitle></CardHeader>
          <CardContent>
            {userActivity.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={userActivity}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="call" name="Ligação" stackId="a" fill={CHART_COLORS[0]} />
                  <Bar dataKey="email" name="Email" stackId="a" fill={CHART_COLORS[1]} />
                  <Bar dataKey="meeting" name="Reunião" stackId="a" fill={CHART_COLORS[2]} />
                  <Bar dataKey="note" name="Nota" stackId="a" fill={CHART_COLORS[3]} />
                  <Bar dataKey="task" name="Tarefa" stackId="a" fill={CHART_COLORS[4]} radius={[4, 4, 0, 0]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">Sem dados</div>}
          </CardContent>
        </Card>
      </div>

      {/* Detailed table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Comparativo por Vendedor</CardTitle>
            <Button variant="outline" size="sm" className="h-7 text-label" onClick={exportCSV}><Download className="h-3 w-3 mr-1" />CSV</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-label">Vendedor</TableHead>
                  <TableHead className="text-label text-center">Ligações</TableHead>
                  <TableHead className="text-label text-center">Emails</TableHead>
                  <TableHead className="text-label text-center">Reuniões</TableHead>
                  <TableHead className="text-label text-center">Notas</TableHead>
                  <TableHead className="text-label text-center">Tarefas</TableHead>
                  <TableHead className="text-label text-center">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {userActivity.map((u) => (
                  <TableRow key={u.name}>
                    <TableCell className="text-xs font-medium">{u.name}</TableCell>
                    <TableCell className="text-xs text-center">{u.call}</TableCell>
                    <TableCell className="text-xs text-center">{u.email}</TableCell>
                    <TableCell className="text-xs text-center">{u.meeting}</TableCell>
                    <TableCell className="text-xs text-center">{u.note}</TableCell>
                    <TableCell className="text-xs text-center">{u.task}</TableCell>
                    <TableCell className="text-xs text-center font-bold">{u.total}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
