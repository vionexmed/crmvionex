import { useEffect, useState, useMemo } from "react";
import { PageShell } from "@/components/layout/PageShell";

import { useSearchParams } from "react-router-dom";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, CheckSquare, List,
  CalendarDays, Trash2, Edit2, MoreHorizontal,
  ChevronLeft, ChevronRight, Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useActivities, useCreateActivity, useUpdateActivity, useDeleteActivities,
} from "@/hooks/queries/useActivities";
import { useMembers } from "@/hooks/queries/useMembers";
import { useAllContacts } from "@/hooks/queries/useContacts";
import { useCompanies } from "@/hooks/queries/useCompanies";
import { useDeals } from "@/hooks/queries/useDeals";
import type { Database } from "@/integrations/supabase/types";
import { ATIVIDADE_ICONE, ATIVIDADE_JA_ACONTECEU, ATIVIDADE_ROTULO } from "@/lib/atividade-tipos";
import { LoadingState, ErrorState, EmptyState } from "@/components/layout/EstadoDaLista";
import { formatarDataCurta, formatarDataHora, pluralizar } from "@/lib/formato";
import { SemOrganizacao } from "@/components/layout/SemOrganizacao";
import { SegmentedControl } from "@/components/layout/SegmentedControl";

type Activity = Database["public"]["Tables"]["activities"]["Row"];
type ActivityType = Database["public"]["Enums"]["activity_type"];
type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type Company = Database["public"]["Tables"]["companies"]["Row"];
type Deal = Database["public"]["Tables"]["deals"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const typeColors: Record<ActivityType, string> = {
  call: "text-emerald-600",
  email: "text-blue-600",
  meeting: "text-amber-600",
  note: "text-muted-foreground",
  task: "text-violet-600",
};

type ViewMode = "list" | "calendar";
type DateFilter =
  | "todo" | "overdue" | "today" | "tomorrow" | "this_week" | "next_week" | "next_30_days"
  // Concluída não cabia em nenhum dos filtros acima: todos exigem
  // !completed_at, então atividade feita ficava invisível na página inteira —
  // inclusive no calendário, que agrupa por due_date. O painel contava a
  // abordagem (por created_at) e aqui não havia como encontrá-la.
  | "feitas" | "todas";

/** Visões de histórico: ordenam por quando aconteceu, não por vencimento. */
const HISTORICO: DateFilter[] = ["feitas", "todas"];

const dataCurta = (iso: string) =>
  formatarDataCurta(iso);

/** Quando a atividade de fato aconteceu. due_date é previsão, não registro. */
function aconteceuEm(a: Activity): number {
  const d = a.completed_at || a.created_at;
  return d ? new Date(d).getTime() : 0;
}

const dateFilterLabels: Record<DateFilter, string> = {
  todo: "Para fazer",
  overdue: "Vencido",
  today: "Hoje",
  tomorrow: "Amanhã",
  this_week: "Esta semana",
  next_week: "Próxima semana",
  next_30_days: "Próximos 30 dias",
  feitas: "Concluídas",
  todas: "Todas",
};

function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function endOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999); }

function getWeekRange(offset: number) {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: startOfDay(monday), end: endOfDay(sunday) };
}

