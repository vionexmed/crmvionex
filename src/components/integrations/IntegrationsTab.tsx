import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { MessageSquare, Webhook, Mail, Plus, Loader2, Eye, EyeOff, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";

function MetaIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879V14.89h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.989C18.343 21.129 22 16.99 22 12c0-5.523-4.477-10-10-10z"/>
    </svg>
  );
}
import { useToast } from "@/hooks/use-toast";
import { LogoUploadField } from "@/components/crm/LogoUploadField";
import { WhatsAppOfficialCard } from "@/components/crm/WhatsAppOfficialCard";

type IntegrationConfig = {
  id: string; org_id: string; provider: string; config: any; is_active: boolean;
  connected_at: string | null; connected_by: string | null;
};

type EmailConnection = {
  id: string; user_id: string; provider: string; email_address: string | null;
  label: string; purpose: string; is_active: boolean; created_at: string | null;
};

export function IntegrationsTab({ orgId, userId }: { orgId: string | null; userId?: string }) {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<IntegrationConfig[]>([]);
  const [editProvider, setEditProvider] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState<any>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [emailConnections, setEmailConnections] = useState<EmailConnection[]>([]);

  const fetchConfigs = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase.from("integration_configs").select("*").eq("org_id", orgId) as any;
    setConfigs(data || []);
  }, [orgId]);

  const fetchEmailConnections = useCallback(async () => {
    if (!orgId) return;
    // Contas da EMPRESA: visíveis para toda a org, independente de quem conectou
    const { data } = await supabase
      .from("email_connections")
      .select("*")
      .eq("org_id", orgId)
      .eq("is_active", true) as any;
    setEmailConnections(data || []);
  }, [orgId]);

  useEffect(() => { fetchConfigs(); fetchEmailConnections(); }, [fetchConfigs, fetchEmailConnections]);

  const getConfig = (provider: string) => configs.find((c) => c.provider === provider);

  const saveConfig = async (provider: string) => {
    // Slack não grava direto: a URL do webhook é credencial e vai para
    // `org_secrets`, tabela com RLS e nenhuma política — inalcançável pelo
    // cliente. A edge function TESTA o webhook antes de guardar, para o erro
    // aparecer aqui e não às 20h de um dia qualquer.
    if (provider === "slack") {
      const url = String(editConfig.webhook_url || "").trim();
      if (!url) {
        toast({ title: "Cole a URL do webhook", variant: "destructive" });
        return;
      }
      const { data, error } = await supabase.functions.invoke("validate-slack-webhook", {
        body: {
          webhook_url: url,
          channel: editConfig.channel || "",
          stale_days: editConfig.stale_days || 7,
        },
      });
      const msg = (data as { error?: string } | null)?.error || error?.message;
      if (msg) {
        toast({ title: "Não foi possível salvar", description: msg, variant: "destructive" });
        return;
      }
      toast({
        title: "Slack conectado",
        description: "Mandei uma mensagem de teste agora. Se chegou, o resumo das 20h também chega.",
      });
      setEditProvider(null);
      fetchConfigs();
      return;
    }

    if (!orgId) return;
    // gmail_credentials salva como provider "gmail" no banco
    if (provider === "gmail_credentials") {
      const existing = getConfig("gmail") || getConfig("gmail_credentials");
      if (existing) {
        await supabase.from("integration_configs").update({ config: editConfig } as any).eq("id", existing.id);
      } else {
        await supabase.from("integration_configs").insert({ org_id: orgId, provider: "gmail", config: editConfig, connected_by: userId } as any);
      }
      toast({ title: "Credenciais Gmail salvas — agora você pode conectar as contas" });
      setEditProvider(null);
      fetchConfigs();
      return;
    }
    if (provider === "meta") {
      const existing = getConfig("meta");
      if (existing) {
        await supabase.from("integration_configs").update({ config: editConfig, is_active: true } as any).eq("id", existing.id);
      } else {
        await supabase.from("integration_configs").insert({ org_id: orgId, provider: "meta", config: editConfig, is_active: true, connected_by: userId } as any);
      }
      toast({ title: "Meta Ads configurado — clique em Sincronizar para importar campanhas" });
      setEditProvider(null);
      fetchConfigs();
      return;
    }
    if (provider === "gmail") {
      // Save optional credentials, display name and signature fields; OAuth handled by Conectar
      const existing = getConfig("gmail");
      const sigKeys = ["client_id","client_secret","from_name","signature","signature_name","signature_role","signature_company","signature_phone","signature_email","signature_website","signature_extra","signature_logo_url"];
      const merged: any = { ...(existing?.config || {}) };
      for (const k of sigKeys) merged[k] = editConfig[k] ?? merged[k] ?? null;
      if (existing) {
        await supabase.from("integration_configs").update({ config: merged } as any).eq("id", existing.id);
      } else {
        await supabase.from("integration_configs").insert({ org_id: orgId, provider: "gmail", config: merged, connected_by: userId } as any);
      }
      toast({ title: "Configurações do Gmail salvas" });
      setEditProvider(null);
      fetchConfigs();
      return;
    }
    const existing = getConfig(provider);
    if (existing) {
      await supabase.from("integration_configs").update({ config: editConfig, is_active: true } as any).eq("id", existing.id);
    } else {
      await supabase.from("integration_configs").insert({ org_id: orgId, provider, config: editConfig, connected_by: userId } as any);
    }
    toast({ title: `${provider} configurado` });
    setEditProvider(null);
    fetchConfigs();
  };

  const toggleActive = async (id: string, active: boolean) => {
    await supabase.from("integration_configs").update({ is_active: active } as any).eq("id", id);
    fetchConfigs();
  };

  const [slackConnecting, setSlackConnecting] = useState(false);
  const [, setSlackChannels] = useState<{ id: string; name: string }[]>([]);
  const [, setSlackWorkspace] = useState<string | null>(null);
  const [slackSetupGuide, setSlackSetupGuide] = useState(false);

  const handleSlackConnect = async () => {
    if (!orgId) return;
    setSlackConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("slack-connect", {
        body: { org_id: orgId },
      });
      if (error) throw error;
      if (data?.error?.includes("API_KEY")) {
        setSlackSetupGuide(true);
        setSlackConnecting(false);
        return;
      }
      if (data?.workspace_name) {
        setSlackWorkspace(data.workspace_name);
        setSlackChannels(data.channels || []);
        toast({ title: `Conectado ao workspace ${data.workspace_name}` });
        fetchConfigs();
      } else {
        setSlackSetupGuide(true);
      }
    } catch {
      setSlackSetupGuide(true);
    }
    setSlackConnecting(false);
  };

  const [metaConnecting, setMetaConnecting] = useState(false);
  const handleMetaConnect = async () => {
    if (!orgId) return;
    const cfg = getConfig("meta");
    if (!cfg?.config?.access_token && !cfg?.config?.waba_token) {
      setEditProvider("meta");
      setEditConfig(cfg?.config || {});
      return;
    }
    setMetaConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-ads-sync", {
        body: { org_id: orgId },
      });
      if (error) throw error;
      toast({ title: data?.synced ? `Sincronizado — ${data.synced} campanhas importadas` : "Meta Ads conectado" });
      fetchConfigs();
    } catch (e: any) {
      toast({ title: "Erro ao conectar Meta Ads", description: e.message, variant: "destructive" });
    }
    setMetaConnecting(false);
  };



  /**
   * Tipo explícito, não inferido. Os provedores têm conjuntos de campos
   * diferentes, e deixar o TypeScript inferir a união fazia `field` colapsar
   * para `never` no diálogo — `field.key` deixava de existir.
   */
  type CampoIntegracao = {
    key: string;
    label: string;
    placeholder?: string;
    type?: "secret" | "switch" | "section" | "logo" | "textarea";
    helpText?: string;
    helpUrl?: string;
    helpLabel?: string;
  };

  type Integracao = {
    provider: string;
    name: string;
    /** Aceita ícone do lucide E o MetaIcon local, que é um componente próprio. */
    icon: React.ComponentType<{ className?: string }>;
    description: string;
    connectAction?: () => void | Promise<void>;
    connectLoading?: boolean;
    fields: CampoIntegracao[];
  };

  const integrations: Integracao[] = [
    {
      provider: "meta", name: "Meta Business", icon: MetaIcon,
      description: "Meta Ads (campanhas) + WhatsApp Business (mensagens)",
      connectAction: handleMetaConnect,
      connectLoading: metaConnecting,
      fields: [
        { key: "_sec_ads", label: "Meta Ads", type: "section" as const },
        {
          key: "access_token", label: "Token de acesso", placeholder: "EAAxxxxxx...", type: "secret" as const,
          helpText: "Gere em",
          helpUrl: "https://developers.facebook.com/tools/explorer/",
          helpLabel: "Meta Graph API Explorer",
        },
        {
          key: "ad_account_id", label: "ID da conta de anúncio", placeholder: "act_123456789",
          helpText: "Business Manager → Contas de Anúncio → copie o ID (ex: act_123…)",
        },
        { key: "_sec_waba", label: "WhatsApp Business", type: "section" as const },
        {
          key: "phone_number_id", label: "Phone Number ID", placeholder: "987654321098765",
          helpText: "Business Manager → Contas do WhatsApp → selecione o número",
        },
        {
          key: "waba_token", label: "Token do WhatsApp", placeholder: "EAAxxxxxx...", type: "secret" as const,
          helpText: "Mesmo token de acesso acima, ou gere um token de sistema permanente",
        },
      ],
    },
    {
      provider: "gmail_credentials", name: "Gmail — Credenciais OAuth", icon: Mail,
      description: "Configure Client ID e Client Secret para conectar contas Gmail",
      fields: [
        { key: "client_id", label: "Google OAuth Client ID", placeholder: "xxxxxxx.apps.googleusercontent.com", type: "secret" as const,
          helpText: "Crie credenciais OAuth 2.0 em",
          helpUrl: "https://console.cloud.google.com/apis/credentials",
          helpLabel: "Google Cloud Console" },
        { key: "client_secret", label: "Google OAuth Client Secret", placeholder: "GOCSPX-...", type: "secret" as const },
        { key: "from_name", label: "Nome de exibição (opcional)", placeholder: "Equipe Comercial" },
        { key: "_signature_section", label: "Assinatura de email", type: "section" as const },
        { key: "signature_logo_url", label: "Logo da assinatura", type: "logo" as const },
        { key: "signature_name", label: "Nome", placeholder: "João Silva" },
        { key: "signature_role", label: "Cargo", placeholder: "Diretor Comercial" },
        { key: "signature_company", label: "Empresa", placeholder: "Minha Empresa Ltda" },
        { key: "signature_phone", label: "Telefone", placeholder: "+55 11 99999-9999" },
        { key: "signature_email", label: "E-mail", placeholder: "joao@empresa.com" },
        { key: "signature_website", label: "Website", placeholder: "https://empresa.com" },
        { key: "signature_extra", label: "Texto adicional (opcional)", placeholder: "Endereço, redes sociais, etc.", type: "textarea" as const },
      ],
    },
    {
      provider: "slack", name: "Slack", icon: MessageSquare,
      description: "Resumo do dia no canal, todo dia às 20h",
      connectAction: handleSlackConnect,
      connectLoading: slackConnecting,
      // Os campos `notify_won` e `notify_lost` saíram: eram switches que NENHUM
      // arquivo lia. Ligar não fazia nada. `daily_summary` também não fazia —
      // agora faz, porque existe a function slack-daily-summary e o cron.
      fields: [
        {
          key: "webhook_url", label: "URL do Incoming Webhook", type: "secret" as const,
          placeholder: "https://hooks.slack.com/services/T00/B00/xxxx",
          helpText: "No Slack: Apps → Incoming Webhooks → Add to Slack. Escolha o canal ali; é ele que vai receber.",
          helpUrl: "https://api.slack.com/messaging/webhooks",
          helpLabel: "Como criar",
        },
        {
          key: "channel", label: "Canal (só para você lembrar)", placeholder: "#comercial-lideranca",
          helpText: "O canal de verdade é definido no Slack ao criar o webhook. Este campo é anotação.",
        },
        { key: "stale_days", label: "Considerar negócio parado após (dias)", placeholder: "7" },
        { key: "daily_summary", label: "Enviar resumo às 20h", type: "switch" as const },
      ],
    },
    {
      provider: "zapier", name: "Zapier / Make", icon: Webhook,
      description: "Webhooks de saída e entrada para automação",
      fields: [
        { key: "outbound_url", label: "Webhook URL de saída", placeholder: "https://hooks.zapier.com/..." },
        { key: "events", label: "Eventos", placeholder: "deal.won, deal.lost, contact.created" },
      ],
    },
  ];

  const gmailCredentials = getConfig("gmail") || getConfig("gmail_credentials");
  const hasGmailCredentials = !!(gmailCredentials?.config?.client_id && gmailCredentials?.config?.client_secret);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <WhatsAppOfficialCard />

        {/* ── Google: só as credenciais ──────────────────
            Aqui NÃO se conecta conta de e-mail. Antes este cartão oferecia duas
            contas no nível da empresa (atendimento e marketing), do modelo
            antigo, enquanto cada pessoa já conecta a própria em
            Configurações → Conectar e-mail. Os dois modelos conviviam e a
            tabela email_connections carregava duas dimensões sobrepostas
            (purpose e scope_type). Ficou só o modelo por pessoa. */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Mail className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-sm">Google — credenciais OAuth</CardTitle>
                <CardDescription className="text-[10px]">
                  Configuradas uma vez pela empresa. Cada pessoa conecta o próprio Gmail depois.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {hasGmailCredentials ? (
              <div className="flex items-center gap-1.5 rounded-md border border-success/30 bg-success/5 p-3">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                <span className="text-xs font-medium text-success">
                  Credenciais configuradas — a equipe já pode conectar as contas
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Sem o <strong>Client ID</strong> e o <strong>Client Secret</strong> do Google,
                  ninguém consegue conectar e-mail — nem você.
                </span>
              </div>
            )}

            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="text-[11px] font-medium">Onde cada pessoa conecta a conta dela</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                Em <strong>Configurações → Conectar e-mail</strong>. A caixa de cada um é privada:
                ninguém vê o e-mail do outro, nem você.
              </p>
              {emailConnections.length > 0 && (
                <p className="mt-1.5 text-[10px] tabular-nums text-muted-foreground">
                  {emailConnections.length}{" "}
                  {emailConnections.length === 1 ? "conta conectada" : "contas conectadas"} na equipe
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px]"
                onClick={async () => {
                  const provider = "gmail_credentials";
                  setEditProvider(provider);
                  let base = gmailCredentials?.config || {};
                  try {
                    const { data } = await supabase.functions.invoke("gmail-get-defaults");
                    if (data) base = { client_id: base.client_id || data.client_id, client_secret: base.client_secret || data.client_secret, ...base };
                  } catch { /* ignore */ }
                  setEditConfig(base);
                }}
              >
                {hasGmailCredentials ? "Editar credenciais" : "Configurar credenciais"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {integrations.map((intg) => {
          const cfg = getConfig(intg.provider);
          const Icon = intg.icon;
          return (
            <Card key={intg.provider}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-sm">{intg.name}</CardTitle>
                      <CardDescription className="text-[10px]">{intg.description}</CardDescription>
                    </div>
                  </div>
                  {cfg && <Switch checked={cfg.is_active} onCheckedChange={(v) => toggleActive(cfg.id, v)} />}
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 flex-wrap">
                  {cfg ? (
                    <>
                      <Badge variant={cfg.is_active ? "default" : "secondary"} className="text-[9px]">
                        {cfg.is_active ? "Conectado" : "Inativo"}
                      </Badge>
                      {intg.provider === "meta" && cfg.is_active && (
                        <Button variant="outline" size="sm" className="h-7 text-[10px]"
                          disabled={metaConnecting}
                          onClick={handleMetaConnect}>
                          {metaConnecting ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Sincronizando...</> : <><RefreshCw className="mr-1 h-3 w-3" />Sincronizar</>}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" className="ml-auto h-7 text-[10px]"
                        onClick={async () => {
                          setEditProvider(intg.provider);
                          let base = cfg.config || {};
                          if (intg.provider === "gmail" && (!base.client_id || !base.client_secret)) {
                            try {
                              const { data } = await supabase.functions.invoke("gmail-get-defaults");
                              if (data) base = { client_id: base.client_id || data.client_id, client_secret: base.client_secret || data.client_secret, ...base };
                            } catch { /* ignore */ }
                          }
                          setEditConfig(base);
                        }}>
                        Configurar
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" className="h-7 text-[10px]"
                      disabled={intg.connectLoading}
                      onClick={async () => {
                        if (intg.connectAction) return intg.connectAction();
                        setEditProvider(intg.provider);
                        let base: any = {};
                        if (intg.provider === "gmail") {
                          try {
                            const { data } = await supabase.functions.invoke("gmail-get-defaults");
                            if (data) base = { client_id: data.client_id, client_secret: data.client_secret };
                          } catch { /* ignore */ }
                        }
                        setEditConfig(base);
                      }}>
                      {intg.connectLoading ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Conectando...</> : <><Plus className="mr-1 h-3 w-3" />Conectar</>}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Config Dialog */}
      <Dialog open={!!editProvider} onOpenChange={() => setEditProvider(null)}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Configurar {integrations.find((i) => i.provider === editProvider)?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {editProvider === "meta" && (
              <div className="rounded-md border border-[#1877F2]/30 bg-[#EEF4FF] p-3 text-[11px] text-[#1877F2]">
                Preencha só a seção que você usa — <strong>Meta Ads</strong> para campanhas, <strong>WhatsApp</strong> para mensagens, ou ambas.
                O token é gerado no <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="underline font-medium">Meta Graph API Explorer</a>.
              </div>
            )}
            {editProvider === "gmail" && (
              <div className="rounded-md border border-border bg-muted/40 p-2 text-[11px] text-muted-foreground">
                Use <strong>Conectar</strong> no card para autorizar via Google OAuth. Os campos abaixo são opcionais — preencha sua assinatura com logo e dados de contato para aparecer em todos os emails enviados.
              </div>
            )}
            {integrations.find((i) => i.provider === editProvider)?.fields.map((field) => {
              if (field.type === "section") {
                return (
                  <div key={field.key} className="pt-2 mt-2 border-t border-border">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{field.label}</p>
                  </div>
                );
              }
              return (
              <div key={field.key} className="space-y-1">
                <Label className="text-xs">{field.label}</Label>
                {field.type === "switch" ? (
                  <div className="flex items-center gap-2">
                    <Switch checked={!!editConfig[field.key]} onCheckedChange={(v) => setEditConfig({ ...editConfig, [field.key]: v })} />
                    <span className="text-xs text-muted-foreground">{editConfig[field.key] ? "Sim" : "Não"}</span>
                  </div>
                ) : field.type === "textarea" ? (
                  <Textarea value={editConfig[field.key] || ""} onChange={(e) => setEditConfig({ ...editConfig, [field.key]: e.target.value })}
                    placeholder={field.placeholder} className="text-xs min-h-[80px]" />
                ) : field.type === "logo" ? (
                  <LogoUploadField
                    value={editConfig[field.key] || ""}
                    onChange={(url) => setEditConfig({ ...editConfig, [field.key]: url })}
                  />
                ) : field.type === "secret" || ["client_secret", "refresh_token", "client_id"].includes(field.key) ? (
                  <div className="relative">
                    <Input
                      type={revealed[field.key] ? "text" : "password"}
                      value={editConfig[field.key] || ""}
                      onChange={(e) => setEditConfig({ ...editConfig, [field.key]: e.target.value })}
                      placeholder={field.placeholder}
                      className="h-8 text-xs pr-8 font-mono"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setRevealed((s) => ({ ...s, [field.key]: !s[field.key] }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={revealed[field.key] ? "Ocultar" : "Mostrar"}
                    >
                      {revealed[field.key] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                ) : (
                  <Input
                    type="text"
                    value={editConfig[field.key] || ""}
                    onChange={(e) => setEditConfig({ ...editConfig, [field.key]: e.target.value })}
                    placeholder={field.placeholder}
                    className="h-8 text-xs"
                  />
                )}
                {(field as any).helpUrl && (
                  <p className="text-[10px] text-muted-foreground">
                    {(field as any).helpText}{" "}
                    <a href={(field as any).helpUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">
                      {(field as any).helpLabel}
                    </a>
                  </p>
                )}
              </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditProvider(null)}>Cancelar</Button>
            <Button size="sm" onClick={() => editProvider && saveConfig(editProvider)}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Slack Setup Guide */}
      <Dialog open={slackSetupGuide} onOpenChange={setSlackSetupGuide}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              Configurar integração com o Slack
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Para conectar o Slack ao VIONEX, siga os passos abaixo:
            </p>

            <div className="space-y-3">
              <div className="flex gap-3 items-start">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">1</span>
                <div>
                  <p className="text-sm font-medium">Acesse as configurações do projeto no Lovable</p>
                  <p className="text-xs text-muted-foreground">Clique no nome do projeto (canto superior esquerdo) → "Settings"</p>
                </div>
              </div>

              <div className="flex gap-3 items-start">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">2</span>
                <div>
                  <p className="text-sm font-medium">Vá em "Connectors"</p>
                  <p className="text-xs text-muted-foreground">Na aba de conectores, procure por "Slack" e clique em "Connect"</p>
                </div>
              </div>

              <div className="flex gap-3 items-start">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">3</span>
                <div>
                  <p className="text-sm font-medium">Autorize o acesso ao seu workspace</p>
                  <p className="text-xs text-muted-foreground">Selecione o workspace do Slack e autorize as permissões necessárias (enviar mensagens, listar canais)</p>
                </div>
              </div>

              <div className="flex gap-3 items-start">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">4</span>
                <div>
                  <p className="text-sm font-medium">Volte aqui e clique em "Conectar"</p>
                  <p className="text-xs text-muted-foreground">Após vincular o conector, o VIONEX detectará automaticamente seus canais</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">
                <strong>Permissões necessárias:</strong> <code className="text-[10px] bg-muted px-1 rounded">chat:write</code> <code className="text-[10px] bg-muted px-1 rounded">channels:read</code> <code className="text-[10px] bg-muted px-1 rounded">channels:history</code>
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSlackSetupGuide(false)}>Fechar</Button>
            <Button size="sm" onClick={() => { setSlackSetupGuide(false); handleSlackConnect(); }}>
              <RefreshCw className="mr-1 h-3 w-3" /> Tentar novamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
