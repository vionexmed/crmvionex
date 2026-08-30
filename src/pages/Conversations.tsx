import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  MessageSquare, Search, Send, Loader2, CheckCheck, Phone, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";

type WAMessage = {
  id: string;
  org_id: string;
  contact_id: string | null;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  body: string | null;
  message_type: string;
  status: string;
  created_at: string;
};

type Thread = {
  key: string; // contact_id or phone
  contact_id: string | null;
  phone: string;
  contact_name: string | null;
  last_body: string | null;
  last_at: string;
  last_inbound_at: string | null;
};

function formatTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function initials(name: string | null, phone: string) {
  if (name) {
    return name.split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  }
  return phone.slice(-2);
}

export default function Conversations() {
  const { orgId } = useOrg();
  const { toast } = useToast();
  const [hasConfig, setHasConfig] = useState<boolean | null>(null);
  const [allMessages, setAllMessages] = useState<WAMessage[]>([]);
  const [contactsMap, setContactsMap] = useState<Record<string, { name: string; phone: string | null }>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Check config
  useEffect(() => {
    if (!orgId) return;
    supabase.from("whatsapp_config").select("id").eq("org_id", orgId).maybeSingle()
      .then(({ data }) => setHasConfig(!!data));
  }, [orgId]);

  // Load messages
  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true })
      .limit(2000)
      .then(async ({ data, error }) => {
        if (error) {
          toast({ title: "Erro ao carregar mensagens", description: error.message, variant: "destructive" });
          setLoading(false);
          return;
        }
        const msgs = (data ?? []) as WAMessage[];
        setAllMessages(msgs);

        // Load contact names
        const ids = Array.from(new Set(msgs.map(m => m.contact_id).filter(Boolean))) as string[];
        if (ids.length > 0) {
          const { data: cs } = await supabase
            .from("contacts")
            .select("id, first_name, last_name, phone")
            .in("id", ids);
          const map: Record<string, { name: string; phone: string | null }> = {};
          for (const c of cs ?? []) {
            map[c.id] = {
              name: [c.first_name, c.last_name].filter(Boolean).join(" "),
              phone: c.phone,
            };
          }
          setContactsMap(map);
        }
        setLoading(false);
      });
  }, [orgId]);

  // Realtime
  useEffect(() => {
    if (!orgId) return;
    const ch = supabase
      .channel(`wa-msgs-${orgId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_messages", filter: `org_id=eq.${orgId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setAllMessages(prev => prev.some(m => m.id === (payload.new as any).id) ? prev : [...prev, payload.new as WAMessage]);
          } else if (payload.eventType === "UPDATE") {
            setAllMessages(prev => prev.map(m => m.id === (payload.new as any).id ? payload.new as WAMessage : m));
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orgId]);

  // Group into threads
  const threads = useMemo<Thread[]>(() => {
    const map = new Map<string, Thread>();
    for (const m of allMessages) {
      const peerPhone = m.direction === "inbound" ? m.from_number : m.to_number;
      const key = m.contact_id || `phone:${peerPhone}`;
      const existing = map.get(key);
      const contactInfo = m.contact_id ? contactsMap[m.contact_id] : null;
      if (!existing) {
        map.set(key, {
          key,
          contact_id: m.contact_id,
          phone: peerPhone,
          contact_name: contactInfo?.name || null,
          last_body: m.body,
          last_at: m.created_at,
          last_inbound_at: m.direction === "inbound" ? m.created_at : null,
        });
      } else {
        if (m.created_at > existing.last_at) {
          existing.last_body = m.body;
          existing.last_at = m.created_at;
        }
        if (m.direction === "inbound" && (!existing.last_inbound_at || m.created_at > existing.last_inbound_at)) {
          existing.last_inbound_at = m.created_at;
        }
        if (!existing.contact_name && contactInfo?.name) existing.contact_name = contactInfo.name;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.last_at.localeCompare(a.last_at));
  }, [allMessages, contactsMap]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(t =>
      (t.contact_name ?? "").toLowerCase().includes(q) ||
      t.phone.includes(q) ||
      (t.last_body ?? "").toLowerCase().includes(q),
    );
  }, [threads, search]);

  const selected = filtered.find(t => t.key === selectedKey) || threads.find(t => t.key === selectedKey) || null;

  const selectedMessages = useMemo(() => {
    if (!selected) return [];
    return allMessages.filter(m => {
      if (selected.contact_id) return m.contact_id === selected.contact_id;
      const peer = m.direction === "inbound" ? m.from_number : m.to_number;
      return peer === selected.phone && !m.contact_id;
    });
  }, [allMessages, selected]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }), 50);
  }, [selectedKey, selectedMessages.length]);

  // Within 24h window?
  const within24h = selected?.last_inbound_at
    ? Date.now() - new Date(selected.last_inbound_at).getTime() < 24 * 3600 * 1000
    : false;

  async function handleSend() {
    if (!selected || !draft.trim()) return;
    if (!within24h) {
      toast({
        title: "Fora da janela de 24h",
        description: "Para mensagens fora de 24h após a última resposta do contato, é necessário usar um template aprovado.",
        variant: "destructive",
      });
      return;
    }
    setSending(true);
    const text = draft.trim();
    setDraft("");
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: { to: selected.phone, text, contactId: selected.contact_id },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
    } catch (e: any) {
      toast({ title: "Erro ao enviar", description: e?.message || String(e), variant: "destructive" });
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <PageHeader
        icon={MessageSquare}
        kicker="Atendimento"
        title="Conversas WhatsApp"
        description="Mensagens via WhatsApp Business API (Meta Oficial)"
      />

      {hasConfig === false && (
        <div className="m-4 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
          <div className="flex-1">
            WhatsApp Business ainda não está configurado.{" "}
            <Link to="/settings/integrations" className="font-medium underline">Configurar agora</Link>
          </div>
        </div>
      )}

      <div className="grid flex-1 grid-cols-[320px_1fr] overflow-hidden border-t">
        <aside className="flex flex-col border-r bg-card">
          <div className="border-b p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar..." className="pl-8" />
            </div>
          </div>
          <ScrollArea className="flex-1">
            {loading ? (
              <div className="flex items-center justify-center p-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma conversa ainda.
              </div>
            ) : (
              <ul className="divide-y">
                {filtered.map((t) => (
                  <li key={t.key}>
                    <button onClick={() => setSelectedKey(t.key)}
                      className={cn(
                        "flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-accent/50",
                        selectedKey === t.key && "bg-accent",
                      )}>
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">
                          {initials(t.contact_name, t.phone)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-1 flex-col overflow-hidden">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">
                            {t.contact_name || `+${t.phone}`}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {formatTime(t.last_at)}
                          </span>
                        </div>
                        <span className="truncate text-xs text-muted-foreground">
                          {t.last_body || "Sem mensagens"}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </aside>

        <section className="flex flex-col overflow-hidden bg-background">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              Selecione uma conversa
            </div>
          ) : (
            <>
              <header className="flex items-center justify-between gap-3 border-b bg-card p-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {initials(selected.contact_name, selected.phone)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="text-sm font-medium">
                      {selected.contact_name || `+${selected.phone}`}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" />+{selected.phone}
                    </div>
                  </div>
                </div>
              </header>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
                <ul className="space-y-2">
                  {selectedMessages.map((m) => {
                    const isOut = m.direction === "outbound";
                    return (
                      <li key={m.id} className={cn("flex", isOut ? "justify-end" : "justify-start")}>
                        <div className={cn(
                          "max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                          isOut ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                        )}>
                          <div className="whitespace-pre-wrap break-words">{m.body}</div>
                          <div className={cn(
                            "mt-1 flex items-center justify-end gap-1 text-[10px]",
                            isOut ? "text-primary-foreground/70" : "text-muted-foreground",
                          )}>
                            {formatTime(m.created_at)}
                            {isOut && (m.status === "delivered" || m.status === "read") && <CheckCheck className="h-3 w-3" />}
                            {isOut && m.status === "failed" && <AlertCircle className="h-3 w-3 text-destructive" />}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <footer className="border-t bg-card p-3">
                {!within24h && (
                  <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700">
                    Janela de 24h expirada. Você precisará usar um template aprovado para reabrir a conversa.
                  </div>
                )}
                <div className="flex gap-2">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                    }}
                    placeholder={within24h ? "Digite uma mensagem..." : "Janela de 24h expirada"}
                    disabled={!within24h || sending}
                    rows={2}
                    className="resize-none"
                  />
                  <Button onClick={handleSend} disabled={!draft.trim() || sending || !within24h}>
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </footer>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
