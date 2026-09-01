import { useState, useMemo, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useEmails, useInboxContacts, useUpdateEmail, useDeleteEmail, useEmailConnections, emailsKeys } from "@/hooks/queries/useEmails";
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
  Paperclip, Download, Image as ImageIcon, Loader2, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, RotateCcw,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { EmailComposeModal } from "@/components/crm/EmailComposeModal";
import { mensagemErro, erroDaFuncao } from "@/lib/erro-supabase";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
// `Folder as FolderIcon` porque `Folder` já é o TIPO das sete abas locais desta
// tela -- o nome colidiria e o erro seria "only refers to a type".
import { FolderInput, Folder as FolderIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import DOMPurify from "dompurify";
import type { Email, InboxContact as Contact } from "@/lib/api/emails";
import { formatarData, formatarDataCurta, textoDeHtml, pluralizar } from "@/lib/formato";
import { SemOrganizacao } from "@/components/layout/SemOrganizacao";

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

export default function Inbox() {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: allEmails = [] } = useEmails();
  const { data: connections = [] } = useEmailConnections();
  const { data: contacts = [] } = useInboxContacts();

  // A conta é SEMPRE a da própria pessoa. Antes vinha por `purpose`
  // (sales/marketing), do modelo de duas caixas da empresa — que foi
  // substituído por uma conta por pessoa (scope_type = 'user').
  const account = connections.find((c) => c.user_id === user?.id);

  // Cada pessoa vê o que a própria conta sincronizou. Os e-mails antigos, sem
  // `synced_from`, continuam aparecendo — senão o histórico desapareceria da
  // tela ao trocar o modelo.
  const emails = useMemo(() => {
    const meu = account?.email_address?.toLowerCase();
    if (!meu) return allEmails;
    return allEmails.filter((e) => !e.synced_from || e.synced_from.toLowerCase() === meu);
  }, [allEmails, account]);
  const updateEmailMutation = useUpdateEmail();
  const deleteEmailMutation = useDeleteEmail();

  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState<Folder>("inbox");
  /**
   * As pastas REAIS da conta de Gmail. Vazio até a primeira busca, e vazio
   * também quando a conta não tem pasta nenhuma — os dois casos mostram a mesma
   * coisa na tela, e é o certo: não há para onde mover.
   */
  const [pastas, setPastas] = useState<{ id: string; nome: string }[]>([]);
  const [pastaAberta, setPastaAberta] = useState(false);
  const [novaPasta, setNovaPasta] = useState("");

  /*
   * Pastas recolhidas: 224px de volta para a leitura.
   *
   * A tela divide a largura em QUATRO -- navegação do app, pastas, lista,
   * mensagem. Num monitor de 1440px sobravam ~470px para o corpo do e-mail, e
   * era daí que vinha a sensação de aperto: nenhuma coluna estava apertada por
   * dentro, eram colunas demais.
   *
   * Recolher é MANUAL e lembrado, não automático ao abrir a mensagem: mexer no
   * layout sozinho faz a lista pular embaixo do cursor -- a pessoa clica num
   * e-mail e a linha seguinte já está em outro lugar.
   */
  const [pastasRecolhidas, setPastasRecolhidas] = useState(
    () => localStorage.getItem("vx-inbox-pastas-recolhidas") === "1",
  );
  const alternarPastas = () => {
    setPastasRecolhidas((v) => {
      localStorage.setItem("vx-inbox-pastas-recolhidas", v ? "0" : "1");
      return !v;
    });
  };
  const [pastasCarregando, setPastasCarregando] = useState(false);
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

  /**
   * Busca as pastas da conta. Só quando o seletor abre — a lista raramente muda,
   * e buscar no carregamento da tela custaria uma chamada ao Google em toda
   * visita a E-mail, para uma informação que quase ninguém usa em cada visita.
   */
  const carregarPastas = async () => {
    if (pastas.length > 0) return;
    setPastasCarregando(true);
    try {
      const { data, error } = await supabase.functions.invoke("gmail-labels", {
        body: { acao: "listar" },
      });
      if (error || !data?.ok) {
        toast({
          title: "Não consegui listar suas pastas",
          description: data?.error ?? mensagemErro(error),
          variant: "destructive",
        });
        return;
      }
      setPastas(data.pastas ?? []);
    } finally {
      setPastasCarregando(false);
    }
  };

  const criarPasta = async () => {
    const nome = novaPasta.trim();
    if (!nome) return;
    const { data, error } = await supabase.functions.invoke("gmail-labels", {
      body: { acao: "criar", nome },
    });
    if (error || !data?.ok) {
      toast({ title: "Não deu para criar a pasta", description: data?.error ?? mensagemErro(error), variant: "destructive" });
      return;
    }
    setPastas((p) => [...p, data.pasta].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
    setNovaPasta("");
    toast({ title: `Pasta "${data.pasta.nome}" criada` });
  };

  /**
   * O EFEITO LOCAL DE CADA AÇÃO, espelhando `LOCAL` de `gmail-modify`.
   *
   * Existe para a tela mudar NO CLIQUE, e não depois da ida ao Gmail. Sem isto o
   * caminho era: função de borda (cold start), chamada ao Gmail, gravação, e só
   * então a lista inteira recarregando -- segundos com a tela parada, e a
   * sensação de que o clique não pegou. Foi o que aconteceu.
   *
   * Duplicar o mapa é dívida assumida: o servidor roda no Deno e não dá para
   * importar de `supabase/functions` para dentro do `src` sem puxar o mundo do
   * Deno para o build do Vite. Um teste compara os dois e reprova se divergirem.
   */
  const EFEITO_LOCAL: Record<string, Partial<Email>> = {
    arquivar: { is_archived: true },
    desarquivar: { is_archived: false },
    ler: { is_read: true },
    nao_ler: { is_read: false },
    spam: { is_spam: true, is_read: true },
    nao_spam: { is_spam: false },
    lixeira: { is_trashed: true },
    restaurar: { is_trashed: false, is_archived: false, is_spam: false },
    favoritar: { is_starred: true },
    desfavoritar: { is_starred: false },
    mover_para_pasta: { is_archived: true },
    tirar_da_pasta: { is_archived: false },
  };

  /**
   * A ação vai ao GMAIL, e só então ao banco.
   *
   * Antes cada ação era só um `update` local: arquivar aqui deixava o e-mail na
   * caixa de entrada do Google, e marcar como lido aqui deixava não lido lá. As
   * ações PARECIAM funcionar, e a divergência crescia a cada clique.
   *
   * A edge function grava o reflexo local DEPOIS de o Gmail confirmar. Se o
   * Google recusar, nada é gravado -- é o que impede a divergência de voltar
   * por outro caminho.
   */
  const noGmail = async (
    ids: string[],
    acao: string,
    labelId?: string,
  ): Promise<boolean> => {
    const chave = emailsKeys.all(orgId ?? "");
    const anterior = qc.getQueryData<Email[]>(chave);
    const efeito = EFEITO_LOCAL[acao];

    /*
     * Aplica JÁ, e desfaz se o Gmail recusar. Mesmo padrão do `useUpdateEmail`,
     * que é por isso que estrela e adiar sempre responderam na hora enquanto
     * apagar e mover pareciam travados.
     */
    if (efeito && orgId) {
      const alvo = new Set(ids);
      qc.setQueryData<Email[]>(chave, (old) =>
        old?.map((e) => (alvo.has(e.id) ? { ...e, ...efeito } : e)),
      );
    }

    const res = await supabase.functions.invoke("gmail-modify", {
      body: { ids, acao, label_id: labelId },
    });
    const data = res.data as { ok?: boolean; aplicados?: number; falhas?: { erro: string }[] } | null;
    /*
     * `erroDaFuncao` porque o `invoke` NÃO lê o corpo em status não-2xx: o motivo
     * real -- "Nenhuma conta de e-mail conectada", "Requested entity was not
     * found" -- chegava aqui como "Edge Function returned a non-2xx status code",
     * e a pessoa via a ação falhar sem saber por quê.
     */
    if (res.error || !data?.ok) {
      // Desfaz o otimismo: a mensagem volta para onde estava, na hora.
      if (anterior) qc.setQueryData(chave, anterior);
      toast({
        title: "A ação não chegou ao Gmail",
        description: data?.falhas?.[0]?.erro ?? (await erroDaFuncao(res)) ?? "Motivo não informado.",
        variant: "destructive",
      });
      return false;
    }
    // Falha parcial merece aviso: "3 de 5" calado faria parecer que tudo passou.
    if (data.falhas?.length > 0) {
      toast({
        title: `${data.aplicados} de ${ids.length} aplicados`,
        description: data.falhas[0].erro,
      });
    }
    /*
     * SEM `await`. A tela já mostra o resultado pelo efeito otimista; a
     * revalidação é reconciliação em segundo plano -- é dela que vinham as
     * `labels` que o Gmail devolveu. Esperar aqui era esperar a lista inteira
     * recarregar para só então fechar a mensagem aberta e mostrar o aviso.
     */
    void qc.invalidateQueries({ queryKey: emailsKeys.all(orgId ?? "") });
    return true;
  };

  const moverParaPasta = async (ids: string[], labelId: string, nome: string) => {
    if (await noGmail(ids, "mover_para_pasta", labelId)) {
      setPastaAberta(false);
      setSelectedIds(new Set());
      if (ids.includes(selectedEmail?.id ?? "")) setSelectedEmail(null);
      toast({ title: `Movido para "${nome}"` });
    }
  };

  const updateEmail = async (id: string, patch: Partial<Email>) => {
    if (selectedEmail?.id === id) setSelectedEmail((prev) => prev ? { ...prev, ...patch } : prev);
    try {
      await updateEmailMutation.mutateAsync({ id, patch });
    } catch (e: any) {
      toast({ title: "Erro ao atualizar email", description: mensagemErro(e), variant: "destructive" });
    }
  };

  const markRead = (id: string) => updateEmail(id, { is_read: true });
  const toggleStar = (e: Email) => updateEmail(e.id, { is_starred: !e.is_starred });
  /**
   * As cinco ações agora vão ao GMAIL, não só ao banco.
   *
   * `updateEmail` (local) ficou para o que é SÓ do CRM -- importância, adiar --
   * porque esses conceitos não existem no Gmail e não há o que sincronizar.
   */
  const fechaSe = (id: string) => { if (selectedEmail?.id === id) setSelectedEmail(null); };

  const archiveEmail = async (id: string) => {
    if (await noGmail([id], "arquivar")) { toast({ title: "Arquivado no Gmail" }); fechaSe(id); }
  };
  const markSpam = async (id: string) => {
    if (await noGmail([id], "spam")) { toast({ title: "Marcado como spam no Gmail" }); fechaSe(id); }
  };
  const notSpam = async (id: string) => {
    if (await noGmail([id], "nao_spam")) toast({ title: "Removido do spam" });
  };
  const trashEmail = async (id: string) => {
    if (await noGmail([id], "lixeira")) { toast({ title: "Movido para a lixeira do Gmail" }); fechaSe(id); }
  };
  const restoreEmail = async (id: string) => {
    if (await noGmail([id], "restaurar")) toast({ title: "Restaurado" });
  };
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
      toast({
        title: "Removido do CRM",
        description: "A mensagem continua na lixeira do Gmail, que o Google esvazia em 30 dias.",
      });
    } catch (e: any) {
      toast({ title: "Erro ao excluir email", description: mensagemErro(e), variant: "destructive" });
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
      body: { org_id: orgId, max: 50 },
    });
    setSyncing(false);
    if (error || (data as any)?.error) {
      toast({ title: "Erro ao sincronizar", description: (data as any)?.error || error?.message, variant: "destructive" });
      return;
    }
    if (orgId) await qc.invalidateQueries({ queryKey: emailsKeys.all(orgId) });
    toast({ title: `${(data as any)?.synced ?? 0} novos emails` });
  };

  const batchAction = async (
    action: "archive" | "trash" | "spam" | "read" | "restore",
  ) => {
    const ids = Array.from(selectedIds);
    // Traduz a ação da tela para o vocabulário da edge function, que fala em
    // termos de label do Gmail.
    const acao =
      action === "archive" ? "arquivar" :
      action === "trash" ? "lixeira" :
      action === "spam" ? "spam" :
      action === "restore" ? "restaurar" : "ler";
    try {
      if (!(await noGmail(ids, acao))) return;
      setSelectedIds(new Set());
      toast({ title: `${ids.length} ${pluralizar(ids.length, "mensagem", "mensagens")} no Gmail` });
    } catch (e) {
      toast({ title: "Erro ao atualizar emails", description: mensagemErro(e), variant: "destructive" });
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
    return formatarDataCurta(d);
  };

  const getInitials = (name: string) =>
    name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

  const senderColor = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return `hsl(${h} 60% 45%)`;
  };

  if (!orgId) return <SemOrganizacao />;

  // Caixa pessoal sem conta conectada. Antes esta tela não existia: o usuário
  // caía numa caixa vazia sem entender por quê, e a única CTA apontava para
  // Integrações — rota de admin, que um vendedor nem abre.
  if (!account) {
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
      <aside className={cn("shrink-0 border-r border-border flex flex-col transition-[width] duration-200", pastasRecolhidas ? "w-14" : "w-56")}>
        <div className={cn("flex items-center gap-1", pastasRecolhidas ? "flex-col p-2" : "p-3")}>
          <Button
            onClick={() => setComposeOpen(true)}
            className={cn("rounded-lg shadow-sm h-11", pastasRecolhidas ? "w-10 px-0 justify-center" : "flex-1 justify-start gap-2")}
            size="lg"
            title="Escrever"
          >
            <Pencil className="h-4 w-4" />
            {!pastasRecolhidas && "Escrever"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={alternarPastas}
            className="h-8 w-8 shrink-0 p-0 text-muted-foreground"
            title={pastasRecolhidas ? "Mostrar nomes das pastas" : "Recolher pastas e alargar a leitura"}
          >
            {pastasRecolhidas ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
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
                  title={pastasRecolhidas ? (count > 0 ? `${f.label} (${count})` : f.label) : undefined}
                  className={cn(
                    "w-full flex items-center text-sm transition-colors",
                    pastasRecolhidas
                      ? "relative justify-center rounded-lg py-2"
                      : "gap-3 rounded-r-full pl-5 pr-3 py-1.5",
                    active
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
                  {pastasRecolhidas ? (
                    /* Recolhido, a contagem vira um ponto: o número não cabe em
                       56px, mas "tem coisa aqui" é a metade da informação que
                       importa -- o total exato está no `title`. */
                    count > 0 && (
                      <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                    )
                  ) : (
                    <>
                      <span className="flex-1 text-left truncate">{f.label}</span>
                      {count > 0 && (
                        <span className="text-label font-medium tabular-nums">{count}</span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </nav>
        </ScrollArea>
      </aside>

      {/* ============== Email list ============== */}
      <div className={cn("flex flex-col border-r border-border", selectedEmail ? "w-[440px] shrink-0" : "flex-1 min-w-0")}>
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
                {/*
                  A BARRA CONHECE A PASTA, e antes não conhecia.
                  Na Lixeira, "Excluir" chamava a MESMA ação `lixeira` numa
                  mensagem já na lixeira: o Gmail respondia 200, nada mudava, e o
                  aviso dizia "1 mensagem atualizada". Do lado de quem clicou:
                  "clico para excluir e não funciona".
                */}
                {folder === "trash" ? (
                  <Button variant="ghost" size="sm" onClick={() => batchAction("restore")}
                    title="Restaurar para a caixa de entrada">
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => batchAction("archive")} title="Arquivar"><Archive className="h-4 w-4" /></Button>
                    {folder !== "spam" && (
                      <Button variant="ghost" size="sm" onClick={() => batchAction("spam")} title="Marcar como spam"><AlertOctagon className="h-4 w-4" /></Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => batchAction("trash")} title="Mover para a lixeira"><Trash2 className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => batchAction("read")} title="Marcar como lido"><Mail className="h-4 w-4" /></Button>
                  </>
                )}
                {/* MOVER PARA PASTA — pasta no Gmail é label, e mover aplica a
                  label removendo INBOX, igual ao que o Gmail faz quando você
                  arrasta. Sem remover INBOX, a mensagem apareceria nos dois
                  lugares e "mover" não teria movido nada. */}
                <Popover
                  open={pastaAberta}
                  onOpenChange={(v) => { setPastaAberta(v); if (v) void carregarPastas(); }}
                >
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" title="Mover para pasta">
                      <FolderInput className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 p-0">
                    <div className="border-b border-border px-3 py-2">
                      <p className="text-xs font-semibold">Mover para pasta</p>
                      <p className="text-label text-muted-foreground">
                        Move no Gmail também, e aparece no seu celular.
                      </p>
                    </div>
                    <div className="max-h-56 overflow-y-auto py-1">
                      {pastasCarregando && (
                        <p className="px-3 py-2 text-xs text-muted-foreground">Buscando suas pastas…</p>
                      )}
                      {!pastasCarregando && pastas.length === 0 && (
                        <p className="px-3 py-3 text-xs text-muted-foreground">
                          Você ainda não tem pastas no Gmail. Crie uma abaixo.
                        </p>
                      )}
                      {pastas.map((pasta) => (
                        <button
                          key={pasta.id}
                          onClick={() => void moverParaPasta(Array.from(selectedIds), pasta.id, pasta.nome)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                        >
                          <FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{pasta.nome}</span>
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5 border-t border-border p-2">
                      <Input
                        value={novaPasta}
                        onChange={(e) => setNovaPasta(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void criarPasta(); }}
                        placeholder="Nova pasta"
                        className="h-8 text-xs"
                      />
                      <Button size="sm" variant="outline" className="h-8 shrink-0 text-label"
                        onClick={() => void criarPasta()} disabled={!novaPasta.trim()}>
                        Criar
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>

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
                // 110 e não 80: com o assunto fora da linha, a prévia herdou a
                // largura toda e 80 caracteres paravam antes da borda.
                const previa = textoDeHtml(email.body_html, 110);

                return (
                  <div
                    key={email.id}
                    onClick={() => { setSelectedEmail(email); markRead(email.id); setReplyMode(null); }}
                    className={cn(
                      // py-3 e não py-2.5: a linha tem três linhas de texto e
                      // 10px em cima e embaixo as encostava na vizinha.
                      "group relative flex items-start gap-2.5 border-l-[3px] pl-2.5 pr-3 py-3 cursor-pointer transition-colors hover:bg-accent/40",
                      isOpen && "bg-accent/60",
                      !email.is_read && !isOpen && "bg-primary/[0.04]"
                    )}
                    // A cor do remetente, que era o avatar, virou a barra da
                    // esquerda: mesma pista visual em 3px em vez de 36.
                    style={{ borderLeftColor: senderColor(senderName) }}
                  >
                    <Checkbox
                      checked={selectedIds.has(email.id)}
                      onCheckedChange={(v) => {
                        const next = new Set(selectedIds);
                        if (v) next.add(email.id);
                        else next.delete(email.id);
                        setSelectedIds(next);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      /*
                       * Só aparece ao passar o mouse, ou quando já há algo
                       * selecionado.
                       *
                       * Ela ocupava 24px de TODA linha para uma ação que a
                       * pessoa usa raramente -- e num painel de 440px cada 24px
                       * é uma palavra do assunto que se perde. `opacity` e não
                       * `hidden`: some sem mudar o layout, então a linha não
                       * "salta" quando o mouse entra.
                       */
                      className={cn(
                        "mt-1 shrink-0 transition-opacity",
                        selectedIds.size > 0 || selectedIds.has(email.id)
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100",
                      )}
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleStar(email); }}
                      className="mt-1 text-muted-foreground hover:text-amber-500 transition-colors"
                      title={email.is_starred ? "Remover estrela" : "Adicionar estrela"}
                    >
                      <Star className={cn("h-4 w-4", email.is_starred && "fill-amber-400 text-amber-500")} />
                    </button>
                    {/* O AVATAR SAIU DA LISTA.
                        Eram 36px por linha (28 do círculo + 8 do respiro) para
                        desenhar as INICIAIS de um remetente -- decorativo, e num
                        painel de 440px eram quatro ou cinco palavras do assunto.
                        A cor por remetente virou uma barra de 3px na borda: mesma
                        pista visual, um oitavo da largura. */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn("text-sm truncate", !email.is_read ? "font-bold text-foreground" : "font-medium text-foreground/90")}>
                          {senderName}
                        </p>
                        <span className={cn("text-label shrink-0 tabular-nums", !email.is_read ? "font-semibold text-foreground" : "text-muted-foreground")}>
                          {timeAgo(email.sent_at || email.created_at)}
                        </span>
                      </div>
                      {/* O ASSUNTO GANHOU A LINHA INTEIRA.
                          Antes assunto e prévia dividiam UMA linha com
                          `truncate`, e nos 440px do painel isso significava ver o
                          assunto e nada da prévia -- ou, com assunto longo, meio
                          assunto. São duas informações diferentes; cada uma tem
                          sua linha. */}
                      <p className={cn("text-xs truncate mt-0.5", !email.is_read ? "font-semibold text-foreground" : "text-foreground/80")}>
                        {email.subject || "(sem assunto)"}
                      </p>
                      {/*
                       * Prévia e selos na MESMA linha, mas a prévia é que encolhe:
                       * os selos são raros (importante, aberto, clicado, adiado) e
                       * ficam à direita com `shrink-0`. Na maioria das linhas não
                       * há selo nenhum e a prévia usa a largura toda -- em vez de
                       * uma quarta linha vazia cobrando altura de toda a lista,
                       * que era o que a antiga `<div>` de selos fazia: ela existia
                       * sempre, com ou sem selo dentro.
                       */}
                      <div className="flex items-baseline gap-2 mt-0.5">
                        {previa && (
                          <p className="text-xs text-muted-foreground truncate flex-1 min-w-0">{previa}</p>
                        )}
                        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                          {email.importance === "high" && (
                            <Badge variant="outline" className="h-4 text-label border-amber-500/40 text-amber-600">Importante</Badge>
                          )}
                          {email.open_count > 0 && (
                            <span className="text-label text-muted-foreground flex items-center gap-0.5 tabular-nums" title={`Aberto ${email.open_count}x`}>
                              <Eye className="h-3 w-3" />{email.open_count}
                            </span>
                          )}
                          {email.click_count > 0 && (
                            <span className="text-label text-muted-foreground flex items-center gap-0.5 tabular-nums" title={`${email.click_count} clique(s)`}>
                              <MousePointerClick className="h-3 w-3" />{email.click_count}
                            </span>
                          )}
                          {email.snoozed_until && new Date(email.snoozed_until) > new Date() && (
                            <span className="text-label text-amber-600 flex items-center gap-0.5" title="Adiado">
                              <Clock className="h-3 w-3" />{formatarData(email.snoozed_until)}
                            </span>
                          )}
                        </div>
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
                ? "fixed inset-4 md:inset-10 z-50 bg-background border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
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
            {/* MOVER PARA PASTA — pasta no Gmail é label, e mover aplica a
                label removendo INBOX, igual ao que o Gmail faz quando você
                arrasta. Sem remover INBOX, a mensagem apareceria nos dois
                lugares e "mover" não teria movido nada. */}
            <Popover
              open={pastaAberta}
              onOpenChange={(v) => { setPastaAberta(v); if (v) void carregarPastas(); }}
            >
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" title="Mover para pasta">
                  <FolderInput className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-0">
                <div className="border-b border-border px-3 py-2">
                  <p className="text-xs font-semibold">Mover para pasta</p>
                  <p className="text-label text-muted-foreground">
                    Move no Gmail também, e aparece no seu celular.
                  </p>
                </div>
                <div className="max-h-56 overflow-y-auto py-1">
                  {pastasCarregando && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">Buscando suas pastas…</p>
                  )}
                  {!pastasCarregando && pastas.length === 0 && (
                    <p className="px-3 py-3 text-xs text-muted-foreground">
                      Você ainda não tem pastas no Gmail. Crie uma abaixo.
                    </p>
                  )}
                  {pastas.map((pasta) => (
                    <button
                      key={pasta.id}
                      onClick={() => void moverParaPasta([selectedEmail.id], pasta.id, pasta.nome)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                    >
                      <FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{pasta.nome}</span>
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 border-t border-border p-2">
                  <Input
                    value={novaPasta}
                    onChange={(e) => setNovaPasta(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void criarPasta(); }}
                    placeholder="Nova pasta"
                    className="h-8 text-xs"
                  />
                  <Button size="sm" variant="outline" className="h-8 shrink-0 text-label"
                    onClick={() => void criarPasta()} disabled={!novaPasta.trim()}>
                    Criar
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            {!selectedEmail.is_spam ? (
              <Button variant="ghost" size="sm" onClick={() => markSpam(selectedEmail.id)} title="Marcar como spam"><AlertOctagon className="h-4 w-4" /></Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => notSpam(selectedEmail.id)} title="Não é spam"><AlertOctagon className="h-4 w-4 text-destructive" /></Button>
            )}
            {!selectedEmail.is_trashed ? (
              <Button variant="ghost" size="sm" onClick={() => trashEmail(selectedEmail.id)}
                title="Mover para a lixeira"><Trash2 className="h-4 w-4" /></Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => restoreEmail(selectedEmail.id)}
                  title="Restaurar para a caixa de entrada"><RotateCcw className="h-4 w-4" /></Button>
                {/*
                  "REMOVER DO CRM", e não "excluir permanentemente".
                  Apagar de verdade no Gmail é `messages.delete`, que exige o
                  escopo `https://mail.google.com/` -- acesso TOTAL à caixa. O que
                  temos é `gmail.modify`, que faz lixeira e restaura mas NÃO
                  apaga. Escalar para o escopo total só por causa deste botão
                  custaria novo consentimento de toda a equipe e uma revisão mais
                  rígida do Google.
                  Então o botão faz o que dá, e o rótulo diz a verdade: some do
                  CRM, continua na lixeira do Gmail -- que o Google esvazia
                  sozinho em 30 dias.
                */}
                <Button variant="ghost" size="sm" onClick={() => deleteForever(selectedEmail.id)}
                  title="Remover do CRM (continua na lixeira do Gmail)">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
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
                <h1 className="vx-titulo-tela">{selectedEmail.subject || "(sem assunto)"}</h1>
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
                        <Badge variant="secondary" className="text-label h-4">
                          <Eye className="mr-1 h-2.5 w-2.5" />{selectedEmail.open_count}x aberto
                        </Badge>
                      )}
                      {selectedEmail.click_count > 0 && (
                        <Badge variant="secondary" className="text-label h-4">
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

      <EmailComposeModal open={composeOpen} onOpenChange={setComposeOpen} onSent={() => { if (orgId) qc.invalidateQueries({ queryKey: emailsKeys.all(orgId) }); }} />
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
      const res = await supabase.functions.invoke("gmail-attachment", {
        body: { message_id: messageId, attachment_id: att.attachment_id, mime_type: att.mime_type },
      });
      /*
        `data?.error || error?.message` cobria só metade: em status não-2xx o
        `data` vem NULO e sobra o `error.message`, que é sempre "Edge Function
        returned a non-2xx status code". Anexo que falha por token expirado
        dizia isso -- e o motivo real, que a função escreve no corpo, ia embora.
      */
      const motivo = await erroDaFuncao(res);
      const dados = res.data as { data_url?: string } | null;
      if (motivo || !dados?.data_url) throw new Error(motivo || "Falha ao baixar");
      setUrls((u) => ({ ...u, [att.attachment_id]: dados.data_url! }));
      return dados.data_url as string;
    } catch (e: unknown) {
      toast({ title: "Erro ao baixar anexo", description: mensagemErro(e), variant: "destructive" });
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
                  <p className="text-label text-muted-foreground">{formatBytes(att.size)}</p>
                </div>
                <div className="flex gap-1">
                  {(isImg || isPdf) && (
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handlePreview(att)} disabled={isLoading} title="Visualizar">
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleDownload(att)} disabled={isLoading} title="Baixar">
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

