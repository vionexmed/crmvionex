import { useState, useEffect, useMemo } from "react";
import { PageShell } from "@/components/layout/PageShell";
import { SegmentedControl } from "@/components/layout/SegmentedControl";
import { LoadingState, ErrorState, EmptyState } from "@/components/layout/EstadoDaLista";
import { formatarData } from "@/lib/formato";
import { initials } from "@/lib/utils";
import { Users as UsersIcon } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useQueryClient } from "@tanstack/react-query";
import {
  useContacts, useAllContacts, useLastActivities, useDeleteContacts,
  useUpdateContactsLifecycle, useUpdateContactOwner, contactsKeys,
} from "@/hooks/queries/useContacts";
import { contactsApi } from "@/lib/api/contacts";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanies } from "@/hooks/queries/useCompanies";
import { useMembers } from "@/hooks/queries/useMembers";
import { PAGE_SIZE } from "@/lib/api/contacts";
import {
  getContactOrigin, ORIGIN_OPTIONS,
  LIFECYCLE_LABELS, LIFECYCLE_COLORS, type LifecycleStage,
} from "@/lib/contact-options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Search, LayoutGrid, List, Filter, Upload, Download,
  Trash2, X, AlertTriangle, Users, Loader2,
} from "lucide-react";
import { ContactsKanbanByOwner } from "@/components/crm/ContactsKanbanByOwner";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { ContactDrawer } from "@/components/crm/ContactDrawer";
import { ContactCreateModal } from "@/components/crm/ContactCreateModal";
import { CSVImportModal } from "@/components/crm/CSVImportModal";
import { useDebounce } from "@/hooks/useDebounce";
import { mensagemErro } from "@/lib/erro-supabase";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import type { Database } from "@/integrations/supabase/types";
import { SortHeader, useOrdenacao } from "@/components/layout/SortHeader";
import { SemOrganizacao } from "@/components/layout/SemOrganizacao";
import { exportarCSV } from "@/lib/csv";
import { PREFIXO_ORIGEM_EXATA } from "@/lib/api/contacts";
import { invalidarPainel } from "@/lib/invalidar-painel";
import { formatarEmail, formatarTelefone, nomeDoContato } from "@/lib/contato-formato";
import { BarraDeFiltros, BarraDeSelecao } from "@/components/layout/BarraDeAcoes";
import { Paginacao } from "@/components/layout/Paginacao";

type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type SortKey = "name" | "email" | "status" | "created_at" | "title";
type ViewMode = "table" | "cards" | "owner";


interface ContactFilters {
  /**
   * Ciclo de vida, não `status`.
   *
   * Era `status` e ia para a API por `...filters`. Espalhamento não dispara a
   * checagem de propriedade excedente do TypeScript, então uma chave renomeada
   * de um lado só some em silêncio do outro -- o filtro pararia de filtrar e
   * nada acusaria.
   */
  lifecycleStage?: string;
  ownerId?: string;
  companyId?: string;
  origin?: string;
  createdFrom?: string;
  createdTo?: string;
}

/**
 * Selo de ciclo de vida.
 *
 * Substitui o selo por `status`, que mostrava quatro valores ("Lead",
 * "Prospect", "Cliente", "Churned") para seis estágios reais -- lead e
 * "contatado" apareciam iguais, e "em negociação" aparecia como "Prospect".
 *
 * Mesma marcação de Leads.tsx de propósito: a mesma pessoa era descrita em dois
 * vocabulários dependendo da tela em que você a olhasse.
 */
function LifecycleBadge({ stage }: { stage: LifecycleStage | null }) {
  const e = stage ?? "lead";
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: LIFECYCLE_COLORS[e] }}
      />
      <span className="truncate">{LIFECYCLE_LABELS[e]}</span>
    </span>
  );
}

/** Selo colorido indicando a origem do contato (de onde veio) */
function OriginBadge({ metadata }: { metadata: unknown }) {
  const o = getContactOrigin(metadata as Record<string, unknown> | null);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-label font-medium text-muted-foreground whitespace-nowrap">
      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: o.color }} />
      {o.label}
    </span>
  );
}

