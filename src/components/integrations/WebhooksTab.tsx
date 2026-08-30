import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Trash2, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type WebhookRow = {
  id: string; org_id: string; name: string; url: string; events: string[];
  secret: string | null; is_active: boolean; created_at: string | null;
  last_triggered_at: string | null; failure_count: number;
};

const WEBHOOK_EVENTS = [
  { value: "deal.won", label: "Negócio Ganho" },
  { value: "deal.lost", label: "Negócio Perdido" },
  { value: "deal.stage_changed", label: "Mudança de Stage" },
  { value: "contact.created", label: "Contato Criado" },
  { value: "deal.created", label: "Negócio Criado" },
  { value: "activity.created", label: "Atividade Criada" },
];

export function WebhooksTab({ orgId }: { orgId: string | null }) {
  const { toast } = useToast();
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", events: [] as string[], secret: "" });

  const fetchWebhooks = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase.from("webhooks").select("*").eq("org_id", orgId) as any;
    setWebhooks(data || []);
  }, [orgId]);

  useEffect(() => { fetchWebhooks(); }, [fetchWebhooks]);

  const createWebhook = async () => {
    if (!orgId || !form.name || !form.url) return;
    await supabase.from("webhooks").insert({
      org_id: orgId, name: form.name, url: form.url, events: form.events,
      secret: form.secret || null,
    } as any);
    toast({ title: "Webhook criado" });
    setShowCreate(false);
    setForm({ name: "", url: "", events: [], secret: "" });
    fetchWebhooks();
  };

  const deleteWebhook = async (id: string) => {
    await supabase.from("webhooks").delete().eq("id", id);
    toast({ title: "Webhook excluído" });
    fetchWebhooks();
  };

  const toggleWebhook = async (id: string, active: boolean) => {
    await supabase.from("webhooks").update({ is_active: active } as any).eq("id", id);
    fetchWebhooks();
  };

  const inboundUrl = orgId
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbound-webhook`
    : "";

  return (
    <div className="space-y-4">
      {/* Outbound Webhooks */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Webhooks de Saída</CardTitle>
              <CardDescription>Envie notificações para URLs externas quando eventos ocorrerem</CardDescription>
            </div>
            <Button size="sm" className="h-7 text-label" onClick={() => setShowCreate(true)}>
              <Plus className="mr-1 h-3 w-3" />Novo Webhook
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {webhooks.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">Nenhum webhook configurado</p>
          ) : (
            <div className="space-y-2">
              {webhooks.map((wh) => (
                <div key={wh.id} className="flex items-center justify-between rounded-md border border-border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{wh.name}</span>
                      <Badge variant={wh.is_active ? "default" : "secondary"} className="text-micro">
                        {wh.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                    <p className="text-label text-muted-foreground truncate">{wh.url}</p>
                    <div className="flex gap-1 mt-1">
                      {wh.events?.map((e) => (
                        <Badge key={e} variant="outline" className="text-micro">{e}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch checked={wh.is_active} onCheckedChange={(v) => toggleWebhook(wh.id, v)} />
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteWebhook(wh.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Inbound Webhook */}
      <Card>
        <CardHeader>
          <CardTitle>Webhook de Entrada</CardTitle>
          <CardDescription>
            Receba dados de ferramentas externas (Zapier, Make, etc.) via POST
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">URL do Webhook</Label>
            <div className="flex gap-2">
              <Input value={inboundUrl} readOnly className="h-8 text-label font-mono" />
              <Button variant="outline" size="sm" className="h-8"
                onClick={() => { navigator.clipboard.writeText(inboundUrl); toast({ title: "Copiado!" }); }}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>
          <div className="rounded-md bg-muted p-3">
            <p className="text-label text-muted-foreground mb-1 font-medium">Payload esperado (JSON POST):</p>
            <pre className="text-micro font-mono text-muted-foreground">{`{
  "entity": "contact",
  "action": "create",
  "data": {
    "first_name": "João",
    "email": "joao@empresa.com"
  }
}`}</pre>
          </div>
        </CardContent>
      </Card>

      {/* Create Webhook Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-sm">Novo Webhook</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Zapier — Deals Ganhos" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">URL</Label>
              <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://hooks.zapier.com/..." className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Secret (para HMAC)</Label>
              <Input value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })}
                placeholder="Opcional" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Eventos</Label>
              <div className="grid grid-cols-2 gap-2">
                {WEBHOOK_EVENTS.map((ev) => (
                  <label key={ev.value} className="flex items-center gap-2 text-label">
                    <Checkbox
                      checked={form.events.includes(ev.value)}
                      onCheckedChange={(checked) => {
                        setForm({
                          ...form,
                          events: checked
                            ? [...form.events, ev.value]
                            : form.events.filter((e) => e !== ev.value),
                        });
                      }}
                    />
                    {ev.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button size="sm" onClick={createWebhook}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
