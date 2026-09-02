import React, { useEffect, useState} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Send, FileText, Variable, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useEmailConnections } from "@/hooks/queries/useEmails";
import { SeletorDeContato } from "@/components/crm/SeletorDeContato";
import { EmBreve } from "@/components/layout/EmBreve";

type Contact = { id: string; first_name: string; last_name: string | null; email: string | null; org_id: string };
type Deal = { id: string; title: string; org_id: string; contact_id: string | null };
type Template = { id: string; name: string; subject: string; body_html: string; category: string | null };

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSent?: () => void;
  defaultTo?: string;
  defaultContactId?: string;
  defaultDealId?: string;
  /** Conta da empresa usada no envio (sales = comercial). Admin pode trocar no modal. */
}

const VARIABLES = [
  { key: "{{primeiro_nome}}", label: "Primeiro nome" },
  { key: "{{sobrenome}}", label: "Sobrenome" },
  { key: "{{empresa}}", label: "Empresa" },
  { key: "{{email}}", label: "Email" },
  { key: "{{dono_nome}}", label: "Nome do dono" },
];

export function EmailComposeModal({ open, onOpenChange, onSent, defaultTo, defaultContactId, defaultDealId }: Props) {
  const { orgId } = useOrg();
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const { data: connections = [] } = useEmailConnections();

  const [to, setTo] = useState(defaultTo || "");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [contactId, setContactId] = useState(defaultContactId || "none");
  const [dealId, setDealId] = useState(defaultDealId || "none");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [sending, setSending] = useState(false);
  const [knownEmails, setKnownEmails] = useState<{ email: string; name?: string }[]>([]);

  useEffect(() => {
    if (!open || !orgId) return;
    setTo(defaultTo || ""); setSubject(""); setBody(""); setCc(""); setBcc("");
    setContactId(defaultContactId || "none"); setDealId(defaultDealId || "none");
    Promise.all([
      // Tetos, porque isto roda ao ABRIR o modal.
      //
      // Baixava contatos, negócios e modelos da organização inteira para
      // preencher três seletores -- e o custo aparecia como demora entre clicar
      // em "Escrever" e a janela responder.
      //
      // Os seletores têm busca, então o que importa é ter um conjunto útil na
      // abertura, não a base completa. 500 cobre com folga o que cabe num
      // seletor sem rolar para sempre.
      supabase
        .from("contacts")
        .select("id,first_name,last_name,email,org_id")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("deals")
        .select("id,title,org_id,contact_id")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.from("email_templates").select("*").eq("org_id", orgId).limit(200),
      supabase.from("emails").select("from_email,to_emails,cc_emails,bcc_emails").eq("org_id", orgId).order("created_at", { ascending: false }).limit(500),
    ]).then(([c, d, t, e]) => {
      const contactsList = (c.data as Contact[]) || [];
      const dealsList = (d.data as Deal[]) || [];
      setContacts(contactsList);
      setDeals(dealsList);
      setTemplates((t.data as Template[]) || []);
      // Build known emails dictionary from contacts + history
      const dict = new Map<string, { email: string; name?: string }>();
      contactsList.forEach((ct) => {
        if (ct.email) {
          const k = ct.email.toLowerCase();
          dict.set(k, { email: ct.email, name: `${ct.first_name} ${ct.last_name || ""}`.trim() });
        }
      });
      const pushEmail = (raw: any) => {
        if (!raw) return;
        const str = typeof raw === "string" ? raw : raw?.email || "";
        if (!str || !str.includes("@")) return;
        const k = str.toLowerCase();
        if (!dict.has(k)) dict.set(k, { email: str });
      };
      ((e.data as any[]) || []).forEach((row) => {
        pushEmail(row.from_email);
        (row.to_emails || []).forEach(pushEmail);
        (row.cc_emails || []).forEach(pushEmail);
        (row.bcc_emails || []).forEach(pushEmail);
      });
      setKnownEmails(Array.from(dict.values()));
      // Auto-fill "to" from defaultContactId
      if (!defaultTo && defaultContactId && defaultContactId !== "none") {
        const contact = contactsList.find((ct) => ct.id === defaultContactId);
        if (contact?.email) setTo(contact.email);
      }
      // Auto-select contact from defaultDealId
      if (defaultDealId && defaultDealId !== "none" && (!defaultContactId || defaultContactId === "none")) {
        const deal = dealsList.find((dl) => dl.id === defaultDealId);
        if (deal?.contact_id) {
          setContactId(deal.contact_id);
          const contact = contactsList.find((ct) => ct.id === deal.contact_id);
          if (contact?.email && !defaultTo) setTo(contact.email);
        }
      }
    });
  }, [open, orgId]);

  const applyTemplate = (tpl: Template) => {
    setSubject(tpl.subject);
    // Replace variables with contact data
    let html = tpl.body_html;
    const contact = contacts.find((c) => c.id === contactId);
    if (contact) {
      html = html.replace(/\{\{primeiro_nome\}\}/g, contact.first_name);
      html = html.replace(/\{\{sobrenome\}\}/g, contact.last_name || "");
      html = html.replace(/\{\{email\}\}/g, contact.email || "");
    }
    html = html.replace(/\{\{dono_nome\}\}/g, profile?.name || "");
    setBody(html);
  };

  const insertVariable = (varKey: string) => {
    setBody((prev) => prev + varKey);
  };

  const handleSend = async () => {
    if (!orgId || !to.trim() || !subject.trim()) {
      toast({ title: "Preencha destinatário e assunto", variant: "destructive" });
      return;
    }
    // Preserve user's spacing/paragraphs: convert plain text to HTML if body isn't already HTML
    const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(body);
    const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c] as string));
    const toHtml = (txt: string) => {
      const paragraphs = txt.replace(/\r\n/g, "\n").split(/\n{2,}/);
      return paragraphs
        .map((p) => `<p style="margin:0 0 12px 0;line-height:1.5">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
        .join("");
    };
    const htmlBody = looksLikeHtml ? body : toHtml(body);

    setSending(true);
    const { data, error } = await supabase.functions.invoke("gmail-send", {
      body: {
        org_id: orgId,
        user_id: user?.id,
        contact_id: contactId !== "none" ? contactId : null,
        deal_id: dealId !== "none" ? dealId : null,
        to: to.split(",").map((e) => e.trim()).filter(Boolean),
        cc: cc ? cc.split(",").map((e) => e.trim()).filter(Boolean) : [],
        bcc: bcc ? bcc.split(",").map((e) => e.trim()).filter(Boolean) : [],
        subject,
        html: htmlBody,
      },
    });
    setSending(false);
    if (error || (data as any)?.error) {
      toast({ title: "Erro ao enviar", description: (data as any)?.error || error?.message || "Falha", variant: "destructive" });
      return;
    }
    onOpenChange(false);
    onSent?.();
    toast({ title: "Email enviado pelo Gmail" });
  };

  // Auto-fill "to" when contact is selected
  const onContactChange = (v: string) => {
    setContactId(v);
    setDealId("none");
    if (v !== "none") {
      const c = contacts.find((c) => c.id === v);
      if (c?.email) setTo(c.email);
    }
  };

  const filteredDeals = contactId !== "none"
    ? deals.filter((d) => d.contact_id === contactId)
    : deals;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            Compor Email
          </DialogTitle>
          <DialogDescription>Envie um email diretamente pelo CRM</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* Contact / Deal selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Contato</Label>
              <SeletorDeContato
                contatos={contacts}
                valor={contactId}
                aoMudar={onContactChange}
                permitirNenhum
                sufixoDe={(c) => c.email || null}
                placeholder="Selecionar..."
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Negócio</Label>
              <Select value={dealId} onValueChange={setDealId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {filteredDeals.map((d) => <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* De: sempre a própria conta.
              Antes havia um seletor entre a conta "comercial" e a de
              "marketing" da empresa — modelo de duas caixas que foi substituído
              por uma conta por pessoa. O servidor já resolve assim:
              gmail-send/index.ts busca scope_type = 'user' de quem chama. */}
          {(() => {
            const minha = connections.find((c) => c.user_id === user?.id);
            if (minha) {
              return (
                <p className="text-label text-muted-foreground">
                  De: <span className="font-medium">{minha.email_address}</span>
                </p>
              );
            }
            return (
              <p className="text-label text-warning">
                Você ainda não conectou seu e-mail — conecte em Configurações → Conectar e-mail.
              </p>
            );
          })()}

          {/* To */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Para *</Label>
              {!showCcBcc && (
                <button onClick={() => setShowCcBcc(true)} className="text-label text-primary hover:underline">
                  Cc/Bcc
                </button>
              )}
            </div>
            <EmailAutocompleteInput value={to} onChange={setTo} suggestions={knownEmails} placeholder="email@exemplo.com" />
          </div>

          {showCcBcc && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Cc</Label>
                <EmailAutocompleteInput value={cc} onChange={setCc} suggestions={knownEmails} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bcc</Label>
                <EmailAutocompleteInput value={bcc} onChange={setBcc} suggestions={knownEmails} />
              </div>
            </>
          )}

          {/* Subject */}
          <div className="space-y-1">
            <Label className="text-xs">Assunto *</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-8 text-sm" />
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 border-b border-border pb-2">
            {/* Templates */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-label">
                  <FileText className="mr-1 h-3 w-3" />Templates
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-60 p-2" align="start">
                {templates.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2 text-center">Nenhum template criado</p>
                ) : (
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => applyTemplate(t)}
                        className="w-full text-left rounded-md px-2 py-1.5 text-xs hover:bg-accent transition-colors"
                      >
                        <p className="font-medium">{t.name}</p>
                        {t.category && <span className="text-label text-muted-foreground">{t.category}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>

            {/* Variables */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-label">
                  <Variable className="mr-1 h-3 w-3" />Variáveis
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-52 p-2" align="start">
                <div className="space-y-0.5">
                  {VARIABLES.map((v) => (
                    <button
                      key={v.key}
                      onClick={() => insertVariable(v.key)}
                      className="w-full text-left rounded-md px-2 py-1 text-xs hover:bg-accent transition-colors flex justify-between"
                    >
                      <span>{v.label}</span>
                      <code className="text-label text-muted-foreground">{v.key}</code>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

          </div>

          {/*
            O "GERAR COM IA" SAIU. Ele chamava a função `ai-email`, que exigia
            uma chave da Lovable que este projeto não usa: o painel abria,
            aceitava o texto e o tom, e no "Gerar" respondia erro de chave.

            O vidro fica no lugar em vez de nada: o espaço estava reservado, e
            some-lo faria a barra de ferramentas parecer incompleta para quem já
            conhecia o botão.
          */}
          <EmBreve
            titulo="Escrever com IA"
            descricao="Descrever o e-mail em uma frase e receber assunto e corpo prontos, no tom que você escolher."
            className="min-h-[120px] p-4"
          />

          {/* Body */}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Escreva o conteúdo do email..."
            rows={8}
            className="text-sm"
          />

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSend} disabled={sending || !to.trim() || !subject.trim()}>
              <Send className="mr-1.5 h-4 w-4" />{sending ? "Enviando..." : "Enviar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface AutocompleteProps {
  value: string;
  onChange: (v: string) => void;
  suggestions: { email: string; name?: string }[];
  placeholder?: string;
}

function EmailAutocompleteInput({ value, onChange, suggestions, placeholder }: AutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Get last token after last comma
  const tokens = value.split(",");
  const current = tokens[tokens.length - 1].trim().toLowerCase();
  const alreadyUsed = new Set(tokens.slice(0, -1).map((t) => t.trim().toLowerCase()).filter(Boolean));

  const filtered = current.length > 0
    ? suggestions
        .filter((s) =>
          !alreadyUsed.has(s.email.toLowerCase()) &&
          (s.email.toLowerCase().includes(current) || (s.name || "").toLowerCase().includes(current))
        )
        .slice(0, 8)
    : suggestions.filter((s) => !alreadyUsed.has(s.email.toLowerCase())).slice(0, 8);

  useEffect(() => { setHighlight(0); }, [current]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (email: string) => {
    const next = [...tokens.slice(0, -1).map((t) => t.trim()).filter(Boolean), email].join(", ") + ", ";
    onChange(next);
    setOpen(false);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => (h + 1) % filtered.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => (h - 1 + filtered.length) % filtered.length); }
    else if (e.key === "Enter" || e.key === "Tab") {
      if (filtered[highlight]) { e.preventDefault(); pick(filtered[highlight].email); }
    } else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        placeholder={placeholder}
        className="h-8 text-sm"
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          {filtered.map((s, i) => (
            <button
              key={s.email}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(s.email); }}
              onMouseEnter={() => setHighlight(i)}
              className={`w-full text-left px-3 py-1.5 text-xs flex flex-col ${i === highlight ? "bg-accent" : ""}`}
            >
              {s.name && <span className="font-medium text-foreground">{s.name}</span>}
              <span className={s.name ? "text-muted-foreground text-label" : "text-foreground"}>{s.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
