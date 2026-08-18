import { useState, useMemo, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useEmails, useInboxContacts, useUpdateEmail, useDeleteEmail, useBatchUpdateEmails, useEmailConnections, emailsKeys } from "@/hooks/queries/useEmails";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Mail, Search, Star, Archive, Clock, Send,
  Reply, ReplyAll, Forward, ChevronLeft, Inbox as InboxIcon,
  Eye, MousePointerClick, RefreshCw, Trash2, AlertOctagon,
  FileText, SendHorizonal, Pencil, Printer, MoreVertical, Tag,
  Paperclip, Download, Image as ImageIcon, Loader2, Maximize2, Minimize2,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { EmailComposeModal } from "@/components/crm/EmailComposeModal";
import { cn } from "@/lib/utils";
import DOMPurify from "dompurify";
import type { Email, InboxContact as Contact } from "@/lib/api/emails";

type Folder =
  | "inbox"
  | "starred"
  | "snoozed"
  | "important"
  | "sent"
  | "drafts"
  | "spam"
  | "trash"
  | "archive"
  | "all";

const FOLDERS: { id: Folder; label: string; icon: any }[] = [
  { id: "inbox", label: "Caixa de entrada", icon: InboxIcon },
  { id: "starred", label: "Com estrela", icon: Star },
  { id: "snoozed", label: "Adiados", icon: Clock },
  { id: "important", label: "Importantes", icon: Tag },
  { id: "sent", label: "Enviados", icon: SendHorizonal },
  { id: "drafts", label: "Rascunhos", icon: FileText },
  { id: "spam", label: "Spam", icon: AlertOctagon },
  { id: "trash", label: "Lixeira", icon: Trash2 },
  { id: "archive", label: "Arquivados", icon: Archive },
  { id: "all", label: "Todos", icon: Mail },
];

interface InboxProps {
  /** Qual caixa da empresa exibir: sales (comercial) ou marketing */
  purpose?: "sales" | "marketing";
}