export default function Activities() {
  const { orgId } = useOrg();
  const { toast } = useToast();

  // `isLoading` e `isError` existiam e eram descartados. A tabela mostrava
  // "Nenhuma atividade encontrada" enquanto a consulta rodava, e o MESMO texto
  // se ela falhasse -- três situações, uma resposta só.
  const { data: activities = [], isLoading: carregando, isError: falhou, refetch } = useActivities();
  // `useContacts({pageSize: 1000})` truncava em 1000 EM SILÊNCIO -- passando
  // disso, o contato simplesmente não aparecia no select e não havia como saber
  // por quê. Com leads entrando na lista de contatos, o teto deixou de ser
  // teórico. `useAllContacts` pagina em blocos, sem teto, e devolve o contato
  // completo (esta tela usa `phone`).
  const { data: contacts = [] } = useAllContacts();
  const { data: companies = [] } = useCompanies();
  const { data: dealsResult } = useDeals({ pageSize: 1000 });
  const deals: Deal[] = (dealsResult?.data ?? []) as unknown as Deal[];
  const { data: members = [] } = useMembers();

  const updateActivity = useUpdateActivity();
  const deleteActivities = useDeleteActivities();

  // O tipo vem da URL. É o que permite `/activities?tipo=task` substituir a
  // tela de Tarefas, que era esta mesma consulta com `type=task` fixo e 379
  // linhas próprias para exibi-la.
  const [typeFilter, setTypeFilter] = useState<string>(
    () => new URLSearchParams(window.location.search).get("tipo") ?? "all",
  );
  const [dateFilter, setDateFilter] = useState<DateFilter>("todo");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [editActivity, setEditActivity] = useState<Activity | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // A URL acompanha o filtro, para que a tela seja compartilhável e o botão
  // Voltar funcione. Sem `replace`, cada clique num tipo empilharia uma entrada
  // no histórico e sair da tela exigiria voltar tantas vezes quantos cliques.
  useEffect(() => {
    const atual = searchParams.get("tipo") ?? "all";
    if (atual === typeFilter) return;
    const novo = new URLSearchParams(searchParams);
    if (typeFilter === "all") novo.delete("tipo");
    else novo.set("tipo", typeFilter);
    setSearchParams(novo, { replace: true });
  }, [typeFilter, searchParams, setSearchParams]);

  useEffect(() => {
    if (searchParams.get("action") === "new") {
      setCreateOpen(true);
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Calendar state
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const toggleComplete = (activity: Activity) => {
    const completed_at = activity.completed_at ? null : new Date().toISOString();
    updateActivity.mutate({ id: activity.id, activity: { completed_at } });
  };

  const deleteActivity = (id: string) => {
    deleteActivities.mutate([id], {
      onSuccess: () => toast({ title: "Atividade excluída" }),
    });
  };

  const getContact = (id: string | null) => id ? contacts.find((c) => c.id === id) : null;
  const getCompany = (id: string | null) => id ? companies.find((c) => c.id === id) : null;
  const getDeal = (id: string | null) => id ? deals.find((d) => d.id === id) : null;
  const getMember = (id: string | null) => id ? (members as Profile[]).find((m) => m.id === id) : null;

  const isOverdue = (a: Activity) => !a.completed_at && a.due_date && new Date(a.due_date) < new Date();

  const filtered = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const tomorrowStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const tomorrowEnd = endOfDay(tomorrowStart);
    const thisWeek = getWeekRange(0);
    const nextWeek = getWeekRange(1);
    const next30End = endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30));

    const lista = activities.filter((a) => {
      // Type filter
      if (typeFilter !== "all" && a.type !== typeFilter) return false;

      // Owner filter
      if (ownerFilter !== "all" && a.user_id !== ownerFilter) return false;

      // Search
      if (search) {
        const q = search.toLowerCase();
        const contact = getContact(a.contact_id);
        const deal = getDeal(a.deal_id);
        const haystack = `${a.title} ${contact?.first_name || ""} ${contact?.last_name || ""} ${contact?.email || ""} ${deal?.title || ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      // Date filter
      const dueDate = a.due_date ? new Date(a.due_date) : null;
      switch (dateFilter) {
        case "todo":
          return !a.completed_at;
        case "overdue":
          return !a.completed_at && dueDate !== null && dueDate < now;
        case "today":
          return !a.completed_at && dueDate !== null && dueDate >= todayStart && dueDate <= todayEnd;
        case "tomorrow":
          return !a.completed_at && dueDate !== null && dueDate >= tomorrowStart && dueDate <= tomorrowEnd;
        case "this_week":
          return !a.completed_at && dueDate !== null && dueDate >= thisWeek.start && dueDate <= thisWeek.end;
        case "next_week":
          return !a.completed_at && dueDate !== null && dueDate >= nextWeek.start && dueDate <= nextWeek.end;
        case "next_30_days":
          return !a.completed_at && dueDate !== null && dueDate >= todayStart && dueDate <= next30End;
        case "feitas":
          return !!a.completed_at;
        case "todas":
          return true;
      }
      return true;
    });

    // Ordem por vencimento (a do servidor) não serve para histórico: atividade
    // registrada costuma ter due_date NULL, e nulo vai para o fim da lista.
    // Aqui o que interessa é a mais recente primeiro.
    return HISTORICO.includes(dateFilter)
      ? lista.sort((x, y) => aconteceuEm(y) - aconteceuEm(x))
      : lista;
  }, [activities, typeFilter, dateFilter, ownerFilter, search, contacts, deals]);

  // Count per date filter (for badges)
  const counts = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const tomorrowStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const tomorrowEnd = endOfDay(tomorrowStart);
    const thisWeek = getWeekRange(0);
    const nextWeek = getWeekRange(1);
    const next30End = endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30));

    const pending = activities.filter((a) => !a.completed_at);
    return {
      todo: pending.length,
      overdue: pending.filter((a) => a.due_date && new Date(a.due_date) < now).length,
      today: pending.filter((a) => a.due_date && new Date(a.due_date) >= todayStart && new Date(a.due_date) <= todayEnd).length,
      tomorrow: pending.filter((a) => a.due_date && new Date(a.due_date) >= tomorrowStart && new Date(a.due_date) <= tomorrowEnd).length,
      this_week: pending.filter((a) => a.due_date && new Date(a.due_date) >= thisWeek.start && new Date(a.due_date) <= thisWeek.end).length,
      next_week: pending.filter((a) => a.due_date && new Date(a.due_date) >= nextWeek.start && new Date(a.due_date) <= nextWeek.end).length,
      next_30_days: pending.filter((a) => a.due_date && new Date(a.due_date) >= todayStart && new Date(a.due_date) <= next30End).length,
      feitas: activities.length - pending.length,
      todas: activities.length,
    };
  }, [activities]);

  // Calendar helpers
  const calendarDays = useMemo(() => {
    const { year, month } = calMonth;
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const startDay = first.getDay();
    const days: { date: Date; inMonth: boolean }[] = [];
    for (let i = startDay - 1; i >= 0; i--) {
      days.push({ date: new Date(year, month, -i), inMonth: false });
    }
    for (let d = 1; d <= last.getDate(); d++) {
      days.push({ date: new Date(year, month, d), inMonth: true });
    }
    while (days.length % 7 !== 0) {
      days.push({ date: new Date(year, month + 1, days.length - last.getDate() - startDay + 1), inMonth: false });
    }
    return days;
  }, [calMonth]);

  const activitiesByDate = useMemo(() => {
    const map = new Map<string, Activity[]>();
    filtered.forEach((a) => {
      const dateStr = a.due_date
        ? new Date(a.due_date).toISOString().split("T")[0]
        : a.created_at
          ? new Date(a.created_at).toISOString().split("T")[0]
          : null;
      if (dateStr) {
        if (!map.has(dateStr)) map.set(dateStr, []);
        map.get(dateStr)!.push(a);
      }
    });
    return map;
  }, [filtered]);

  const monthNames = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

  if (!orgId) return <SemOrganizacao />;

  return (
    <PageShell
      title="Atividades"
      contagem={{ valor: filtered.length, unidade: "atividade" }}
      meta={
        // Atrasada não é um segundo total: é um alerta, e por isso sai do campo
        // da contagem e ganha a cor de alerta em vez de cinza.
        counts.overdue > 0 ? (
          <span className="text-xs font-semibold text-destructive">
            {counts.overdue} {pluralizar(counts.overdue, "atrasada")}
          </span>
        ) : undefined
      }
      actions={
        <>
          {/* Era a SEXTA cópia do grupo de pílulas -- consolidei cinco e passei
              por esta duas vezes sem ver, porque os botões estão dentro do
              `actions` do PageShell e não perto de uma lista.

              E nenhum dos dois botões tinha rótulo acessível: eram dois ícones
              sem nome, e quem usa leitor de tela ouvia "botão, botão". */}
          <SegmentedControl<ViewMode>
            rotuloGrupo="Visualização"
            valor={viewMode}
            onChange={setViewMode}
            opcoes={[
              { valor: "list", rotulo: "Lista", icone: List },
              { valor: "calendar", rotulo: "Calendário", icone: CalendarDays },
            ]}
          />
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <Plus className="mr-1.5 h-3.5 w-3.5" />Atividade
          </Button>
        </>
      }
    >

      {/* Filtros — tipo de atividade + busca + responsável */}
      <div className="flex items-center gap-1 pb-2 border-b border-border flex-wrap pt-1">
        <button
          onClick={() => setTypeFilter("all")}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${typeFilter === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
        >
          Tudo
        </button>
        {(["call", "meeting", "task", "email", "note"] as ActivityType[]).map((t) => {
          const Icon = ATIVIDADE_ICONE[t];
          return (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${typeFilter === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            >
              <Icon className="h-3 w-3" />
              {ATIVIDADE_ROTULO[t]}
            </button>
          );
        })}

        {/* Right side: search + owner filter */}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 h-8 w-44 text-xs"
            />
          </div>
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="Responsável" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {(members as Profile[]).map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name || m.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Date filter tabs */}
      <div className="flex items-center gap-0.5 py-2 text-xs">
        {(Object.keys(dateFilterLabels) as DateFilter[]).map((key) => {
          const count = counts[key];
          const isActive = dateFilter === key;
          const isOverdueTab = key === "overdue";
          return (
            <button
              key={key}
              onClick={() => setDateFilter(key)}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                isActive
                  ? isOverdueTab && count > 0
                    ? "bg-destructive/10 text-destructive"
                    : "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {dateFilterLabels[key]}
              {count > 0 && (
                <span className={`ml-1 text-label ${isOverdueTab ? "text-destructive" : ""}`}>
                  ({count})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Table view */}
      {viewMode === "list" && (
        <div className="vx-table">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-10"></TableHead>
                <TableHead className="min-w-[200px]">Assunto</TableHead>
                <TableHead>Negócio</TableHead>
                <TableHead>Pessoa de contato</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Organização</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Atribuído a</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => {
                const Icon = ATIVIDADE_ICONE[a.type];
                const contact = getContact(a.contact_id);
                const deal = getDeal(a.deal_id);
                const company = getCompany(a.company_id) || (contact?.company_id ? getCompany(contact.company_id) : null);
                const member = getMember(a.user_id);
                const overdue = isOverdue(a);

                return (
                  <TableRow
                    key={a.id}
                    className={`group ${a.completed_at ? "opacity-40" : ""} ${overdue ? "bg-destructive/[0.03]" : ""}`}
                  >
                    <TableCell className="pr-0">
                      <Checkbox
                        checked={!!a.completed_at}
                        onCheckedChange={() => toggleComplete(a)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className={`h-3.5 w-3.5 shrink-0 ${typeColors[a.type]}`} />
                        <span className={`text-sm font-medium truncate ${a.completed_at ? "line-through" : ""}`}>
                          {a.title}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {deal && (
                        <Badge variant="secondary" className="text-label font-normal max-w-[160px] truncate">
                          {deal.title}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {contact && (
                        <span className="text-sm">
                          {contact.first_name} {contact.last_name || ""}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {contact?.email && (
                        <a href={`mailto:${contact.email}`} className="text-xs text-primary hover:underline truncate block max-w-[180px]">
                          {contact.email}
                        </a>
                      )}
                    </TableCell>
                    <TableCell>
                      {contact?.phone && (
                        <span className="text-xs text-muted-foreground">{contact.phone}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {company && (
                        <span className="text-xs text-muted-foreground">{company.name}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {/* Três datas diferentes, do mais informativo para o
                          menos: vencimento, conclusão, criação. Antes só o
                          vencimento era mostrado, então atividade concluída —
                          que costuma ter due_date NULL — aparecia sem data
                          nenhuma, e "o que foi feito" ficava sem quando. */}
                      {a.due_date ? (
                        <span
                          title={`Vence em ${formatarDataHora(a.due_date)}`}
                          className={`text-xs whitespace-nowrap ${overdue ? "text-destructive font-medium" : "text-muted-foreground"}`}
                        >
                          {dataCurta(a.due_date)}
                        </span>
                      ) : a.completed_at ? (
                        <span
                          title={`Concluída em ${formatarDataHora(a.completed_at)}`}
                          className="whitespace-nowrap text-xs font-medium text-success"
                        >
                          ✓ {dataCurta(a.completed_at)}
                        </span>
                      ) : a.created_at ? (
                        <span
                          title={`Registrada em ${formatarDataHora(a.created_at)}`}
                          className="whitespace-nowrap text-xs text-muted-foreground/70"
                        >
                          {dataCurta(a.created_at)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {/* Quem fez. O banco não guarda um "concluída por"
                          separado, então user_id é a melhor fonte que existe. */}
                      {member ? (
                        <span className="text-xs text-muted-foreground">{member.name || member.email}</span>
                      ) : (
                        <span
                          className="text-xs text-muted-foreground/50"
                          title={a.user_id ? "Conta não está mais na equipe" : "Nenhuma conta registrada"}
                        >
                          —
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent transition-all">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditActivity(a)}>
                            <Edit2 className="mr-2 h-3.5 w-3.5" />Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => deleteActivity(a.id)} className="text-destructive">
                            <Trash2 className="mr-2 h-3.5 w-3.5" />Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
              {/* Carregando, falhou e vazio agora são três respostas, e a
                  ordem é obrigatória: erro ANTES de vazio. Consulta que falhou
                  devolve lista vazia, e dizer "nenhuma atividade" nesse caso é
                  afirmar um fato que a tela não conhece. */}
              {(carregando || falhou || filtered.length === 0) && (
                <TableRow>
                  <TableCell colSpan={10} className="p-0">
                    {carregando ? (
                      <LoadingState linhas={6} className="p-4" />
                    ) : falhou ? (
                      <ErrorState
                        descricao="As atividades não puderam ser carregadas. Nenhum dado foi alterado."
                        onTentarNovamente={() => refetch()}
                        className="m-4"
                      />
                    ) : (
                      <EmptyState
                        icone={CheckSquare}
                        titulo="Nenhuma atividade encontrada"
                        descricao="Registre uma ligação, reunião ou nota para começar o histórico."
                        acao={
                          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                            <Plus className="mr-1.5 h-3.5 w-3.5" />Criar atividade
                          </Button>
                        }
                      />
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Calendar View */}
      {viewMode === "calendar" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => setCalMonth((p) => {
              const d = new Date(p.year, p.month - 1);
              return { year: d.getFullYear(), month: d.getMonth() };
            })}><ChevronLeft className="h-4 w-4" /></Button>
            <h3 className="vx-titulo-secao">{monthNames[calMonth.month]} {calMonth.year}</h3>
            <Button variant="outline" size="sm" onClick={() => setCalMonth((p) => {
              const d = new Date(p.year, p.month + 1);
              return { year: d.getFullYear(), month: d.getMonth() };
            })}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <div className="grid grid-cols-7 gap-px rounded-lg border border-border bg-border overflow-hidden">
            {["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map((d) => (
              <div key={d} className="bg-muted px-2 py-1.5 text-center text-label font-medium text-muted-foreground">{d}</div>
            ))}
            {calendarDays.map((day, i) => {
              const dateStr = day.date.toISOString().split("T")[0];
              const dayActivities = activitiesByDate.get(dateStr) || [];
              const isToday = dateStr === new Date().toISOString().split("T")[0];
              return (
                <div key={i} className={`min-h-[80px] bg-background p-1 ${!day.inMonth ? "opacity-40" : ""}`}>
                  <div className={`text-xs font-medium mb-0.5 ${isToday ? "flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                    {day.date.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dayActivities.slice(0, 3).map((a) => {
                      const ActIcon = ATIVIDADE_ICONE[a.type];
                      return (
                        <div key={a.id} className={`flex items-center gap-1 rounded px-1 py-0.5 text-micro truncate bg-muted/50 ${isOverdue(a) ? "ring-1 ring-destructive" : ""}`}>
                          <ActIcon className={`h-2.5 w-2.5 shrink-0 ${typeColors[a.type]}`} />
                          <span className="truncate">{a.title}</span>
                        </div>
                      );
                    })}
                    {dayActivities.length > 3 && (
                      <span className="text-micro text-muted-foreground px-1">+{dayActivities.length - 3}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      <ActivityCreateEditModal
        open={createOpen || !!editActivity}
        onOpenChange={(o) => { if (!o) { setCreateOpen(false); setEditActivity(null); } }}
        activity={editActivity}
        contacts={contacts}
        companies={companies}
        deals={deals}
        members={members as Profile[]}
      />
    </PageShell>
  );
}

// ─── Create / Edit Modal ────────────────────────────────────────────
interface ModalProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  activity: Activity | null;
  contacts: Contact[];
  companies: Company[];
  deals: Deal[];
  members: Profile[];
}

function ActivityCreateEditModal({ open, onOpenChange, activity, contacts, companies, deals, members }: ModalProps) {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { toast } = useToast();
  const isEdit = !!activity;

  const createActivity = useCreateActivity();
  const updateActivity = useUpdateActivity();

  const [type, setType] = useState<ActivityType>("task");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dealId, setDealId] = useState<string>("none");
  const [contactId, setContactId] = useState<string>("none");
  const [assignee, setAssignee] = useState<string>("none");

  const selectedDeal = deals.find((d) => d.id === dealId);
  const resolvedContactId = dealId !== "none" && selectedDeal?.contact_id
    ? selectedDeal.contact_id
    : contactId !== "none" ? contactId : null;
  const selectedContact = contacts.find((c) => c.id === resolvedContactId);
  const resolvedCompanyId = selectedDeal?.company_id || selectedContact?.company_id || null;
  const resolvedCompany = companies.find((c) => c.id === resolvedCompanyId);

  useEffect(() => {
    if (activity) {
      setType(activity.type);
      setTitle(activity.title);
      setBody(activity.body || "");
      setDueDate(activity.due_date ? activity.due_date.slice(0, 16) : "");
      setDealId(activity.deal_id || "none");
      setContactId(activity.contact_id || "none");
      setAssignee(activity.user_id || "none");
    } else {
      setType("task");
      setTitle("");
      setBody("");
      setDueDate("");
      setDealId("none");
      setContactId("none");
      setAssignee("none");
    }
  }, [activity, open]);

  const handleDealChange = (val: string) => {
    setDealId(val);
    if (val !== "none") {
      const deal = deals.find((d) => d.id === val);
      if (deal?.contact_id) setContactId(deal.contact_id);
    }
  };

  const handleSave = async () => {
    if (!orgId || !title.trim()) return;
    const payload = {
      org_id: orgId,
      type,
      title: title.trim(),
      body: body || null,
      due_date: dueDate || null,
      deal_id: dealId !== "none" ? dealId : null,
      contact_id: resolvedContactId,
      company_id: resolvedCompanyId,
      user_id: assignee !== "none" ? assignee : user?.id,
    };

    // Sem prazo = registro do que aconteceu. Com prazo = agendamento.
    //
    // `ContactDrawer` e `DealDetail` marcam conclusão sempre, porque os
    // formulários deles NÃO têm campo de prazo -- são só registro. Aqui existe
    // prazo, então a ausência dele é o sinal, e a regra fica mais precisa em vez
    // de mais frouxa.
    //
    // Sem isto, a mesma ligação caía em dias diferentes conforme por onde fosse
    // registrada: aqui ficava pendente para sempre e nunca contava em
    // "Abordagens realizadas"; nas outras duas telas contava na hora.
    //
    // Só na CRIAÇÃO. Editar uma atividade não pode marcá-la concluída em
    // silêncio -- a conclusão é do checkbox, e é decisão de quem clica.
    const criandoRegistro =
      !isEdit && !dueDate && ATIVIDADE_JA_ACONTECEU.includes(type);

    if (isEdit) {
      updateActivity.mutate(
        { id: activity!.id, activity: payload },
        {
          onSuccess: () => {
            onOpenChange(false);
            toast({ title: "Atividade atualizada" });
          },
          onError: (err: Error) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
        }
      );
    } else {
      createActivity.mutate(
        criandoRegistro
          ? { ...payload, completed_at: new Date().toISOString() }
          : payload,
        {
          onSuccess: () => {
            onOpenChange(false);
            toast({ title: "Atividade criada" });
          },
          onError: (err: Error) =>
            toast({ title: "Erro", description: err.message, variant: "destructive" }),
        },
      );
    }
  };

  const typeHints: Record<ActivityType, string> = {
    note: "Registre observações sobre contatos, negócios ou empresas",
    task: "Crie uma tarefa com prazo e responsável",
    meeting: "Agende uma reunião com data, horário e participantes",
    call: "Registre uma ligação com contato e resultado",
    email: "Crie um rascunho de email para acompanhamento",
  };

  const availableContacts = dealId !== "none" && selectedDeal?.company_id
    ? contacts.filter((c) => c.company_id === selectedDeal.company_id || !c.company_id)
    : contacts;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Atividade" : "Nova Atividade"}</DialogTitle>
          <DialogDescription>{typeHints[type]}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {/* A SÉTIMA cópia, e a que mais custava: cinco opções, cada uma com
              a classe inteira repetida na linha. Aqui o grupo ocupa a largura
              do diálogo, por isso `className="w-full"` e cada botão crescendo
              -- é o único uso em que as opções dividem o espaço em vez de se
              acomodarem ao texto. */}
          <SegmentedControl<ActivityType>
            className="w-full [&>button]:flex-1"
            rotuloGrupo="Tipo de atividade"
            valor={type}
            onChange={setType}
            compactoNoCelular={false}
            opcoes={(["task", "note", "call", "meeting", "email"] as ActivityType[]).map((t) => ({
              valor: t,
              rotulo: ATIVIDADE_ROTULO[t],
              icone: ATIVIDADE_ICONE[t],
            }))}
          />

          <div className="space-y-1">
            <Label className="text-xs">
              {type === "note" ? "Assunto" : type === "call" ? "Resumo da ligação" : "Título"} *
            </Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={
              type === "note" ? "Assunto da nota..." : type === "call" ? "Resumo da ligação..." : type === "meeting" ? "Nome da reunião..." : type === "email" ? "Assunto do email..." : "Título da tarefa..."
            } />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">
              {type === "note" ? "Conteúdo" : type === "call" ? "Notas da ligação" : type === "meeting" ? "Pauta / Notas" : type === "email" ? "Corpo do email" : "Descrição"}
            </Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={type === "note" || type === "email" ? 6 : 3} />
          </div>

          {(type === "task" || type === "meeting" || type === "call") && (
            <div className="space-y-1">
              <Label className="text-xs">
                {type === "meeting" ? "Data/hora" : type === "call" ? "Data/hora da ligação" : "Prazo"}
              </Label>
              <Input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Negócio</Label>
            <Select value={dealId} onValueChange={handleDealChange}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                {deals.map((d) => <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Contato</Label>
            <Select
              value={resolvedContactId || "none"}
              onValueChange={(v) => setContactId(v)}
              disabled={dealId !== "none" && !!selectedDeal?.contact_id}
            >
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                {availableContacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {dealId !== "none" && selectedDeal?.contact_id && (
              <p className="text-label text-muted-foreground">Preenchido automaticamente pelo negócio</p>
            )}
          </div>

          {resolvedCompany && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Empresa (vinculada automaticamente)</Label>
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                🏢 {resolvedCompany.name}
              </div>
            </div>
          )}

          {(type === "task" || type === "meeting") && (
            <div className="space-y-1">
              <Label className="text-xs">Responsável</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Eu</SelectItem>
                  {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name || m.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button onClick={handleSave} className="w-full" disabled={!title.trim()}>
            {isEdit ? "Salvar Alterações" : "Criar Atividade"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
