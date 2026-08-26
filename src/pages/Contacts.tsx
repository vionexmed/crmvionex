import { useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
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
  Plus, Search, LayoutGrid, List, Filter, ArrowUpDown, Upload, Download,
  Trash2, ChevronLeft, ChevronRight, X, AlertTriangle, Users, Loader2,
} from "lucide-react";
import { ContactsKanbanByOwner } from "@/components/crm/ContactsKanbanByOwner";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { ContactDrawer } from "@/components/crm/ContactDrawer";
import { ContactCreateModal } from "@/components/crm/ContactCreateModal";
import { CSVImportModal } from "@/components/crm/CSVImportModal";
import { useDebounce } from "@/hooks/useDebounce";
import type { Database } from "@/integrations/supabase/types";

type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type SortKey = "name" | "email" | "status" | "created_at" | "title";
type SortDir = "asc" | "desc";
type ViewMode = "table" | "cards" | "owner";

const cleanPhone = (p: string | null) => p || "";

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
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground whitespace-nowrap">
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
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<ContactFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [drawerContact, setDrawerContact] = useState<Contact | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

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

  // Server-side query — all filtering, sorting and pagination on Postgres
  const queryParams = {
    page,
    pageSize: PAGE_SIZE,
    search: debouncedSearch || undefined,
    sortKey,
    sortDir,
    ...filters,
  };
  const { data: result, isFetching } = useContacts(queryParams);
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
    if (orgId) qc.invalidateQueries({ queryKey: contactsKeys.all(orgId) });
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
      toast({ title: "Erro ao atribuir responsável", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const allSelected = contacts.length > 0 && contacts.every((c) => selectedContacts.has(c.id));
  const toggleAll = () => {
    if (allSelected) setSelectedContacts(new Set());
    else setSelectedContacts(new Set(contacts.map((c) => c.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedContacts);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedContacts(next);
  };

  const batchDelete = async () => {
    const ids = Array.from(selectedContacts);
    try {
      await deleteMany(ids);
      setSelectedContacts(new Set());
      toast({ title: `${ids.length} contatos excluídos` });
    } catch (e: unknown) {
      toast({ title: "Erro ao excluir contatos", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
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
      toast({ title: "Erro ao mover contatos", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  // Escapa célula CSV: aspas duplicadas + prefixo contra injeção de fórmula (Excel)
  const csvCell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };

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
        const comp = companies.find((co) => co.id === (c as Record<string, unknown>).company_id);
        return {
          Nome: c.first_name, Sobrenome: c.last_name || "", Email: c.email || "",
          Telefone: cleanPhone(c.phone), Cargo: c.title || "", Empresa: comp?.name || "", "Ciclo de vida": LIFECYCLE_LABELS[c.lifecycle_stage ?? "lead"],
        };
      });
      const headers = Object.keys(rows[0] || { Nome: "" });
      const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => csvCell((r as Record<string, unknown>)[h])).join(","))].join("\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "contatos.csv"; a.click();
      URL.revokeObjectURL(url);
      toast({ title: `${rows.length} contatos exportados` });
    } catch (e: unknown) {
      toast({ title: "Erro ao exportar", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <button onClick={() => toggleSort(field)} className="flex items-center gap-1 hover:text-foreground transition-colors">
      {label}<ArrowUpDown className="h-3 w-3" />
    </button>
  );

  if (!orgId) return <div className="py-20 text-center text-muted-foreground">Crie uma organização em Configurações primeiro.</div>;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={UsersIcon}
        kicker="Diretório"
        title="Contatos"
        description={`${totalCount} contatos cadastrados`}
        pattern="dots"
        actions={
          <>
            <div className="flex rounded-lg border border-border bg-muted/50 p-0.5">
              {[
                { mode: "table" as const, icon: List, label: "Tabela" },
                { mode: "cards" as const, icon: LayoutGrid, label: "Cartões" },
                // Distribuição por vendedor é ação de gestor
                ...(isAdmin ? [{ mode: "owner" as const, icon: Users, label: "Vendedor" }] : []),
              ].map(({ mode, icon: Icon, label }) => (
                <button key={mode} onClick={() => setViewMode(mode)} aria-label={`Visualização ${label}`}
                  className={`flex items-center gap-1 rounded-md px-2 sm:px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  <Icon className="h-3.5 w-3.5" /><span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
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
      />

      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por nome, email..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        {isFetching && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
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
          {isAdmin && (
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
          )}
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
        </div>
      )}

      {selectedContacts.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-2">
          <span className="text-sm font-medium">{selectedContacts.size} selecionados</span>
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
            <Button size="sm" variant="destructive" onClick={batchDelete}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />Excluir
            </Button>
          )}
        </div>
      )}

      {viewMode === "table" && (
        <div className="vx-table">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Selecionar todos" /></TableHead>
                <TableHead><SortHeader label="Nome" field="name" /></TableHead>
                <TableHead><SortHeader label="Email" field="email" /></TableHead>
                <TableHead className="hidden sm:table-cell">Empresa</TableHead>
                <TableHead className="hidden md:table-cell"><SortHeader label="Especialidade" field="title" /></TableHead>
                <TableHead className="hidden md:table-cell">Telefone</TableHead>
                <TableHead><SortHeader label="Status" field="status" /></TableHead>
                <TableHead className="hidden lg:table-cell">Origem</TableHead>
                <TableHead className="hidden lg:table-cell"><SortHeader label="Criado em" field="created_at" /></TableHead>
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
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">
                          {c.first_name?.[0] || "?"}{c.last_name?.[0] || ""}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium truncate">{c.first_name} {c.last_name}</span>
                          {(() => {
                            const days = getInactivityDays(c.id, c.created_at);
                            if (days === null || days < 14) return null;
                            const isHigh = days >= 21;
                            return (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1 py-0.5 rounded ${isHigh ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>
                                      <AlertTriangle className="h-2.5 w-2.5" />{days}d
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">{days} dias sem atividade</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            );
                          })()}
                        </div>
                        <span className="text-xs text-muted-foreground truncate block sm:hidden">{c.email}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{c.email || "—"}</TableCell>
                  <TableCell className="text-muted-foreground hidden sm:table-cell text-xs">
                    {(() => {
                      const comp = companies.find((co) => co.id === (c as Record<string, unknown>).company_id);
                      if (comp) return comp.name;
                      const meta = (c as Record<string, unknown>).metadata as Record<string, string> | null;
                      return meta?.empresa_manual || "—";
                    })()}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden md:table-cell text-xs">{c.title || "—"}</TableCell>
                  <TableCell className="text-muted-foreground hidden md:table-cell text-xs">{cleanPhone(c.phone) || "—"}</TableCell>
                  <TableCell>
                    <LifecycleBadge stage={c.lifecycle_stage} />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <OriginBadge metadata={(c as Record<string, unknown>).metadata} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs hidden lg:table-cell">
                    {c.created_at ? new Date(c.created_at).toLocaleDateString("pt-BR") : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {contacts.length === 0 && (
                <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">Nenhum contato encontrado</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          </div>
        </div>
      )}

      {viewMode === "cards" && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {contacts.map((c) => (
            <Card key={c.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setDrawerContact(c)}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-primary/10 text-primary text-sm">
                      {c.first_name?.[0] || "?"}{c.last_name?.[0] || ""}
                    </AvatarFallback>
                  </Avatar>
                  <div className="overflow-hidden">
                    <p className="font-medium truncate">{c.first_name} {c.last_name}</p>
                    {c.title && <p className="text-xs text-muted-foreground truncate">{c.title}</p>}
                  </div>
                </div>
                {c.email && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
                <div className="flex flex-wrap items-center gap-1.5">
                  <LifecycleBadge stage={c.lifecycle_stage} />
                  <OriginBadge metadata={(c as Record<string, unknown>).metadata} />
                </div>
              </CardContent>
            </Card>
          ))}
          {contacts.length === 0 && (
            <div className="col-span-full py-10 text-center text-muted-foreground">Nenhum contato encontrado</div>
          )}
        </div>
      )}

      {viewMode === "owner" && isAdmin && (
        <ContactsKanbanByOwner
          contacts={allContactsForKanban}
          members={members}
          companies={companies}
          onContactClick={(c) => setDrawerContact(c)}
          onOwnerChange={handleOwnerChange}
        />
      )}

      {viewMode !== "owner" && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Página {page + 1} de {totalPages} · {totalCount} contatos
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <ContactDrawer
        contact={drawerContact}
        onClose={() => setDrawerContact(null)}
        onUpdate={invalidate}
        companies={companies}
        members={members}
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
    </div>
  );
}