export default function Contacts() {
  const { orgId } = useOrg();
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  // UI state
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const { sortKey, sortDir, toggleSort } = useOrdenacao<SortKey>("created_at");
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<ContactFilters>({});
  /** Exclusão aguardando confirmação, com o que será apagado junto. */
  const [exclusao, setExclusao] = useState<{ ids: string[]; negocios: number; atividades: number } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [drawerContact, setDrawerContact] = useState<Contact | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  /**
   * As origens que EXISTEM na base, para o filtro deixar de ser lista fixa.
   *
   * Eram quatro buckets cravados. Desde que a importação grava o nome escolhido
   * ("NEXMED 2026", "APROXIMA MED"), o selo da lista mostrava um valor que o
   * filtro não oferecia -- dava para ver a origem e não dava para filtrar por
   * ela, o pior dos dois mundos.
   */
  const [origensReais, setOrigensReais] = useState<{ origem: string; contatos: number }[]>([]);

  // Debounce search to avoid a query on every keystroke
  const debouncedSearch = useDebounce(search, 300);


  // Reset to page 0 when filters/search/sort change
  useEffect(() => { setPage(0); }, [debouncedSearch, filters, sortKey, sortDir]);

  // Seleção não pode sobreviver a mudança de página/filtro/busca —
  // senão ações em lote atingem linhas que o usuário não está mais vendo
  useEffect(() => { setSelectedContacts(new Set()); }, [page, debouncedSearch, filters]);

  useEffect(() => {
    if (searchParams.get("action") === "new") {
      setCreateOpen(true);
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  /**
   * `?estagio=lead` — é para cá que /leads redireciona.
   *
   * A tela de Leads era uma FILA DE TRIAGEM e foi removida; o que ela mostrava
   * é esta lista com o filtro aplicado. O parâmetro é consumido e o painel de
   * filtros abre, senão a pessoa vê uma lista curta sem entender por quê -- uma
   * lista filtrada em silêncio lê-se como base vazia.
   *
   * Diferente do `action=new`, o parâmetro NÃO é apagado da URL: apagá-lo faria
   * um F5 perder o filtro, e o link salvo deixaria de significar o que dizia.
   */
  useEffect(() => {
    if (!orgId) return;
    let vivo = true;
    contactsApi.listarOrigens(orgId)
      .then((r) => { if (vivo) setOrigensReais(r); })
      // Falhar aqui não pode derrubar a tela: sem a lista dinâmica o filtro
      // volta a ter só os quatro grupos, que é o comportamento anterior.
      .catch(() => { if (vivo) setOrigensReais([]); });
    return () => { vivo = false; };
  }, [orgId]);

  useEffect(() => {
    const estagio = searchParams.get("estagio");
    if (!estagio) return;
    setFilters((f) => (f.lifecycleStage === estagio ? f : { ...f, lifecycleStage: estagio }));
    setShowFilters(true);
  }, [searchParams]);

  // Server-side query — all filtering, sorting and pagination on Postgres
  const queryParams = {
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
    sortKey,
    sortDir,
    ...filters,
  };
  const {
    data: result,
    isFetching,
    isLoading,
    isError,
    refetch,
  } = useContacts(queryParams);
  const contacts = result?.data ?? [];
  const totalCount = result?.count ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Kanban por vendedor precisa de TODOS os contatos, não só a página atual
  const { data: allContactsForKanban = [] } = useAllContacts(
    { search: debouncedSearch || undefined, ...filters },
    viewMode === "owner"
  );

  // Supporting data (small datasets, cached separately)
  const { data: companies = [] } = useCompanies();
  /**
   * Empresa por id, em vez de `.find()` dentro do `.map()` das linhas.
   *
   * Com 50 linhas e 200 empresas, aquilo era 10 mil comparações por render --
   * e refazia tudo a cada tecla digitada na busca. O mapa é O(1) por linha e
   * só é reconstruído quando a lista de empresas muda.
   */
  const empresaPorId = useMemo(
    () => new Map(companies.map((co) => [co.id, co])),
    [companies],
  );
  const { data: members = [] } = useMembers();
  const { data: lastActivityMap = new Map() } = useLastActivities();

  // Mutations
  const { mutateAsync: deleteMany } = useDeleteContacts();
  const { mutateAsync: updateLifecycle } = useUpdateContactsLifecycle();
  const { mutateAsync: updateOwner } = useUpdateContactOwner();

  // Realtime — invalidate all contact queries on remote changes
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel("contacts-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts", filter: `org_id=eq.${orgId}` }, () => {
        qc.invalidateQueries({ queryKey: contactsKeys.all(orgId) });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orgId, qc]);

  const invalidate = () => {
    if (!orgId) return;
    qc.invalidateQueries({ queryKey: contactsKeys.all(orgId) });
    // O PAINEL também. Importar 93 contatos não mexia em "Leads recebidos",
    // porque as consultas dele vivem em chaves outras -- e o número velho na
    // tela fazia parecer que a importação não funcionou.
    invalidarPainel(qc, orgId);
  };

  const getInactivityDays = (contactId: string, createdAt: string | null) => {
    const lastAct = lastActivityMap.get(contactId);
    const ref = lastAct || (createdAt ? new Date(createdAt) : null);
    if (!ref) return null;
    return Math.floor((Date.now() - ref.getTime()) / 86400000);
  };

  const handleOwnerChange = async (contactId: string, newOwnerId: string | null) => {
    try {
      await updateOwner({ id: contactId, ownerId: newOwnerId });
      toast({ title: newOwnerId ? "Responsável atribuído" : "Responsável removido" });
    } catch (e: unknown) {
      toast({ title: "Erro ao atribuir responsável", description: mensagemErro(e), variant: "destructive" });
    }
  };


  const allSelected = contacts.length > 0 && contacts.every((c) => selectedContacts.has(c.id));
  const toggleAll = () => {
    if (allSelected) setSelectedContacts(new Set());
    else setSelectedContacts(new Set(contacts.map((c) => c.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedContacts);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedContacts(next);
  };

  /**
   * Passo 1: descobrir o que está vinculado antes de tentar apagar.
   *
   * Antes ia direto no DELETE, e o Postgres recusava com violação de chave
   * estrangeira -- `deals.contact_id` e `activities.contact_id` não têm
   * ON DELETE. Pior: o `catch` mostrava "[object Object]", porque o erro do
   * PostgREST é um objeto simples e não passa no `e instanceof Error`. O
   * usuário via que falhou e nada sobre o motivo, com a informação disponível
   * no campo `message`.
   */
  const pedirExclusao = async () => {
    const ids = Array.from(selectedContacts);
    if (ids.length === 0) return;
    try {
      const vinculos = await contactsApi.contarVinculos(ids);
      if (vinculos.negocios === 0 && vinculos.atividades === 0) {
        await executarExclusao(ids, false);
        return;
      }
      // Só pergunta quando há o que perder. Confirmação para exclusão sem
      // consequência é ruído, e ruído treina as pessoas a clicar sem ler.
      setExclusao({ ids, ...vinculos });
    } catch (e: unknown) {
      toast({ title: "Erro ao verificar vínculos", description: mensagemErro(e), variant: "destructive" });
    }
  };

  const executarExclusao = async (ids: string[], comVinculos: boolean) => {
    try {
      await deleteMany({ ids, comVinculos });
      setSelectedContacts(new Set());
      setExclusao(null);
      toast({ title: `${ids.length} contato${ids.length !== 1 ? "s" : ""} excluído${ids.length !== 1 ? "s" : ""}` });
    } catch (e: unknown) {
      toast({ title: "Erro ao excluir contatos", description: mensagemErro(e), variant: "destructive" });
    }
  };

  /**
   * Move os selecionados no ciclo de vida.
   *
   * Escrevia `status` (coluna legada) e deixava o trigger derivar o ciclo de
   * vida. Com quatro valores para seis estágios, a derivação perde informação:
   * "prospect" virava sempre 'qualified', então aplicar "Prospect" a alguém em
   * negociação o REBAIXAVA sem aviso.
   */
  const batchChangeLifecycle = async (stage: LifecycleStage) => {
    const ids = Array.from(selectedContacts);
    try {
      await updateLifecycle({ ids, stage });
      setSelectedContacts(new Set());
      toast({ title: `${ids.length} contatos movidos para ${LIFECYCLE_LABELS[stage]}` });
    } catch (e: unknown) {
      toast({ title: "Erro ao mover contatos", description: mensagemErro(e), variant: "destructive" });
    }
  };

  // Escapa célula CSV: aspas duplicadas + prefixo contra injeção de fórmula (Excel)

  const [exporting, setExporting] = useState(false);
  const exportCSV = async () => {
    if (!orgId) return;
    setExporting(true);
    try {
      // Exporta TODOS os contatos com os filtros atuais, não só a página visível
      const allContacts = await contactsApi.listAll(orgId, {
        search: debouncedSearch || undefined, sortKey, sortDir, ...filters,
      });
      const rows = allContacts.map((c) => {
        const comp = empresaPorId.get((c as Record<string, unknown>).company_id as string);
        return {
          Nome: c.first_name, Sobrenome: c.last_name || "", Email: c.email || "",
          // O CSV leva o dado CRU, não o formatado: exportação existe para
          // reimportar e para cruzar com outro sistema, e máscara atrapalha as duas.
          Telefone: c.phone || "", Cargo: c.title || "", Empresa: comp?.name || "", "Ciclo de vida": LIFECYCLE_LABELS[c.lifecycle_stage ?? "lead"],
        };
      });
      exportarCSV(rows, "contatos");
      toast({ title: `${rows.length} contatos exportados` });
    } catch (e: unknown) {
      toast({ title: "Erro ao exportar", description: mensagemErro(e), variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  if (!orgId) return <SemOrganizacao />;

  return (
    <PageShell
      title="Contatos"
      contagem={{ valor: totalCount, unidade: "contato" }}
      actions={
        <>
          {/* Quatro telas tinham a própria cópia deste seletor, já divergentes
              em raio e espaçamento, e nenhuma anunciava seleção. */}
          <SegmentedControl<ViewMode>
            rotuloGrupo="Visualização"
            valor={viewMode}
            onChange={setViewMode}
            opcoes={[
              { valor: "table" as const, rotulo: "Tabela", icone: List },
              { valor: "cards" as const, rotulo: "Cartões", icone: LayoutGrid },
              // Aberta para todo mundo desde que a base virou da organização:
              // era aqui que se via de quem é cada contato, e sem isso a lista
              // de 800 pessoas não responde mais "quais são os meus?".
              { valor: "owner" as const, rotulo: "Vendedor", icone: Users },
            ]}
          />
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="mr-1 h-3.5 w-3.5" /><span className="hidden sm:inline">Filtros</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCsvOpen(true)} className="hidden sm:flex">
            <Upload className="mr-1.5 h-3.5 w-3.5" />Importar
          </Button>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={exporting} className="hidden sm:flex">
              {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}Exportar
            </Button>
          )}
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 sm:mr-2 h-4 w-4" /><span className="hidden sm:inline">Novo Contato</span><span className="sm:hidden">Novo</span>
          </Button>
        </>
      }
    >


      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por nome, email..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        {isFetching && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {showFilters && (
        <BarraDeFiltros>
          {/* ORDENAÇÃO EM SELETOR, e não só nos cabeçalhos.
              Ao juntar nove colunas em seis, "Email" e "Especialidade"
              perderam o cabeçalho clicável -- e com ele a única forma de
              ordenar por eles. A API continuava sabendo; faltava como pedir.
              Uma célula compartilhada só consegue ordenar por um campo, então
              o seletor cobre os cinco. Os cabeçalhos que sobraram continuam
              clicáveis: quem já sabia não perde o atalho. */}
          <div className="space-y-1">
            <Label className="text-xs">Ordenar por</Label>
            <Select value={sortKey} onValueChange={(v) => toggleSort(v as SortKey)}>
              <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {([
                  ["name", "Nome"],
                  ["email", "E-mail"],
                  ["title", "Especialidade"],
                  ["status", "Situação"],
                  ["created_at", "Criado em"],
                ] as [SortKey, string][]).map(([campo, rotulo]) => (
                  <SelectItem key={campo} value={campo}>{rotulo}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Ciclo de vida</Label>
            {/* Os seis estágios, na ordem do avanço. O seletor antigo era por
                `status` (coluna legada) e tinha quatro opções, sem lead nem
                "em negociação" -- então havia gente na lista que nenhum filtro
                conseguia isolar. */}
            <Select
              value={filters.lifecycleStage || "all"}
              onValueChange={(v) => setFilters({ ...filters, lifecycleStage: v === "all" ? undefined : v })}
            >
              <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {(Object.keys(LIFECYCLE_LABELS) as LifecycleStage[]).map((e) => (
                  <SelectItem key={e} value={e}>{LIFECYCLE_LABELS[e]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Filtrar por responsável é o que devolve a carteira de cada um
              depois que a base passou a ser da organização inteira. */}
          <div className="space-y-1">
            <Label className="text-xs">Responsável</Label>
            <Select value={filters.ownerId || "all"} onValueChange={(v) => setFilters({ ...filters, ownerId: v === "all" ? undefined : v })}>
              <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name || m.email}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Empresa</Label>
            <Select value={filters.companyId || "all"} onValueChange={(v) => setFilters({ ...filters, companyId: v === "all" ? undefined : v })}>
              <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Origem</Label>
            <Select value={filters.origin || "all"} onValueChange={(v) => setFilters({ ...filters, origin: v === "all" ? undefined : v })}>
              <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {ORIGIN_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                {/* As origens de verdade, depois dos grupos.
                    Os quatro de cima agrupam por padrão de texto; estas são
                    valores literais, e por isso levam prefixo -- uma planilha
                    chamada "manual" cairia no bucket errado sem ele.
                    A contagem ao lado responde "vale filtrar por esta?" antes
                    do clique. */}
                {origensReais.length > 0 && (
                  <div className="my-1 border-t border-border" role="presentation" />
                )}
                {origensReais.map((o) => (
                  <SelectItem key={o.origem} value={`${PREFIXO_ORIGEM_EXATA}${o.origem}`}>
                    {o.origem} ({o.contatos})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Criado de</Label>
            <Input type="date" className="w-36 h-8 text-xs" value={filters.createdFrom ?? ""} onChange={(e) => setFilters({ ...filters, createdFrom: e.target.value || undefined })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">até</Label>
            <Input type="date" className="w-36 h-8 text-xs" value={filters.createdTo ?? ""} onChange={(e) => setFilters({ ...filters, createdTo: e.target.value || undefined })} />
          </div>
          {Object.values(filters).some(Boolean) && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setFilters({})}>
              <X className="mr-1 h-3 w-3" />Limpar
            </Button>
          )}
        </BarraDeFiltros>
      )}

      {selectedContacts.size > 0 && (
        <BarraDeSelecao
          quantidade={selectedContacts.size}
          substantivo="contato"
          substantivoPlural="contatos"
          onLimpar={() => setSelectedContacts(new Set())}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">Mudar Status</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {/* "Novo lead" fica por último e nomeado pelo efeito: é o único
                  item que ANDA PARA TRÁS no ciclo de vida, e devolve a pessoa
                  para a fila de qualificação. Estava misturado aos outros como
                  "Lead", indistinguível de um avanço. */}
              <DropdownMenuItem onClick={() => batchChangeLifecycle("contacted")}>Contatado</DropdownMenuItem>
              <DropdownMenuItem onClick={() => batchChangeLifecycle("qualified")}>Qualificado</DropdownMenuItem>
              <DropdownMenuItem onClick={() => batchChangeLifecycle("opportunity")}>Em negociação</DropdownMenuItem>
              <DropdownMenuItem onClick={() => batchChangeLifecycle("customer")}>Cliente</DropdownMenuItem>
              <DropdownMenuItem onClick={() => batchChangeLifecycle("disqualified")}>Descartado</DropdownMenuItem>
              <DropdownMenuItem onClick={() => batchChangeLifecycle("lead")}>
                Devolver para a fila de leads
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {isAdmin && (
            <Button size="sm" variant="destructive" onClick={pedirExclusao}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />Excluir
            </Button>
          )}
        </BarraDeSelecao>
      )}

      {viewMode === "table" && (
        <div className="vx-table">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {/* OITO colunas, não nove -- e o espaço vem de outro lugar.
                    A rolagem lateral foi resolvida tirando o AVATAR (44px por
                    linha, decorativo: iniciais de quem não tem foto não
                    informam nada) e movendo o e-mail para baixo do nome, o que
                    eliminou uma coluna inteira.
                    Empresa, Especialidade e Origem voltaram a ser colunas
                    próprias: são três perguntas diferentes, e juntá-las obrigava
                    a ler a célula inteira para achar uma. */}
                <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Selecionar todos" /></TableHead>
                <TableHead><SortHeader rotulo="Contato" campo="name" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></TableHead>
                <TableHead className="hidden sm:table-cell">Empresa</TableHead>
                <TableHead className="hidden md:table-cell"><SortHeader rotulo="Especialidade" campo="title" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></TableHead>
                <TableHead className="hidden md:table-cell w-[140px]">Telefone</TableHead>
                <TableHead className="w-[130px]"><SortHeader rotulo="Situação" campo="status" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></TableHead>
                <TableHead className="hidden lg:table-cell w-[150px]">Origem</TableHead>
                <TableHead className="hidden lg:table-cell w-[110px]"><SortHeader rotulo="Criado em" campo="created_at" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => setDrawerContact(c)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selectedContacts.has(c.id)} onCheckedChange={() => toggleOne(c.id)} aria-label={`Selecionar ${c.first_name}`} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium truncate">{nomeDoContato(c.first_name, c.last_name)}</span>
                          {(() => {
                            const days = getInactivityDays(c.id, c.created_at);
                            if (days === null || days < 14) return null;
                            const isHigh = days >= 21;
                            return (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className={`inline-flex items-center gap-0.5 text-label font-semibold px-1 py-0.5 rounded ${isHigh ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>
                                      <AlertTriangle className="h-2.5 w-2.5" />{days}d
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">{days} dias sem atividade</TooltipContent>
                                </Tooltip>
                            );
                          })()}
                        </div>
                        {/* Sempre visível, não só no celular: é o que permitiu
                            a coluna de e-mail sair. */}
                        <span className="block truncate text-xs text-muted-foreground">{formatarEmail(c.email)}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                    {(() => {
                      const comp = empresaPorId.get((c as Record<string, unknown>).company_id as string);
                      if (comp) return comp.name;
                      const meta = (c as Record<string, unknown>).metadata as Record<string, string> | null;
                      return meta?.empresa_manual || "—";
                    })()}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{c.title || "—"}</TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground tabular-nums">{formatarTelefone(c.phone)}</TableCell>
                  <TableCell><LifecycleBadge stage={c.lifecycle_stage} /></TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <OriginBadge metadata={(c as Record<string, unknown>).metadata} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs hidden lg:table-cell">
                    {formatarData(c.created_at)}
                  </TableCell>
                </TableRow>
              ))}
              {contacts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="p-0">
                    {/* Carregando, falhou e vazio pediam a MESMA frase antes.
                        Falha de consulta virava "nenhum contato encontrado" --
                        afirmação que a tela não tinha como sustentar. */}
                    {isLoading ? (
                      <LoadingState linhas={5} className="p-3" />
                    ) : isError ? (
                      <ErrorState onTentarNovamente={() => refetch()} className="m-3" />
                    ) : (
                      <EmptyState
                        icone={UsersIcon}
                        titulo="Nenhum contato encontrado"
                        descricao={
                          debouncedSearch || Object.values(filters).some(Boolean)
                            ? "Nenhum resultado para a busca e os filtros atuais."
                            : "Cadastre o primeiro contato ou importe uma planilha."
                        }
                      />
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>
        </div>
      )}

      {viewMode === "cards" && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {contacts.map((c) => (
            <Card key={c.id} className="cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/40" onClick={() => setDrawerContact(c)}>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-primary/10 text-primary text-sm">
                      {initials(nomeDoContato(c.first_name, c.last_name))}
                    </AvatarFallback>
                  </Avatar>
                  <div className="overflow-hidden">
                    <p className="font-medium truncate">{nomeDoContato(c.first_name, c.last_name)}</p>
                    {c.title && <p className="text-xs text-muted-foreground truncate">{c.title}</p>}
                  </div>
                </div>
                {c.email && <p className="text-xs text-muted-foreground truncate">{formatarEmail(c.email)}</p>}
                <div className="flex flex-wrap items-center gap-1.5">
                  <LifecycleBadge stage={c.lifecycle_stage} />
                  <OriginBadge metadata={(c as Record<string, unknown>).metadata} />
                </div>
              </CardContent>
            </Card>
          ))}
          {contacts.length === 0 && (
            <div className="col-span-full">
              {isLoading ? (
                <LoadingState linhas={4} />
              ) : isError ? (
                <ErrorState onTentarNovamente={() => refetch()} />
              ) : (
                <EmptyState
                  icone={UsersIcon}
                  titulo="Nenhum contato encontrado"
                  descricao={
                    debouncedSearch || Object.values(filters).some(Boolean)
                      ? "Nenhum resultado para a busca e os filtros atuais."
                      : "Cadastre o primeiro contato ou importe uma planilha."
                  }
                />
              )}
            </div>
          )}
        </div>
      )}

      {viewMode === "owner" && (
        <ContactsKanbanByOwner
          contacts={allContactsForKanban}
          companies={companies}
          members={members}
          onContactClick={(c) => setDrawerContact(c)}
          onOwnerChange={handleOwnerChange}
        />
      )}

      {viewMode !== "owner" && (
        <Paginacao
          pagina={page}
          totalPaginas={totalPages}
          total={totalCount}
          unidade="contato"
          onMudar={setPage}
        />
      )}

      {/* Confirmação nomeando o que será apagado.
          Sem transação no PostgREST: os filhos são apagados antes do contato, e
          se o último passo falhar sobra um contato sem negócios. Por isso a
          contagem aparece aqui, e não um "tem certeza?" genérico. */}
      <Dialog open={!!exclusao} onOpenChange={(o) => !o && setExclusao(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Excluir {exclusao?.ids.length} contato{(exclusao?.ids.length ?? 0) !== 1 ? "s" : ""}?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Isto vai apagar também:</p>
                <ul className="list-disc pl-5">
                  {!!exclusao?.negocios && (
                    <li>
                      {exclusao.negocios} negócio{exclusao.negocios !== 1 ? "s" : ""} — valor e
                      histórico de etapas incluídos
                    </li>
                  )}
                  {!!exclusao?.atividades && (
                    <li>
                      {exclusao.atividades} atividade{exclusao.atividades !== 1 ? "s" : ""} —
                      ligações, reuniões e notas registradas
                    </li>
                  )}
                </ul>
                <p className="text-muted-foreground">
                  E-mails e mensagens de WhatsApp são preservados, apenas deixam de estar
                  vinculados. Nada disso pode ser desfeito.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExclusao(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => exclusao && executarExclusao(exclusao.ids, true)}
            >
              Excluir tudo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ContactDrawer
        contact={drawerContact}
        onClose={() => setDrawerContact(null)}
        onUpdate={invalidate}
        companies={companies}
      />

      <ContactCreateModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={invalidate}
        companies={companies}
      />

      <CSVImportModal
        open={csvOpen}
        onOpenChange={setCsvOpen}
        onImported={invalidate}
        entityType="contacts"
      />
    </PageShell>
  );
}
