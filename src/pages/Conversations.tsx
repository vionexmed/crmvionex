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
  Search, Send, Loader2, CheckCheck, Phone, AlertCircle, AtSign,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import { formatarDataCurta, formatarHora } from "@/lib/formato";
import { mensagemErro } from "@/lib/erro-supabase";
import { formatarTelefone } from "@/lib/contato-formato";

/**
 * Atendimento de UM canal. A rota decide qual: `/conversations` é WhatsApp,
 * `/instagram` é Direct.
 *
 * Uma tela por canal, e não uma tela com filtro dentro: quem troca de canal é a
 * barra lateral, que é como a pessoa pensa. Duas ROTAS e não `?canal=` porque o
 * `isActive` do menu compara por `pathname.startsWith` -- com query string os
 * dois itens ficariam apagados, já que o pathname seria o mesmo.
 *
 * A leitura vem da VIEW `mensagens_do_atendimento`, que une as duas tabelas com
 * uma coluna `canal`, e o filtro por canal vai no BANCO. No cliente, o `limit` de
 * 2000 cortaria antes da separação -- e conversa recente de um canal ficaria de
 * fora por causa de conversa velha do outro.
 *
 * O QUE NÃO SE UNIFICA, e é de propósito:
 *
 * - a CONVERSA. Mesma pessoa no WhatsApp e no Instagram são duas conversas, e a
 *   chave da thread inclui o canal. Juntar seria bonito e errado: as duas têm
 *   janela própria e rota de envio própria, e uma pode estar aberta enquanto a
 *   outra fechou. Uma thread misturada teria um campo de texto que às vezes
 *   envia e às vezes não, sem nada na tela explicando por quê;
 * - a JANELA. No WhatsApp, fora das 24h só com template aprovado. No Instagram,
 *   24h livres e até 7 dias com atendimento humano -- que a função de envio
 *   aplica sozinha. São regras diferentes da Meta, não uma regra com exceções.
 */

type Canal = "whatsapp" | "instagram";

/** Linha da view. `de`/`para` são telefone no WhatsApp e IGSID no Instagram. */
type Mensagem = {
  id: string;
  canal: Canal;
  org_id: string;
  contact_id: string | null;
  direction: "inbound" | "outbound";
  de: string;
  para: string;
  body: string | null;
  message_type: string;
  status: string;
  created_at: string;
};

type Contato = {
  name: string;
  phone: string | null;
  instagram_username: string | null;
};

type Thread = {
  /** `canal:contact_id` ou `canal:identidade`. O canal faz parte da chave. */
  key: string;
  canal: Canal;
  contact_id: string | null;
  /** Telefone ou IGSID de quem está do outro lado. */
  identidade: string;
  contact_name: string | null;
  instagram_username: string | null;
  last_body: string | null;
  last_at: string;
  last_inbound_at: string | null;
};

const ROTULO_CANAL: Record<Canal, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
};

function formatTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return formatarHora(d);
  return formatarDataCurta(d);
}

/**
 * Como chamar quem está do outro lado.
 *
 * Sem o nome do contato, o rótulo depende do canal: telefone formatado no
 * WhatsApp, `@` no Instagram. Mostrar o IGSID cru seria mostrar
 * "17841400000000000" na lista -- um número que não identifica ninguém e que
 * parece defeito.
 */
function rotuloDaThread(t: Thread): string {
  if (t.contact_name) return t.contact_name;
  if (t.canal === "instagram") {
    return t.instagram_username ? `@${t.instagram_username}` : "Instagram (sem nome)";
  }
  return formatarTelefone(t.identidade);
}

function initials(nome: string) {
  const termos = nome.replace(/^@/, "").trim().split(/\s+/).filter(Boolean);
  if (termos.length === 0) return "?";
  if (termos.length === 1) return termos[0].slice(0, 2).toUpperCase();
  return (termos[0][0] + termos[termos.length - 1][0]).toUpperCase();
}

/**
 * Estado da janela de resposta, por canal.
 *
 * `podeEnviar` é o que libera o campo de texto, e `aviso` é o que explica quando
 * ele está bloqueado -- ou quando vai sair caro. Campo desabilitado sem
 * explicação é o que faz a pessoa achar que a tela quebrou.
 */