export default function Inbox({ purpose = "sales" }: InboxProps) {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: allEmails = [] } = useEmails();
  const { data: connections = [] } = useEmailConnections();
  const { data: contacts = [] } = useInboxContacts();

  const account = connections.find((c) => c.purpose === purpose);

  // Separa as caixas: marketing mostra só o que veio da conta de marketing;
  // comercial mostra o resto (inclui e-mails legados sem synced_from)
  const emails = useMemo(() => {
    const marketingAddrs = connections
      .filter((c) => c.purpose === "marketing")
      .map((c) => c.email_address.toLowerCase());
    if (purpose === "marketing") {
      return allEmails.filter(
        (e) => e.synced_from && marketingAddrs.includes(e.synced_from.toLowerCase())
      );
    }
    return allEmails.filter(
      (e) => !e.synced_from || !marketingAddrs.includes(e.synced_from.toLowerCase())
    );
  }, [allEmails, connections, purpose]);
  const updateEmailMutation = useUpdateEmail();
  const deleteEmailMutation = useDeleteEmail();
  const batchUpdateMutation = useBatchUpdateEmails();

  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState<Folder>("inbox");
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [replyMode, setReplyMode] = useState<"reply" | "replyAll" | "forward" | null>(null);
  const [forwardTo, setForwardTo] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);

  const contactMap = useMemo(() => {
    const m = new Map<string, Contact>();
    contacts.forEach((c) => { if (c.email) m.set(c.email.toLowerCase(), c); if (c.id) m.set(c.id, c); });
    return m;
  }, [contacts]);

  const getContactForEmail = (email: Email) => {
    if (email.contact_id) return contactMap.get(email.contact_id);
    const addr = email.direction === "inbound" ? email.from_email : (email.to_emails as string[])?.[0];
    if (addr) return contactMap.get(addr.toLowerCase());
    return undefined;
  };

  const folderFilter = (e: Email): boolean => {
    if (folder === "trash") return !!e.is_trashed;
    if (e.is_trashed) return false;
    if (folder === "spam") return !!e.is_spam;
    if (e.is_spam) return false;
    if (folder === "archive") return !!e.is_archived;
    if (folder === "starred") return !!e.is_starred && !e.is_archived;
    if (folder === "snoozed") return !!e.snoozed_until && new Date(e.snoozed_until) > new Date();
    if (folder === "important") return e.importance === "high";
    if (folder === "drafts") return e.status === "draft";
    if (folder === "sent") return e.direction === "outbound";
    if (folder === "inbox") return e.direction === "inbound" && !e.is_archived && (!e.snoozed_until || new Date(e.snoozed_until) <= new Date());
    return true; // all
  };

  const filtered = useMemo(() => {
    let list = emails.filter(folderFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((e) =>
        e.subject?.toLowerCase().includes(q) ||
        e.from_email?.toLowerCase().includes(q) ||
        e.body_html?.toLowerCase().includes(q) ||
        (e.to_emails as string[])?.some((t: string) => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [emails, folder, search]);

  const counts = useMemo(() => {
    const c: Record<Folder, number> = {
      inbox: 0, starred: 0, snoozed: 0, important: 0, sent: 0,
      drafts: 0, spam: 0, trash: 0, archive: 0, all: emails.length,
    };
    emails.forEach((e) => {
      if (e.is_trashed) { c.trash++; return; }
      if (e.is_spam) { c.spam++; return; }
      if (e.is_archived) c.archive++;
      if (e.is_starred) c.starred++;
      if (e.snoozed_until && new Date(e.snoozed_until) > new Date()) c.snoozed++;
      if (e.importance === "high") c.important++;
      if (e.status === "draft") c.drafts++;
      if (e.direction === "outbound") c.sent++;
      if (e.direction === "inbound" && !e.is_archived && (!e.snoozed_until || new Date(e.snoozed_until) <= new Date())) c.inbox++;
    });
    return c;
  }, [emails]);

  const updateEmail = async (id: string, patch: Partial<Email>) => {
    if (selectedEmail?.id === id) setSelectedEmail((prev) => prev ? { ...prev, ...patch } : prev);
    try {
      await updateEmailMutation.mutateAsync({ id, patch });
    } catch (e: any) {
      toast({ title: "Erro ao atualizar email", description: e.message, variant: "destructive" });
    }
  };

  const markRead = (id: string) => updateEmail(id, { is_read: true });
  const toggleStar = (e: Email) => updateEmail(e.id, { is_starred: !e.is_starred });
  const archiveEmail = async (id: string) => { await updateEmail(id, { is_archived: true }); toast({ title: "Arquivado" }); if (selectedEmail?.id === id) setSelectedEmail(null); };
  const markSpam = async (id: string) => { await updateEmail(id, { is_spam: true, is_read: true }); toast({ title: "Marcado como spam" }); if (selectedEmail?.id === id) setSelectedEmail(null); };
  const notSpam = async (id: string) => { await updateEmail(id, { is_spam: false }); toast({ title: "Removido do spam" }); };
  const trashEmail = async (id: string) => { await updateEmail(id, { is_trashed: true }); toast({ title: "Movido para lixeira" }); if (selectedEmail?.id === id) setSelectedEmail(null); };
  const restoreEmail = async (id: string) => { await updateEmail(id, { is_trashed: false, is_archived: false, is_spam: false }); toast({ title: "Restaurado" }); };
  const toggleImportance = async (e: Email) => updateEmail(e.id, { importance: e.importance === "high" ? null : "high" });

  const snoozeEmail = async (id: string, hours: number) => {
    const until = new Date(Date.now() + hours * 3600000).toISOString();
    await updateEmail(id, { snoozed_until: until, is_read: true });
    toast({ title: `Adiado por ${hours}h` });
  };

  const deleteForever = async (id: string) => {
    if (selectedEmail?.id === id) setSelectedEmail(null);
    try {
      await deleteEmailMutation.mutateAsync(id);
      toast({ title: "Excluído permanentemente" });
    } catch (e: any) {
      toast({ title: "Erro ao excluir email", description: e.message, variant: "destructive" });
    }
  };

  const sendReply = async (mode: "reply" | "replyAll" | "forward") => {
    if (!selectedEmail || !orgId || !replyBody.trim()) return;
    const toList = mode === "forward"
      ? forwardTo.split(",").map((s) => s.trim()).filter(Boolean)
      : [selectedEmail.from_email || ""];
    const ccList = mode === "replyAll" ? (selectedEmail.cc_emails || []) : [];

    const { data, error } = await supabase.functions.invoke("gmail-send", {
      body: {
        org_id: orgId,
        user_id: user?.id,
        contact_id: selectedEmail.contact_id,
        deal_id: selectedEmail.deal_id,
        to: toList,
        cc: ccList,
        subject: `${mode === "forward" ? "Fwd:" : "Re:"} ${selectedEmail.subject || ""}`,
        html: replyBody,
        purpose, // responde pela conta da caixa atual (comercial/marketing)
      },
    });
    if (error || (data as any)?.error) {
      toast({ title: "Erro ao enviar", description: (data as any)?.error || error?.message, variant: "destructive" });
      return;
    }
    setReplyBody("");
    setForwardTo("");
    setReplyMode(null);
    if (orgId) qc.invalidateQueries({ queryKey: emailsKeys.all(orgId) });
    toast({ title: "Enviado" });
  };

  const syncGmail = async () => {
    if (!orgId) return;
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("gmail-sync", {
      body: { org_id: orgId, max: 50, purpose },
    });
    setSyncing(false);
    if (error || (data as any)?.error) {
      toast({ title: "Erro ao sincronizar", description: (data as any)?.error || error?.message, variant: "destructive" });
      return;
    }
    if (orgId) await qc.invalidateQueries({ queryKey: emailsKeys.all(orgId) });
    toast({ title: `${(data as any)?.synced ?? 0} novos emails` });
  };

  const batchAction = async (action: "archive" | "trash" | "spam" | "read") => {
    const ids = Array.from(selectedIds);
    const patch: Partial<Email> =
      action === "archive" ? { is_archived: true } :
      action === "trash" ? { is_trashed: true } :
      action === "spam" ? { is_spam: true, is_read: true } :
      { is_read: true };
    try {
      await batchUpdateMutation.mutateAsync({ ids, patch });
      setSelectedIds(new Set());
      toast({ title: `${ids.length} emails atualizados` });
    } catch (e: any) {
      toast({ title: "Erro ao atualizar emails", description: e.message, variant: "destructive" });
    }
  };

  const timeAgo = (d: string | null) => {
    if (!d) return "";
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "agora";
    if (mins < 60) return `${mins}min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  };

  const getInitials = (name: string) =>
    name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

  const senderColor = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return `hsl(${h} 60% 45%)`;
  };

  if (!orgId) return <div className="py-20 text-center text-muted-foreground">Crie uma organização em Configurações primeiro.</div>;

  // Caixa de marketing sem conta conectada → é conta da EMPRESA, só admin liga.
  if (purpose === "marketing" && !account) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Mail className="h-6 w-6 text-primary" />
        </div>
        <div>
          <p className="font-semibold">Conta de Email Marketing não conectada</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Conecte a conta Gmail de marketing da empresa para receber e enviar
            e-mails de marketing separados da caixa comercial.
          </p>
        </div>
        <Button asChild>
          <Link to="/settings/integrations">Conectar em Integrações</Link>
        </Button>
      </div>
    );
  }

  // Caixa pessoal sem conta conectada. Antes esta tela não existia: o usuário
  // caía numa caixa vazia sem entender por quê, e a única CTA apontava para
  // Integrações — rota de admin, que um vendedor nem abre.
  if (purpose !== "marketing" && !account) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Mail className="h-6 w-6 text-primary" />
        </div>
        <div>
          <p className="font-semibold">Seu e-mail ainda não está conectado</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Conecte sua conta para ler aqui as conversas com seus contatos e enviar
            pelo seu próprio endereço. Ninguém da equipe vê a sua caixa.
          </p>
        </div>
        <Button asChild>
          <Link to="/settings/email">Conectar meu e-mail</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-80px)] -m-6 bg-background">
      {/* ============== Sidebar (Gmail-style) ============== */}
      <aside className="w-56 shrink-0 border-r border-border flex flex-col">
        <div className="p-3">
          <Button onClick={() => setComposeOpen(true)} className="w-full justify-start gap-2 rounded-2xl shadow-sm h-11" size="lg">
            <Pencil className="h-4 w-4" />
            Escrever
          </Button>
        </div>
        <ScrollArea className="flex-1 px-1">
          <nav className="space-y-0.5 pb-3">
            {FOLDERS.map((f) => {
              const Icon = f.icon;
              const active = folder === f.id;
              const count = counts[f.id];
              return (
                <button
                  key={f.id}
                  onClick={() => { setFolder(f.id); setSelectedEmail(null); setSelectedIds(new Set()); }}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-r-full pl-5 pr-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
                  <span className="flex-1 text-left truncate">{f.label}</span>
                  {count > 0 && (
                    <span className="text-[10px] font-medium tabular-nums">{count}</span>
                  )}
                </button>
              );
            })}
          </nav>
        </ScrollArea>
      </aside>

      {/* ============== Email list ============== */}
      <div className={cn("flex flex-col border-r border-border", selectedEmail ? "w-[400px] shrink-0" : "flex-1 min-w-0")}>
        {/* Toolbar */}
        <div className="border-b border-border">
          <div className="flex items-center gap-2 px-3 h-12">
            <Checkbox
              checked={filtered.length > 0 && selectedIds.size === filtered.length}
              onCheckedChange={(v) => setSelectedIds(v ? new Set(filtered.map((e) => e.id)) : new Set())}
            />
            <Button variant="ghost" size="sm" onClick={syncGmail} disabled={syncing} title="Sincronizar Gmail">
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
            </Button>
            {selectedIds.size > 0 ? (
              <>
                <div className="h-5 w-px bg-border mx-1" />
                <Button variant="ghost" size="sm" onClick={() => batchAction("archive")} title="Arquivar"><Archive className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => batchAction("spam")} title="Marcar como spam"><AlertOctagon className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => batchAction("trash")} title="Excluir"><Trash2 className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => batchAction("read")} title="Marcar como lido"><Mail className="h-4 w-4" /></Button>
                <span className="ml-2 text-xs text-muted-foreground">{selectedIds.size} selecionado(s)</span>
              </>
            ) : (
              <span className="ml-auto text-xs text-muted-foreground tabular-nums truncate">
                {account ? `${account.email_address} · ` : ""}{filtered.length} mensagens
              </span>
            )}
          </div>
          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Pesquisar emails"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-sm bg-muted/40 border-transparent focus-visible:bg-background"
              />
            </div>
          </div>
        </div>

        {/* List */}
        <ScrollArea className="flex-1">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              <Mail className="mx-auto h-8 w-8 mb-2 opacity-30" />
              Nenhum email em "{FOLDERS.find((f) => f.id === folder)?.label}"
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {filtered.map((email) => {
                const contact = getContactForEmail(email);
                const isOpen = selectedEmail?.id === email.id;
                const senderName = folder === "sent"
                  ? `Para: ${(email.to_emails as string[])?.[0] || "?"}`
                  : contact ? `${contact.first_name} ${contact.last_name || ""}`.trim() : (email.from_email || "Desconhecido");
                const initials = getInitials(senderName);

                return (
                  <div
                    key={email.id}
                    onClick={() => { setSelectedEmail(email); markRead(email.id); setReplyMode(null); }}
                    className={cn(
                      "group flex items-start gap-2 px-3 py-2.5 cursor-pointer transition-colors hover:bg-accent/40 hover:shadow-sm",
                      isOpen && "bg-accent/60",
                      !email.is_read && !isOpen && "bg-primary/[0.04]"
                    )}
                  >
                    <Checkbox
                      checked={selectedIds.has(email.id)}
                      onCheckedChange={(v) => {
                        const next = new Set(selectedIds);
                        v ? next.add(email.id) : next.delete(email.id);
                        setSelectedIds(next);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1.5"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleStar(email); }}
                      className="mt-1 text-muted-foreground hover:text-amber-500 transition-colors"
                      title={email.is_starred ? "Remover estrela" : "Adicionar estrela"}
                    >
                      <Star className={cn("h-4 w-4", email.is_starred && "fill-amber-400 text-amber-500")} />
                    </button>
                    <div
                      className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0 mt-0.5"
                      style={{ background: senderColor(senderName) }}
                    >
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn("text-sm truncate", !email.is_read ? "font-bold text-foreground" : "font-medium text-foreground/90")}>
                          {senderName}
                        </p>
                        <span className={cn("text-[10px] shrink-0 tabular-nums", !email.is_read ? "font-semibold text-foreground" : "text-muted-foreground")}>
                          {timeAgo(email.sent_at || email.created_at)}
                        </span>
                      </div>
                      <p className={cn("text-xs truncate", !email.is_read ? "text-foreground" : "text-muted-foreground")}>
                        <span className={!email.is_read ? "font-semibold" : ""}>{email.subject || "(sem assunto)"}</span>
                        {email.body_html && (
                          <span className="text-muted-foreground"> — {email.body_html.replace(/<[^>]+>/g, " ").slice(0, 80)}</span>
                        )}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {email.importance === "high" && (
                          <Badge variant="outline" className="h-4 text-[8px] border-amber-500/40 text-amber-600">Importante</Badge>
                        )}
                        {email.open_count > 0 && (
                          <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                            <Eye className="h-2.5 w-2.5" />{email.open_count}
                          </span>
                        )}
                        {email.click_count > 0 && (
                          <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                            <MousePointerClick className="h-2.5 w-2.5" />{email.click_count}
                          </span>
                        )}
                        {email.snoozed_until && new Date(email.snoozed_until) > new Date() && (
                          <span className="text-[9px] text-amber-600 flex items-center gap-0.5">
                            <Clock className="h-2.5 w-2.5" />{new Date(email.snoozed_until).toLocaleDateString("pt-BR")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ============== Detail ============== */}
      {selectedEmail && (
        <>
          {expanded && (
            <div
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
              onClick={() => setExpanded(false)}
            />
          )}
          <div
            className={cn(
              expanded
                ? "fixed inset-4 md:inset-10 z-50 bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
                : "flex-1 min-w-0 flex flex-col",
            )}
          >
          {/* Detail toolbar */}
          <div className="border-b border-border px-3 h-12 flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => { setSelectedEmail(null); setExpanded(false); }}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="h-5 w-px bg-border mx-1" />
            {!selectedEmail.is_archived && folder !== "trash" && folder !== "spam" && (
              <Button variant="ghost" size="sm" onClick={() => archiveEmail(selectedEmail.id)} title="Arquivar"><Archive className="h-4 w-4" /></Button>
            )}
            {!selectedEmail.is_spam ? (
              <Button variant="ghost" size="sm" onClick={() => markSpam(selectedEmail.id)} title="Marcar como spam"><AlertOctagon className="h-4 w-4" /></Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => notSpam(selectedEmail.id)} title="Não é spam"><AlertOctagon className="h-4 w-4 text-destructive" /></Button>
            )}
            {!selectedEmail.is_trashed ? (
              <Button variant="ghost" size="sm" onClick={() => trashEmail(selectedEmail.id)} title="Excluir"><Trash2 className="h-4 w-4" /></Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => restoreEmail(selectedEmail.id)} title="Restaurar"><Archive className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" onClick={() => deleteForever(selectedEmail.id)} title="Excluir permanentemente"><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" title="Adiar"><Clock className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => snoozeEmail(selectedEmail.id, 1)}>Daqui 1 hora</DropdownMenuItem>
                <DropdownMenuItem onClick={() => snoozeEmail(selectedEmail.id, 4)}>Daqui 4 horas</DropdownMenuItem>
                <DropdownMenuItem onClick={() => snoozeEmail(selectedEmail.id, 24)}>Amanhã</DropdownMenuItem>
                <DropdownMenuItem onClick={() => snoozeEmail(selectedEmail.id, 24 * 7)}>Próxima semana</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="sm" onClick={() => updateEmail(selectedEmail.id, { is_read: false })} title="Marcar não lido"><Mail className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => toggleImportance(selectedEmail)} title="Importância"><Tag className={cn("h-4 w-4", selectedEmail.importance === "high" && "text-amber-500")} /></Button>
            <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} title={expanded ? "Restaurar" : "Expandir"} className="ml-auto">
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm"><MoreVertical className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => window.print()}><Printer className="mr-2 h-3.5 w-3.5" />Imprimir</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigator.clipboard.writeText(selectedEmail.message_id || selectedEmail.id)}>Copiar ID da mensagem</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <ScrollArea className="flex-1">
            <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <h1 className="text-xl font-semibold leading-tight">{selectedEmail.subject || "(sem assunto)"}</h1>
                <button
                  onClick={() => toggleStar(selectedEmail)}
                  className="text-muted-foreground hover:text-amber-500 mt-1"
                >
                  <Star className={cn("h-5 w-5", selectedEmail.is_starred && "fill-amber-400 text-amber-500")} />
                </button>
              </div>

              {/* Sender header */}
              <div className="flex items-start gap-3 pt-2">
                <div
                  className="h-10 w-10 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
                  style={{ background: senderColor(selectedEmail.from_email || "?") }}
                >
                  {getInitials(selectedEmail.from_email || "?")}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">{selectedEmail.from_email}</p>
                    <span className="text-xs text-muted-foreground tabular-nums">{timeAgo(selectedEmail.sent_at || selectedEmail.created_at)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    para {(selectedEmail.to_emails as string[])?.join(", ")}
                    {(selectedEmail.cc_emails?.length ?? 0) > 0 && <> · cc {selectedEmail.cc_emails.join(", ")}</>}
                  </p>
                  {(selectedEmail.open_count > 0 || selectedEmail.click_count > 0) && (
                    <div className="flex items-center gap-2 mt-1.5">
                      {selectedEmail.open_count > 0 && (
                        <Badge variant="secondary" className="text-[9px] h-4">
                          <Eye className="mr-1 h-2.5 w-2.5" />{selectedEmail.open_count}x aberto
                        </Badge>
                      )}
                      {selectedEmail.click_count > 0 && (
                        <Badge variant="secondary" className="text-[9px] h-4">
                          <MousePointerClick className="mr-1 h-2.5 w-2.5" />{selectedEmail.click_count}x clique
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Body */}
              <div
                className="prose prose-sm dark:prose-invert max-w-none text-foreground pt-4 border-t border-border/60"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedEmail.body_html || "<p class='text-muted-foreground'>(sem conteúdo)</p>", { FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'], FORBID_ATTR: ['onerror', 'onload', 'onclick'] }) }}
              />

              {(selectedEmail.attachments?.length ?? 0) > 0 && (
                <EmailAttachments
                  messageId={selectedEmail.message_id || ""}
                  attachments={selectedEmail.attachments || []}
                />
              )}

              {/* Quick reply chips */}
              {!replyMode && (
                <div className="flex flex-wrap gap-2 pt-4">
                  <Button variant="outline" size="sm" className="rounded-full" onClick={() => setReplyMode("reply")}>
                    <Reply className="mr-1.5 h-3.5 w-3.5" />Responder
                  </Button>
                  {(selectedEmail.cc_emails?.length ?? 0) > 0 && (
                    <Button variant="outline" size="sm" className="rounded-full" onClick={() => setReplyMode("replyAll")}>
                      <ReplyAll className="mr-1.5 h-3.5 w-3.5" />Responder a todos
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="rounded-full" onClick={() => setReplyMode("forward")}>
                    <Forward className="mr-1.5 h-3.5 w-3.5" />Encaminhar
                  </Button>
                </div>
              )}

              {/* Reply composer */}
              {replyMode && (
                <div className="border border-border rounded-lg p-3 space-y-2 bg-card">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {replyMode === "reply" && `Responder a ${selectedEmail.from_email}`}
                      {replyMode === "replyAll" && "Responder a todos"}
                      {replyMode === "forward" && "Encaminhar"}
                    </p>
                    <Button variant="ghost" size="sm" onClick={() => { setReplyMode(null); setReplyBody(""); setForwardTo(""); }}>×</Button>
                  </div>
                  {replyMode === "forward" && (
                    <Input
                      placeholder="Para (separados por vírgula)"
                      value={forwardTo}
                      onChange={(e) => setForwardTo(e.target.value)}
                      className="h-8 text-sm"
                    />
                  )}
                  <Textarea
                    placeholder="Escreva sua mensagem..."
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    rows={6}
                    className="text-sm resize-none"
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setReplyMode(null); setReplyBody(""); setForwardTo(""); }}>
                      Descartar
                    </Button>
                    <Button size="sm" onClick={() => sendReply(replyMode)} disabled={!replyBody.trim() || (replyMode === "forward" && !forwardTo.trim())}>
                      <Send className="mr-1.5 h-3.5 w-3.5" />Enviar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
          </div>
        </>
      )}

      <EmailComposeModal open={composeOpen} onOpenChange={setComposeOpen} defaultPurpose={purpose} onSent={() => { if (orgId) qc.invalidateQueries({ queryKey: emailsKeys.all(orgId) }); }} />
    </div>
  );
}

function formatBytes(n: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function EmailAttachments({
  messageId,
  attachments,
}: {
  messageId: string;
  attachments: Array<{ filename: string; mime_type: string; size: number; attachment_id: string }>;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [previewing, setPreviewing] = useState<{ url: string; mime: string; name: string } | null>(null);

  const fetchAttachment = useCallback(async (att: { attachment_id: string; mime_type: string; filename: string }) => {
    if (urls[att.attachment_id]) return urls[att.attachment_id];
    setLoading((s) => ({ ...s, [att.attachment_id]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("gmail-attachment", {
        body: { message_id: messageId, attachment_id: att.attachment_id, mime_type: att.mime_type },
      });
      if (error || !data?.data_url) throw new Error(data?.error || error?.message || "Falha ao baixar");
      setUrls((u) => ({ ...u, [att.attachment_id]: data.data_url }));
      return data.data_url as string;
    } catch (e: any) {
      toast({ title: "Erro ao baixar anexo", description: e.message, variant: "destructive" });
      return null;
    } finally {
      setLoading((s) => ({ ...s, [att.attachment_id]: false }));
    }
  }, [messageId, urls, toast]);

  // Auto-load images for inline preview
  useEffect(() => {
    attachments.forEach((att) => {
      if (att.mime_type?.startsWith("image/") && !urls[att.attachment_id] && !loading[att.attachment_id]) {
        fetchAttachment(att);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments, messageId]);

  const handleDownload = async (att: { attachment_id: string; mime_type: string; filename: string }) => {
    const url = urls[att.attachment_id] || await fetchAttachment(att);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = att.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handlePreview = async (att: { attachment_id: string; mime_type: string; filename: string }) => {
    const url = urls[att.attachment_id] || await fetchAttachment(att);
    if (!url) return;
    setPreviewing({ url, mime: att.mime_type, name: att.filename });
  };

  return (
    <div className="pt-4 border-t border-border/60 space-y-2">
      <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
        <Paperclip className="h-3.5 w-3.5" />
        {attachments.length} anexo{attachments.length > 1 ? "s" : ""}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {attachments.map((att) => {
          const isImg = att.mime_type?.startsWith("image/");
          const isPdf = att.mime_type === "application/pdf";
          const url = urls[att.attachment_id];
          const isLoading = loading[att.attachment_id];
          return (
            <div key={att.attachment_id} className="border border-border rounded-lg p-2 bg-card flex flex-col gap-2">
              {isImg && url ? (
                <button
                  type="button"
                  onClick={() => handlePreview(att)}
                  className="bg-muted rounded overflow-hidden h-32 flex items-center justify-center"
                >
                  <img src={url} alt={att.filename} className="max-h-full max-w-full object-contain" />
                </button>
              ) : (
                <div className="bg-muted rounded h-32 flex items-center justify-center">
                  {isLoading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  ) : isImg ? (
                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                  ) : (
                    <FileText className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate" title={att.filename}>{att.filename}</p>
                  <p className="text-[10px] text-muted-foreground">{formatBytes(att.size)}</p>
                </div>
                <div className="flex gap-1">
                  {(isImg || isPdf) && (
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handlePreview(att)} disabled={isLoading} title="Visualizar">
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleDownload(att)} disabled={isLoading} title="Baixar">
                    {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {previewing && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewing(null)}
        >
          <div className="bg-background rounded-lg overflow-hidden max-w-5xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-border">
              <p className="text-sm font-medium truncate">{previewing.name}</p>
              <div className="flex gap-2">
                <a href={previewing.url} download={previewing.name}>
                  <Button variant="outline" size="sm"><Download className="h-3.5 w-3.5 mr-1" />Baixar</Button>
                </a>
                <Button variant="ghost" size="sm" onClick={() => setPreviewing(null)}>×</Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-muted">
              {previewing.mime.startsWith("image/") ? (
                <img src={previewing.url} alt={previewing.name} className="max-w-full mx-auto" />
              ) : (
                <iframe src={previewing.url} title={previewing.name} className="w-full h-[80vh] bg-white" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

