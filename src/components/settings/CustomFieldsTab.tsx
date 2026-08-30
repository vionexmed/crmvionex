import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function CustomFieldsTab({ orgId }: { orgId: string | null }) {
  const { toast } = useToast();
  const [fields, setFields] = useState<any[]>([]);
  const [entityType, setEntityType] = useState("contacts");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    field_key: "", field_label: "", field_type: "text", is_required: false,
    show_in_table: true, show_in_card: true, options: "",
  });

  const fetchFields = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase.from("custom_field_definitions").select("*").eq("org_id", orgId).order("field_order") as any;
    setFields(data || []);
  }, [orgId]);

  useEffect(() => { fetchFields(); }, [fetchFields]);

  const createField = async () => {
    if (!orgId || !form.field_key || !form.field_label) return;
    const opts = form.options ? form.options.split(",").map((o: string) => o.trim()).filter(Boolean) : [];
    await supabase.from("custom_field_definitions").insert({
      org_id: orgId, entity_type: entityType, field_key: form.field_key.toLowerCase().replace(/\s+/g, "_"),
      field_label: form.field_label, field_type: form.field_type, is_required: form.is_required,
      show_in_table: form.show_in_table, show_in_card: form.show_in_card, options: opts,
      field_order: fields.filter((f: any) => f.entity_type === entityType).length,
    } as any);
    setShowCreate(false);
    setForm({ field_key: "", field_label: "", field_type: "text", is_required: false, show_in_table: true, show_in_card: true, options: "" });
    fetchFields();
    toast({ title: "Campo criado" });
  };

  const deleteField = async (id: string) => {
    await supabase.from("custom_field_definitions").delete().eq("id", id);
    fetchFields();
    toast({ title: "Campo excluído" });
  };

  const entityFields = fields.filter((f: any) => f.entity_type === entityType);

  const fieldTypes: Record<string, string> = {
    text: "Texto", textarea: "Texto longo", number: "Número", currency: "Moeda",
    date: "Data", select: "Select", multi_select: "Multi-select", checkbox: "Checkbox",
    url: "URL", email: "Email", phone: "Telefone",
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Campos Customizados</CardTitle>
              <CardDescription>Adicione campos extras para suas entidades</CardDescription>
            </div>
            <Button size="sm" className="h-8 text-label" onClick={() => setShowCreate(true)}>
              <Plus className="mr-1 h-3 w-3" />Novo Campo
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger className="h-8 text-xs w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="contacts">Contatos</SelectItem>
              <SelectItem value="companies">Empresas</SelectItem>
              <SelectItem value="deals">Negócios</SelectItem>
            </SelectContent>
          </Select>

          {entityFields.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">Nenhum campo customizado para esta entidade</p>
          ) : (
            <div className="vx-table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-label">Campo</TableHead>
                    <TableHead className="text-label">Chave</TableHead>
                    <TableHead className="text-label">Tipo</TableHead>
                    <TableHead className="text-label">Obrigatório</TableHead>
                    <TableHead className="text-label">Tabela</TableHead>
                    <TableHead className="text-label">Card</TableHead>
                    <TableHead className="text-label" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entityFields.map((f: any) => (
                    <TableRow key={f.id}>
                      <TableCell className="text-xs font-medium">{f.field_label}</TableCell>
                      <TableCell className="text-label font-mono text-muted-foreground">{f.field_key}</TableCell>
                      <TableCell><Badge variant="outline" className="text-micro">{fieldTypes[f.field_type] || f.field_type}</Badge></TableCell>
                      <TableCell>{f.is_required ? "✓" : "—"}</TableCell>
                      <TableCell>{f.show_in_table ? "✓" : "—"}</TableCell>
                      <TableCell>{f.show_in_card ? "✓" : "—"}</TableCell>
                      <TableCell>
                        <button onClick={() => deleteField(f.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Novo Campo Customizado ({entityType})</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 grid-cols-2">
              <div className="space-y-1"><Label className="text-xs">Label</Label><Input value={form.field_label} onChange={(e) => setForm({ ...form, field_label: e.target.value, field_key: e.target.value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") })} className="h-8 text-xs" placeholder="Ex: Setor" /></div>
              <div className="space-y-1"><Label className="text-xs">Chave</Label><Input value={form.field_key} onChange={(e) => setForm({ ...form, field_key: e.target.value })} className="h-8 text-xs font-mono" /></div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={form.field_type} onValueChange={(v) => setForm({ ...form, field_type: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(fieldTypes).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {(form.field_type === "select" || form.field_type === "multi_select") && (
              <div className="space-y-1">
                <Label className="text-xs">Opções (separadas por vírgula)</Label>
                <Input value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} className="h-8 text-xs" placeholder="Opção 1, Opção 2, Opção 3" />
              </div>
            )}
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs"><Checkbox checked={form.is_required} onCheckedChange={(v) => setForm({ ...form, is_required: !!v })} />Obrigatório</label>
              <label className="flex items-center gap-2 text-xs"><Checkbox checked={form.show_in_table} onCheckedChange={(v) => setForm({ ...form, show_in_table: !!v })} />Tabela</label>
              <label className="flex items-center gap-2 text-xs"><Checkbox checked={form.show_in_card} onCheckedChange={(v) => setForm({ ...form, show_in_card: !!v })} />Card</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button size="sm" onClick={createField}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