function janelaDaThread(t: Thread | null): { podeEnviar: boolean; aviso: string | null } {
  if (!t?.last_inbound_at) {
    return {
      podeEnviar: false,
      aviso: t
        ? "Esta pessoa nunca escreveu por aqui, e nenhum dos dois canais permite iniciar conversa sem isso."
        : null,
    };
  }

  const horas = (Date.now() - new Date(t.last_inbound_at).getTime()) / 3_600_000;

  if (t.canal === "whatsapp") {
    return horas < 24
      ? { podeEnviar: true, aviso: null }
      : {
        podeEnviar: false,
        aviso: "Passaram-se mais de 24h desde a última mensagem dela. " +
          "No WhatsApp, reabrir a conversa exige um template aprovado.",
      };
  }

  // Instagram: 24h livre, 7 dias com atendimento humano, nada depois.
  if (horas < 24) return { podeEnviar: true, aviso: null };
  if (horas < 24 * 7) {
    return {
      podeEnviar: true,
      aviso: "Fora das 24h. A resposta vai marcada como atendimento humano, " +
        "que é o que o Instagram permite até 7 dias.",
    };
  }
  return {
    podeEnviar: false,
    aviso: "Passaram-se mais de 7 dias. O Instagram não permite responder depois disso — " +
      "use WhatsApp ou e-mail para retomar.",
  };
}

