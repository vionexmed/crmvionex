import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { LogoUploadField } from "@/components/crm/LogoUploadField";
import { useToast } from "@/hooks/use-toast";

export function EmailSignatureTab({ orgId }: { orgId: string | null }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cfg, setCfg] = useState<Record<string, string>>({
    from_name: "",
    signature_logo_url: "",
    signature_name: "",
    signature_role: "",
    signature_company: "",
    signature_phone: "",
    signature_email: "",
    signature_website: "",
    signature_extra: "",
  });

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    supabase.from("integration_configs").select("config").eq("org_id", orgId).eq("provider", "gmail").maybeSingle().then(({ data }) => {
      const c: any = data?.config || {};
      setCfg((prev) => ({ ...prev, ...Object.fromEntries(Object.keys(prev).map((k) => [k, c[k] ?? ""])) }));
      setLoading(false);
    });
  }, [orgId]);

  const save = async () => {
    if (!orgId) return;
    setSaving(true);
    const { data: existing } = await supabase.from("integration_configs").select("id, config").eq("org_id", orgId).eq("provider", "gmail").maybeSingle();
    const merged = { ...((existing?.config as any) || {}), ...cfg };
    const { error } = existing
      ? await supabase.from("integration_configs").update({ config: merged }).eq("id", existing.id)
      : await supabase.from("integration_configs").insert({ org_id: orgId, provider: "gmail", config: merged });
    setSaving(false);
    toast(error ? { title: "Erro", description: error.message, variant: "destructive" } : { title: "Assinatura salva" });
  };

  const set = (k: string, v: string) => setCfg((p) => ({ ...p, [k]: v }));

  const escapeHtml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&#39;" }[c] as string));
  const previewHtml = (() => {
    const accent = "#2563eb";
    const rows: string[] = [];
    if (cfg.signature_name) rows.push(`<div style="font-family:Arial,Helvetica,sans-serif;font-weight:700;color:#0f172a;font-size:24px;line-height:1.25;letter-spacing:-0.01em">${escapeHtml(cfg.signature_name)}</div>`);
    if (cfg.signature_role || cfg.signature_company) {
      const role = cfg.signature_role ? `<span style="color:#475569">${escapeHtml(cfg.signature_role)}</span>` : "";
      const sep = cfg.signature_role && cfg.signature_company ? `<span style="color:#cbd5e1;margin:0 8px">•</span>` : "";
      const company = cfg.signature_company ? `<span style="color:${accent};font-weight:600">${escapeHtml(cfg.signature_company)}</span>` : "";
      rows.push(`<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;margin-top:4px">${role}${sep}${company}</div>`);
    }
    const contactRows: string[] = [];
    const iconStyle = `display:inline-block;width:18px;color:${accent};font-weight:700;margin-right:10px;text-align:center;font-size:16px`;
    if (cfg.signature_phone) contactRows.push(`<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#334155;margin-top:8px"><span style="${iconStyle}">✆</span>${escapeHtml(cfg.signature_phone)}</div>`);
    if (cfg.signature_email) contactRows.push(`<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#334155;margin-top:6px"><span style="${iconStyle}">✉</span>${escapeHtml(cfg.signature_email)}</div>`);
    if (cfg.signature_website) {
      const display = String(cfg.signature_website).replace(/^https?:\/\//, "");
      contactRows.push(`<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#334155;margin-top:6px"><span style="${iconStyle}">🌐</span><span style="color:${accent};font-weight:500">${escapeHtml(display)}</span></div>`);
    }
    if (contactRows.length) rows.push(`<div style="margin-top:14px">${contactRows.join("")}</div>`);
    if (cfg.signature_extra) rows.push(`<div style="font-family:Arial,Helvetica,sans-serif;color:#64748b;font-size:14px;margin-top:14px;line-height:1.5">${escapeHtml(cfg.signature_extra).replace(/\n/g, "<br/>")}</div>`);
    const wrapperOpen = cfg.signature_logo_url
      ? `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="padding-right:22px;vertical-align:top;border-right:4px solid ${accent}"><img src="${escapeHtml(cfg.signature_logo_url)}" alt="" style="max-height:120px;max-width:220px;display:block"/></td><td style="width:22px"></td><td style="vertical-align:top">`
      : `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="vertical-align:top;border-left:4px solid ${accent};padding-left:18px">`;
    return `${wrapperOpen}${rows.join("")}</td></tr></table>`;
  })();

  if (loading) return <div className="text-xs text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Assinatura padrão da empresa</CardTitle>
          {/* A descrição dizia "usada automaticamente nos e-mails enviados",
              como se sempre valesse. Não vale: `gmail-send` resolve na ordem
              pessoal → empresa → legado, então quem montou a própria assinatura
              em Meu e-mail nunca vê esta. Um admin configurava isto e não
              entendia por que os próprios e-mails saíam diferentes. */}
          <CardDescription className="text-[10px]">
            Vale para quem ainda não montou a própria em <strong>Meu e-mail</strong>.
            A assinatura pessoal, quando existe, tem preferência sobre esta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Logo</Label>
            <LogoUploadField value={cfg.signature_logo_url} onChange={(url) => set("signature_logo_url", url)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Nome de exibição (remetente)</Label>
              <Input value={cfg.from_name} onChange={(e) => set("from_name", e.target.value)} placeholder="João Silva" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input value={cfg.signature_name} onChange={(e) => set("signature_name", e.target.value)} placeholder="João Silva" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cargo</Label>
              <Input value={cfg.signature_role} onChange={(e) => set("signature_role", e.target.value)} placeholder="Diretor Comercial" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Empresa</Label>
              <Input value={cfg.signature_company} onChange={(e) => set("signature_company", e.target.value)} placeholder="Minha Empresa Ltda" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Telefone</Label>
              <Input value={cfg.signature_phone} onChange={(e) => set("signature_phone", e.target.value)} placeholder="+55 11 99999-9999" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">E-mail</Label>
              <Input value={cfg.signature_email} onChange={(e) => set("signature_email", e.target.value)} placeholder="joao@empresa.com" className="h-8 text-xs" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Website</Label>
              <Input value={cfg.signature_website} onChange={(e) => set("signature_website", e.target.value)} placeholder="https://empresa.com" className="h-8 text-xs" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Texto adicional (opcional)</Label>
              <Textarea value={cfg.signature_extra} onChange={(e) => set("signature_extra", e.target.value)} placeholder="Endereço, redes sociais, etc." className="text-xs min-h-[70px]" />
            </div>
          </div>

          <Button size="sm" className="h-8 text-xs" onClick={save} disabled={saving}>
            {saving ? "Salvando..." : "Salvar Assinatura"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pré-visualização</CardTitle>
          <CardDescription className="text-[10px]">Como sua assinatura aparecerá nos e-mails</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border bg-background p-4">
            <div className="text-xs text-muted-foreground mb-3">— Conteúdo do e-mail —</div>
            <div className="border-t border-border pt-3" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
