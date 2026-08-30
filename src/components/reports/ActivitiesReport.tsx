import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { RoscaComLegenda } from "@/components/dashboard/svg/RoscaComLegenda";
import { BarrasAgrupadas } from "@/components/dashboard/svg/BarrasAgrupadas";
import { formatarNumero } from "@/lib/formato";
import { Download } from "lucide-react";
import { ATIVIDADE_ROTULO, type ActivityType } from "@/lib/atividade-tipos";
import {
  ActivityRow, Profile,
  pct, CHART_COLORS,
  downloadCSV,
} from "@/components/reports/types";

export function ActivitiesReport({ activities, members }: { activities: ActivityRow[]; members: Profile[] }) {

  // By type donut
  const byType = useMemo(() => {
    const map: Record<string, number> = {};
    activities.forEach((a) => { map[a.type] = (map[a.type] || 0) + 1; });
    return Object.entries(map).map(([type, count]) => ({ name: ATIVIDADE_ROTULO[type as ActivityType] || type, value: count }));
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
          <CardHeader><CardTitle>Atividades por Tipo</CardTitle></CardHeader>
          <CardContent>
            {byType.length > 0 ? (
              <RoscaComLegenda
                formatar={formatarNumero}
                fatias={byType.map((t, i) => ({
                  nome: t.name,
                  valor: t.value,
                  cor: CHART_COLORS[i % CHART_COLORS.length],
                }))}
              />
            ) : (
              <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">
                Nenhuma atividade no período
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Atividades por Vendedor</CardTitle></CardHeader>
          <CardContent>
            {/* Barras horizontais em vez do gráfico vertical do recharts: o
                nome de cada vendedor era rótulo do eixo X, e com mais de quatro
                nomes o recharts os rotacionava ou cortava. */}
            <BarrasAgrupadas
              linhas={userActivity}
              rotulo={(u) => u.name}
              formatar={formatarNumero}
              vazio="Nenhuma atividade registrada por vendedor"
              series={[
                { nome: "Ligação", cor: CHART_COLORS[0], valor: (u) => u.call },
                { nome: "E-mail", cor: CHART_COLORS[1], valor: (u) => u.email },
                { nome: "Reunião", cor: CHART_COLORS[2], valor: (u) => u.meeting },
                { nome: "Nota", cor: CHART_COLORS[3], valor: (u) => u.note },
                { nome: "Tarefa", cor: CHART_COLORS[4], valor: (u) => u.task },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {/* Detailed table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Comparativo por Vendedor</CardTitle>
            <Button variant="outline" size="sm" className="h-8 text-label" onClick={exportCSV}><Download className="h-3 w-3 mr-1" />CSV</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="vx-table">
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