export default function Conversations({ canal }: { canal: Canal }) {
  const { orgId } = useOrg();
  const { toast } = useToast();
  const [temWhatsapp, setTemWhatsapp] = useState<boolean | null>(null);
  const [temInstagram, setTemInstagram] = useState<boolean | null>(null);
  const [allMessages, setAllMessages] = useState<Mensagem[]>([]);
  const [contactsMap, setContactsMap] = useState<Record<string, Contato>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // ---------- que canais existem ----------
  useEffect(() => {
    if (!orgId) return;
    void (async () => {
      const [wa, ig] = await Promise.all([
        supabase.from("whatsapp_config").select("id").eq("org_id", orgId).maybeSingle(),
        supabase.from("instagram_connections").select("id")
          .eq("org_id", orgId).eq("is_active", true).limit(1).maybeSingle(),
      ]);
      setTemWhatsapp(!!wa.data);
      setTemInstagram(!!ig.data);
    })();
  }, [orgId]);

  // ---------- as mensagens ----------
  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from("mensagens_do_atendimento")
        .select("*")
        .eq("org_id", orgId)
        /*
         * Filtra no BANCO, não no cliente.
         * Com o filtro no cliente, o `limit` de 2000 cortava antes da separação
         * por canal -- então conversa recente de um canal podia ficar de fora por
         * causa de conversa velha do outro. Agora cada tela pede só o que mostra.
         */
        .eq("canal", canal)
        // DESC no banco e reversão aqui: com ASC, o `limit` de 2000 traria as
        // mensagens MAIS ANTIGAS da organização e a tela abriria vazia numa base
        // grande. O que se quer truncar é o passado, não o presente.
        .order("created_at", { ascending: false })
        .limit(2000);

      if (error) {
        toast({ title: "Erro ao carregar mensagens", description: mensagemErro(error), variant: "destructive" });
        setLoading(false);
        return;
      }

      const msgs = ((data ?? []) as Mensagem[]).slice().reverse();
      setAllMessages(msgs);

      const ids = Array.from(new Set(msgs.map((m) => m.contact_id).filter(Boolean))) as string[];
      if (ids.length > 0) {
        const { data: cs } = await supabase
          .from("contacts")
          .select("id, first_name, last_name, phone, instagram_username")
          .in("id", ids);
        const map: Record<string, Contato> = {};
        for (const c of cs ?? []) {
          map[c.id] = {
            name: [c.first_name, c.last_name].filter(Boolean).join(" "),
            phone: c.phone,
            instagram_username: c.instagram_username,
          };
        }
        setContactsMap(map);
      }
      setLoading(false);
    })();
  }, [orgId, canal, toast]);

  // ---------- tempo real ----------
  /*
   * DUAS assinaturas, uma por TABELA.
   *
   * `postgres_changes` escuta replicação, que é de tabela -- view não emite
   * evento. Assinar `mensagens_do_atendimento` não daria erro: simplesmente
   * nunca chegaria nada, e o sintoma seria "mensagem nova só aparece se eu
   * recarregar". Então cada tabela é assinada e a linha é convertida para a
   * forma da view aqui.
   */
  useEffect(() => {
    if (!orgId) return;

    const paraMensagem = (canal: Canal, linha: Record<string, unknown>): Mensagem => ({
      id: linha.id as string,
      canal,
      org_id: linha.org_id as string,
      contact_id: (linha.contact_id as string | null) ?? null,
      direction: linha.direction as "inbound" | "outbound",
      de: (canal === "whatsapp" ? linha.from_number : linha.from_igsid) as string,
      para: (canal === "whatsapp" ? linha.to_number : linha.to_igsid) as string,
      body: (linha.body as string | null) ?? null,
      message_type: linha.message_type as string,
      status: linha.status as string,
      created_at: linha.created_at as string,
    });

    const assinar = (canal: Canal, tabela: string) =>
      supabase
        .channel(`atendimento-${canal}-${orgId}`)
        .on("postgres_changes",
          { event: "*", schema: "public", table: tabela, filter: `org_id=eq.${orgId}` },
          (payload) => {
            if (payload.eventType === "DELETE") return;
            const m = paraMensagem(canal, payload.new as Record<string, unknown>);
            setAllMessages((prev) => {
              const i = prev.findIndex((x) => x.id === m.id);
              if (i === -1) return [...prev, m];
              const copia = prev.slice();
              copia[i] = m;
              return copia;
            });
          })
        .subscribe();

    // Uma assinatura só: a do canal desta tela. Assinar as duas traria mensagem
    // que esta tela filtra fora, e o filtro do `postgres_changes` é por tabela.
    const assinatura = canal === "instagram"
      ? assinar("instagram", "instagram_messages")
      : assinar("whatsapp", "whatsapp_messages");
    return () => { supabase.removeChannel(assinatura); };
  }, [orgId, canal]);

  // ---------- threads ----------
  const threads = useMemo<Thread[]>(() => {
    const map = new Map<string, Thread>();
    for (const m of allMessages) {
      const identidade = m.direction === "inbound" ? m.de : m.para;
      // O canal entra na chave: ver o cabeçalho do arquivo.
      const key = `${m.canal}:${m.contact_id || identidade}`;
      const existing = map.get(key);
      const info = m.contact_id ? contactsMap[m.contact_id] : null;

      if (!existing) {
        map.set(key, {
          key,
          canal: m.canal,
          contact_id: m.contact_id,
          identidade,
          contact_name: info?.name || null,
          instagram_username: info?.instagram_username || null,
          last_body: m.body,
          last_at: m.created_at,
          last_inbound_at: m.direction === "inbound" ? m.created_at : null,
        });
        continue;
      }

      if (m.created_at > existing.last_at) {
        existing.last_body = m.body;
        existing.last_at = m.created_at;
      }
      if (m.direction === "inbound" && (!existing.last_inbound_at || m.created_at > existing.last_inbound_at)) {
        existing.last_inbound_at = m.created_at;
      }
      if (!existing.contact_name && info?.name) existing.contact_name = info.name;
      if (!existing.instagram_username && info?.instagram_username) {
        existing.instagram_username = info.instagram_username;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.last_at.localeCompare(a.last_at));
  }, [allMessages, contactsMap]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) =>
      (t.contact_name ?? "").toLowerCase().includes(q) ||
      (t.instagram_username ?? "").toLowerCase().includes(q) ||
      t.identidade.includes(q) ||
      (t.last_body ?? "").toLowerCase().includes(q),
    );
  }, [threads, search]);

  const selected = threads.find((t) => t.key === selectedKey) || null;

  const selectedMessages = useMemo(() => {
    if (!selected) return [];
    return allMessages.filter((m) => {
      if (m.canal !== selected.canal) return false;
      if (selected.contact_id) return m.contact_id === selected.contact_id;
      const peer = m.direction === "inbound" ? m.de : m.para;
      return peer === selected.identidade && !m.contact_id;
    });
  }, [allMessages, selected]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }), 50);
  }, [selectedKey, selectedMessages.length]);

  const janela = janelaDaThread(selected);

  async function handleSend() {
    if (!selected || !draft.trim() || !janela.podeEnviar) return;

    /*
     * O Instagram exige contato, o WhatsApp não.
     *
     * No Instagram o destinatário é o IGSID, e ele mora em
     * `contacts.instagram_igsid` -- sem contato não há para onde enviar. No
     * WhatsApp o telefone está na própria mensagem, então dá para responder uma
     * conversa que ainda não virou contato.
     */
    if (selected.canal === "instagram" && !selected.contact_id) {
      toast({
        title: "Sem contato vinculado",
        description: "Esta conversa do Instagram não está ligada a um contato, e o envio precisa dele.",
        variant: "destructive",
      });
      return;
    }

    setSending(true);
    const text = draft.trim();
    setDraft("");
    try {
      const { data, error } = selected.canal === "instagram"
        ? await supabase.functions.invoke("instagram-send", {
          body: { contactId: selected.contact_id, text },
        })
        : await supabase.functions.invoke("whatsapp-send", {
          body: { to: selected.identidade, text, contactId: selected.contact_id },
        });

      if (error || data?.error) throw new Error(data?.error || error?.message);
    } catch (e) {
      toast({ title: "Erro ao enviar", description: mensagemErro(e), variant: "destructive" });
      // Devolve o texto: perder o que se digitou por causa de uma falha de rede
      // é o pior desfecho possível numa caixa de mensagem.
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  /*
   * Só avisa sobre o canal DESTA tela. Antes o aviso exigia que os dois
   * estivessem desconectados, então quem tinha WhatsApp e não tinha Instagram
   * abria a tela do Instagram vazia, sem nada dizendo o porquê.
   */
  const canalDesconectado = canal === "instagram" ? temInstagram === false : temWhatsapp === false;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <PageHeader
        title={ROTULO_CANAL[canal]}
        description={canal === "instagram"
          ? "Direct do perfil da empresa, na ordem em que chegaram"
          : "Mensagens do seu número, na ordem em que chegaram"}
        contagem={{ valor: threads.length, unidade: "conversa" }}
      />

      {canalDesconectado && (
        <div className="m-4 flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
          <div className="flex-1">
            {ROTULO_CANAL[canal]} ainda não está conectado.{" "}
            <Link to="/settings/integrations" className="font-medium underline">Conectar agora</Link>
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
                {search.trim() ? "Nada encontrado." : "Nenhuma conversa ainda."}
              </div>
            ) : (
              <ul className="divide-y">
                {filtered.map((t) => {
                  const nome = rotuloDaThread(t);
                  return (
                    <li key={t.key}>
                      <button onClick={() => setSelectedKey(t.key)}
                        className={cn(
                          "flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-accent/50",
                          selectedKey === t.key && "bg-accent",
                        )}>
                        {/* Sem selo de canal: ele existia para desambiguar lista
                            misturada, e agora a tela inteira é de um canal só --
                            o título da página e a barra lateral já dizem qual. */}
                        <Avatar className="h-9 w-9 shrink-0">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {initials(nome)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-1 flex-col overflow-hidden">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium">{nome}</span>
                            <span className="shrink-0 text-label text-muted-foreground">
                              {formatTime(t.last_at)}
                            </span>
                          </div>
                          <span className="truncate text-xs text-muted-foreground">
                            {t.last_body || "Sem mensagens"}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
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
                      {initials(rotuloDaThread(selected))}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="text-sm font-medium">{rotuloDaThread(selected)}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      {selected.canal === "instagram" ? (
                        <>
                          <AtSign className="h-3 w-3" />
                          {selected.instagram_username ?? "Instagram Direct"}
                        </>
                      ) : (
                        <>
                          <Phone className="h-3 w-3" />
                          {formatarTelefone(selected.identidade)}
                        </>
                      )}
                      <span className="mx-1 text-muted-foreground/50">·</span>
                      {ROTULO_CANAL[selected.canal]}
                    </div>
                  </div>
                </div>
                {selected.contact_id && (
                  <Button variant="outline" size="sm" className="h-8 text-label" asChild>
                    <Link to={`/contacts?id=${selected.contact_id}`}>Ver contato</Link>
                  </Button>
                )}
              </header>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
                <ul className="space-y-2">
                  {selectedMessages.map((m) => {
                    const isOut = m.direction === "outbound";
                    return (
                      <li key={m.id} className={cn("flex", isOut ? "justify-end" : "justify-start")}>
                        <div className={cn(
                          "max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm",
                          isOut ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                        )}>
                          <div className="whitespace-pre-wrap break-words">
                            {/* Mensagem sem texto é anexo. Sem esta linha a bolha
                                aparece VAZIA, e bolha vazia parece defeito da
                                tela -- não "ela mandou uma foto". */}
                            {m.body || <span className="italic opacity-80">{descricaoDeAnexo(m.message_type)}</span>}
                          </div>
                          <div className={cn(
                            "mt-1 flex items-center justify-end gap-1 text-label",
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
                {janela.aviso && (
                  <div className={cn(
                    "mb-2 rounded-md border px-2 py-1.5 text-label",
                    janela.podeEnviar
                      // Aviso que não bloqueia é informação, não alarme.
                      ? "border-border bg-muted text-muted-foreground"
                      : "border-warning/30 bg-warning/10 text-warning",
                  )}>
                    {janela.aviso}
                  </div>
                )}
                <div className="flex gap-2">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
                    }}
                    placeholder={janela.podeEnviar ? "Digite uma mensagem..." : "Janela de resposta fechada"}
                    disabled={!janela.podeEnviar || sending}
                    rows={2}
                    className="resize-none"
                  />
                  <Button onClick={() => void handleSend()}
                    disabled={!draft.trim() || sending || !janela.podeEnviar}>
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

/**
 * Rótulo para mensagem sem texto.
 *
 * Repetido do `descricaoDeConteudo` da edge function de propósito: aquele roda
 * no Deno e este no navegador, e importar de `supabase/functions` para dentro do
 * `src` puxaria o mundo do Deno para o build do Vite.
 */
function descricaoDeAnexo(tipo: string): string {
  const mapa: Record<string, string> = {
    image: "Imagem",
    video: "Vídeo",
    audio: "Áudio",
    file: "Arquivo",
    document: "Documento",
    share: "Publicação compartilhada",
    ig_reel: "Reel",
    story_mention: "Mencionou você num story",
    story_reply: "Respondeu ao seu story",
    unsupported: "Conteúdo não suportado",
  };
  return mapa[tipo] ?? "Mensagem sem texto";
}
