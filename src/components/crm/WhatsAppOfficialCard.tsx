import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { MessageCircle, Plus, Copy, Check, Loader2, RefreshCw} from "lucide-react";

type WAConfig = {
  id: string;
  org_id: string;
  phone_number_id: string;
  waba_id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  webhook_verify_token: string;
  is_active: boolean;
};

function randomToken(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * `embutido` tira a moldura de Card e o cabeçalho.
 *
 * O cartão único de WhatsApp mostra as duas opções lado a lado, e Card dentro de
 * Card ficaria com duas bordas e dois títulos dizendo o mesmo. O diálogo próprio
 * continua nos dois modos: é onde o formulário vive.
 */
export function WhatsAppOfficialCard({ embutido = false }: { embutido?: boolean } = {}) {
  const { orgId } = useOrg();
  const { toast } = useToast();
  const [config, setConfig] = useState<WAConfig | null>(null);
  /** A empresa já está na Evolution: este cartão não tem o que oferecer. */
  const [outroProvedor, setOutroProvedor] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const [form, setForm] = useState({
    phone_number_id: "",
    waba_id: "",
    webhook_verify_token: "",
  });

  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || "";
  const webhookUrl = `${supabaseUrl}/functions/v1/whatsapp-webhook`;

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    // A conta da empresa diz QUAL provedor foi escolhido. Sem esta leitura, os
    // dois cartões de WhatsApp apareceriam juntos depois de a empresa já ter
    // escolhido um -- e oferecer os dois caminhos ao mesmo tempo é o convite
    // para alguém configurar os dois e não saber por qual as mensagens saem.
    const [{ data }, { data: conta }] = await Promise.all([
      supabase.from("whatsapp_config").select("*").eq("org_id", orgId).maybeSingle(),
      supabase.from("whatsapp_business_accounts")
        .select("provider, is_active").eq("org_id", orgId).maybeSingle(),
    ]);
    setConfig((data as WAConfig) || null);
    setOutroProvedor(!!conta?.is_active && conta.provider === "evolution");
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  function openDialog() {
    if (config) {
      setForm({
        phone_number_id: config.phone_number_id,
        waba_id: config.waba_id,
        webhook_verify_token: config.webhook_verify_token,
      });
    } else {
      setForm({ phone_number_id: "", waba_id: "", webhook_verify_token: randomToken(24) });
    }
    setOpen(true);
  }

  async function save() {
    if (!orgId) return;
    if (!form.phone_number_id || !form.waba_id || !form.webhook_verify_token) {
      toast({ title: "Preencha todos os campos", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (config) {
        const { error } = await supabase.from("whatsapp_config").update({
          phone_number_id: form.phone_number_id,
          waba_id: form.waba_id,
          webhook_verify_token: form.webhook_verify_token,
          is_active: true,
        }).eq("id", config.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("whatsapp_config").insert({
          org_id: orgId,
          phone_number_id: form.phone_number_id,
          waba_id: form.waba_id,
          webhook_verify_token: form.webhook_verify_token,
          is_active: true,
        });
        if (error) throw error;
      }
      toast({ title: "Configuração salva" });
      await load();
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-templates-sync");
      if (error) throw error;
      if (data?.error) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error));
      toast({
        title: "Conectado!",
        description: `${data.phone?.display_phone_number ?? ""} (${data.phone?.verified_name ?? "—"}) · ${data.templates_synced} templates sincronizados`,
      });
      await load();
    } catch (e: any) {
      toast({ title: "Falha na conexão", description: e.message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  // A empresa está na Evolution: quem manda é o cartão de QR code.
  if (outroProvedor) return null;

  const status = (
    <div className="flex items-center gap-2">
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : config ? (
        <>
          <Badge variant={config.is_active ? "default" : "secondary"} className="text-micro">
            {config.is_active ? "Conectado" : "Inativo"}
          </Badge>
          {config.display_phone_number && (
            <span className="text-meta text-muted-foreground">{config.display_phone_number}</span>
          )}
          <Button variant="outline" size="sm" className="ml-auto h-8 text-label" onClick={openDialog}>
            Configurar
          </Button>
        </>
      ) : (
        <Button size="sm" className="h-8 text-label" onClick={openDialog}>
          <Plus className="mr-1 h-3 w-3" />Conectar
        </Button>
      )}
    </div>
  );

  return (
    <>
      {embutido ? status : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10">
                  <MessageCircle className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <CardTitle>WhatsApp Business (Meta Oficial)</CardTitle>
                  <CardDescription>
                    Cloud API oficial — envio e recebimento de mensagens
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>{status}</CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">WhatsApp Business — Meta Cloud API</DialogTitle>
            <DialogDescription className="text-xs">
              Configure usando suas credenciais oficiais da Meta.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-meta text-muted-foreground space-y-1">
              <div className="font-medium text-foreground">Como obter as credenciais:</div>
              <ol className="ml-4 list-decimal space-y-0.5">
                <li>Acesse o <a className="underline" target="_blank" rel="noreferrer" href="https://developers.facebook.com/apps">Meta for Developers</a> e crie/selecione um App</li>
                <li>Adicione o produto <strong>WhatsApp</strong></li>
                <li>Copie o <strong>Phone Number ID</strong> e o <strong>WhatsApp Business Account ID (WABA ID)</strong></li>
                <li>Gere um <strong>Token permanente</strong> (System User) com escopo <code>whatsapp_business_messaging</code> + <code>whatsapp_business_management</code></li>
                <li>Salve o token como secret <code>META_WHATSAPP_TOKEN</code> no projeto</li>
              </ol>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Phone Number ID</Label>
              <Input value={form.phone_number_id} onChange={(e) => setForm(f => ({ ...f, phone_number_id: e.target.value }))}
                placeholder="123456789012345" />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">WhatsApp Business Account ID (WABA ID)</Label>
              <Input value={form.waba_id} onChange={(e) => setForm(f => ({ ...f, waba_id: e.target.value }))}
                placeholder="987654321098765" />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Webhook URL (cole no painel Meta)</Label>
              <div className="flex gap-2">
                <Input readOnly value={webhookUrl} className="font-mono text-meta" />
                <Button type="button" variant="outline" size="icon" onClick={() => copy(webhookUrl, "url")}>
                  {copied === "url" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Verify Token (cole no painel Meta)</Label>
              <div className="flex gap-2">
                <Input value={form.webhook_verify_token}
                  onChange={(e) => setForm(f => ({ ...f, webhook_verify_token: e.target.value }))}
                  className="font-mono text-meta" />
                <Button type="button" variant="outline" size="icon" onClick={() => copy(form.webhook_verify_token, "tk")}>
                  {copied === "tk" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-label text-muted-foreground">
                Use estes valores em <strong>WhatsApp → Configuração → Webhook</strong> e assine o campo <code>messages</code>.
              </p>
            </div>

            {config && (
              <div className="rounded-md border bg-muted/30 p-3 text-meta space-y-0.5">
                <div><strong>Número:</strong> {config.display_phone_number || "—"}</div>
                <div><strong>Nome verificado:</strong> {config.verified_name || "—"}</div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            {config && (
              <Button variant="outline" onClick={testConnection} disabled={testing}>
                {testing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                Testar e sincronizar
              </Button>
            )}
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
