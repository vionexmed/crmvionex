import { useState, useMemo, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Download } from "lucide-react";
import { LIFECYCLE_LABELS, type LifecycleStage } from "@/lib/contact-options";
import { ATIVIDADE_ROTULO, type ActivityType } from "@/lib/atividade-tipos";
import {
  Deal, Contact, ActivityRow, Stage, Profile,
  fmt, downloadCSV,
} from "@/components/reports/types";

export function CustomReportBuilder({ deals, contacts, activities, stages, members, orgId }: {
  deals: Deal[]; contacts: Contact[]; activities: ActivityRow[]; stages: Stage[]; members: Profile[]; orgId: string;
}) {
  const { toast } = useToast();
  const [entity, setEntity] = useState<"deals" | "contacts" | "activities">("deals");
  const [savedReports, setSavedReports] = useState<{ id: string; name: string; entity: string; fields: string[]; filters: any }[]>([]);
  const [reportName, setReportName] = useState("");

  const fieldOptions: Record<string, { key: string; label: string }[]> = {
    deals: [
      { key: "title", label: "Título" }, { key: "value", label: "Valor" }, { key: "status", label: "Status" },
      { key: "stage", label: "Etapa" }, { key: "owner", label: "Dono" }, { key: "probability", label: "Prob %" },
      { key: "close_date", label: "Data Fechamento" }, { key: "loss_reason", label: "Motivo Perda" },
      { key: "created_at", label: "Criado em" },
    ],
    contacts: [
      { key: "name", label: "Nome" }, { key: "estagio", label: "Ciclo de vida" }, { key: "lead_score", label: "Score" },
      { key: "owner", label: "Dono" }, { key: "created_at", label: "Criado em" },
    ],
    activities: [
      { key: "title", label: "Título" }, { key: "type", label: "Tipo" }, { key: "user", label: "Responsável" },
      { key: "completed", label: "Concluída" }, { key: "created_at", label: "Criado em" },
    ],
  };

  const [selectedFields, setSelectedFields] = useState<string[]>(fieldOptions.deals.map((f) => f.key));

  const toggleField = (key: string) => {
    setSelectedFields((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  };

  useEffect(() => {
    setSelectedFields(fieldOptions[entity].map((f) => f.key));
  }, [entity]);

  // Load saved reports
  useEffect(() => {
    supabase.from("segments").select("*").eq("org_id", orgId).then(({ data }) => {
      // Reuse segments table with a convention
      const reports = (data || []).filter((s: any) => {
        try { return JSON.parse(JSON.stringify(s.filters))?.type === "custom_report"; } catch { return false; }
      }).map((s: any) => ({
        id: s.id, name: s.name,
        entity: (s.filters as any)?.entity || "deals",
        fields: (s.filters as any)?.fields || [],
        filters: s.filters,
      }));
      setSavedReports(reports);
    });
  }, [orgId]);

  // Generate table data
  const tableData = useMemo(() => {
    if (entity === "deals") {
      return deals.map((d) => ({
        title: d.title, value: fmt(Number(d.value) || 0), status: d.status || "—",
        stage: stages.find((s) => s.id === d.stage_id)?.name || "—",
        owner: members.find((m) => m.id === d.owner_id)?.name || "—",
        probability: `${d.probability || 0}%`, close_date: d.close_date || "—",
        loss_reason: d.loss_reason || "—", created_at: d.created_at?.slice(0, 10) || "—",
      }));
    } else if (entity === "contacts") {
      return contacts.map((c) => ({
        name: `${c.first_name} ${c.last_name || ""}`.trim(),
        // Estágio do ciclo de vida, com o rótulo que a interface usa. Lia a
        // coluna legada `status`, que mostra 4 grupos onde existem 6, e ainda
        // imprimia o valor cru em inglês.
        estagio: LIFECYCLE_LABELS[(c.lifecycle_stage || "lead") as LifecycleStage],
        lead_score: String(c.lead_score || 0),
        owner: members.find((m) => m.id === c.owner_id)?.name || "—",
        created_at: c.created_at?.slice(0, 10) || "—",
      }));
    } else {
      return activities.map((a) => ({
        title: a.title, type: ATIVIDADE_ROTULO[a.type as ActivityType] || a.type,
        user: members.find((m) => m.id === a.user_id)?.name || "—",
        completed: a.completed_at ? "Sim" : "Não",
        created_at: a.created_at?.slice(0, 10) || "—",
      }));
    }
  }, [entity, deals, contacts, activities, stages, members, selectedFields]);

  const exportCSV = () => {
    const filtered = tableData.map((row) => {
      const obj: Record<string, any> = {};
      selectedFields.forEach((f) => { obj[fieldOptions[entity].find((fo) => fo.key === f)?.label || f] = (row as any)[f]; });
      return obj;
    });
    downloadCSV(filtered, `relatorio-${entity}`);
    toast({ title: "CSV exportado!" });
  };

  const saveReport = async () => {
    if (!reportName.trim()) { toast({ title: "Informe um nome", variant: "destructive" }); return; }
    const { error } = await supabase.from("segments").insert({
      org_id: orgId, name: reportName,
      filters: { type: "custom_report", entity, fields: selectedFields } as any,
    });
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Relatório salvo!" });
    setReportName("");
  };

  const loadReport = (r: typeof savedReports[0]) => {
    setEntity(r.entity as any);
    setSelectedFields(r.fields);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <Label className="text-label">Entidade</Label>
          <Select value={entity} onValueChange={(v) => setEntity(v as any)}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="deals">Negócios</SelectItem>
              <SelectItem value="contacts">Contatos</SelectItem>
              <SelectItem value="activities">Atividades</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-label">Campos</Label>
          <div className="flex flex-wrap gap-1 mt-1">
            {fieldOptions[entity].map((f) => (
              <Badge
                key={f.key}
                variant={selectedFields.includes(f.key) ? "default" : "outline"}
                className="cursor-pointer text-micro"
                onClick={() => toggleField(f.key)}
              >
                {f.label}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex gap-1 items-end ml-auto">
          <Input
            placeholder="Nome do relatório"
            value={reportName}
            onChange={(e) => setReportName(e.target.value)}
            className="h-8 w-40 text-xs"
          />
          <Button size="sm" className="h-8 text-xs" onClick={saveReport}>Salvar</Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={exportCSV}>
            <Download className="h-3 w-3 mr-1" />CSV
          </Button>
        </div>
      </div>

      {/* Saved reports */}
      {savedReports.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          <span className="text-label text-muted-foreground mr-1">Salvos:</span>
          {savedReports.map((r) => (
            <Badge key={r.id} variant="secondary" className="cursor-pointer text-micro" onClick={() => loadReport(r)}>
              {r.name}
            </Badge>
          ))}
        </div>
      )}

      {/* Results table */}
      <Card>
        <CardContent className="p-0">
          <div className="vx-table max-h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  {selectedFields.map((f) => (
                    <TableHead key={f} className="text-label whitespace-nowrap">
                      {fieldOptions[entity].find((fo) => fo.key === f)?.label || f}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableData.slice(0, 100).map((row, i) => (
                  <TableRow key={i}>
                    {selectedFields.map((f) => (
                      <TableCell key={f} className="text-xs whitespace-nowrap">{(row as any)[f]}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {tableData.length > 100 && (
            <p className="text-label text-muted-foreground text-center py-2">Mostrando 100 de {tableData.length} registros. Exporte CSV para ver todos.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
