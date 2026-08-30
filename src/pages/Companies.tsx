import { useEffect, useState, useMemo } from "react";
import { PageShell } from "@/components/layout/PageShell";
import { Building2 as Building2Icon } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
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
  Plus, Search, LayoutGrid, List, Filter, Upload, Download,
  Trash2, ChevronLeft, ChevronRight, X, Building2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CompanyDrawer } from "@/components/crm/CompanyDrawer";
import { CompanyCreateModal } from "@/components/crm/CompanyCreateModal";
import { CSVImportModal } from "@/components/crm/CSVImportModal";
import type { Database } from "@/integrations/supabase/types";
import { useQueryClient } from "@tanstack/react-query";
import { useCompanies, useDeleteCompany, companiesKeys } from "@/hooks/queries/useCompanies";
import { useMembers } from "@/hooks/queries/useMembers";
import { SortHeader, useOrdenacao } from "@/components/layout/SortHeader";
import { LoadingState, ErrorState, EmptyState } from "@/components/layout/EstadoDaLista";
import { formatarData, formatarMoedaInteira } from "@/lib/formato";
import { SegmentedControl } from "@/components/layout/SegmentedControl";
import { SemOrganizacao } from "@/components/layout/SemOrganizacao";
import { exportarCSV } from "@/lib/csv";

type Company = Database["public"]["Tables"]["companies"]["Row"];

type SortKey = "name" | "domain" | "industry" | "size" | "revenue" | "created_at";
type ViewMode = "table" | "cards";
const PAGE_SIZE = 50;

interface CompanyFilters {
  industry?: string;
  size?: string;
  ownerId?: string;
}

export default function Companies() {
  const { orgId } = useOrg();
  const { toast } = useToast();
  const qc = useQueryClient();

  // `isLoading` e `isError` existiam e eram DESCARTADOS: a página
  // desestruturava só `data`. Enquanto a consulta rodava, a tabela mostrava
  // "Nenhuma empresa encontrada" -- e mostrava o mesmo se a consulta falhasse.
  // Três situações, uma resposta só, e a errada nas duas primeiras.
  const { data: companies = [], isLoading: carregando, isError: falhou, refetch } = useCompanies();
  const { data: members = [] } = useMembers();
  const deleteCompany = useDeleteCompany();

  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const { sortKey, sortDir, toggleSort } = useOrdenacao<SortKey>("created_at");
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<CompanyFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [selectedCompanies, setSelectedCompanies] = useState<Set<string>>(new Set());

  const [drawerCompany, setDrawerCompany] = useState<Company | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("action") === "new") {
      setCreateOpen(true);
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Realtime subscription — invalidate React Query cache on remote changes
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`companies:${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "companies", filter: `org_id=eq.${orgId}` }, () => {
        qc.invalidateQueries({ queryKey: companiesKeys.all(orgId) });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orgId, qc]);

  const invalidate = () => {
    if (orgId) qc.invalidateQueries({ queryKey: companiesKeys.all(orgId) });
  };

  // Get unique industries for filter
  const industries = useMemo(() => {
    return [...new Set(companies.map((c) => c.industry).filter(Boolean))] as string[];
  }, [companies]);

  const filtered = useMemo(() => {
    return companies.filter((c) => {
      const s = `${c.name} ${c.domain} ${c.industry}`.toLowerCase();
      if (search && !s.includes(search.toLowerCase())) return false;
      if (filters.industry && c.industry !== filters.industry) return false;
      if (filters.size && c.size !== filters.size) return false;
      if (filters.ownerId && c.owner_id !== filters.ownerId) return false;
      return true;
    });
  }, [companies, search, filters]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "domain": cmp = (a.domain || "").localeCompare(b.domain || ""); break;
        case "industry": cmp = (a.industry || "").localeCompare(b.industry || ""); break;
        case "size": cmp = (a.size || "").localeCompare(b.size || ""); break;
        case "revenue": cmp = (Number(a.revenue) || 0) - (Number(b.revenue) || 0); break;
        case "created_at": cmp = (a.created_at || "").localeCompare(b.created_at || ""); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paginated = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);


  const allSelected = paginated.length > 0 && paginated.every((c) => selectedCompanies.has(c.id));
  const toggleAll = () => {
    if (allSelected) setSelectedCompanies(new Set());
    else setSelectedCompanies(new Set(paginated.map((c) => c.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedCompanies);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedCompanies(next);
  };

  const batchDelete = async () => {
    const ids = Array.from(selectedCompanies);
    await Promise.all(ids.map((id) => deleteCompany.mutateAsync(id)));
    setSelectedCompanies(new Set());
    toast({ title: `${ids.length} empresas excluídas` });
  };

  const exportCSV = () => {
    const rows = sorted.map((c) => ({
      Nome: c.name, Domínio: c.domain || "", Indústria: c.industry || "",
      Tamanho: c.size || "", Receita: c.revenue || "", Website: c.website || "",
    }));
    // Escrevia sem BOM e sem escapar aspas: o Excel abria com acento quebrado
    // ("Indústria" virava "IndÃºstria"), e uma empresa chamada
    // `Silva "Móveis" Ltda` deslocava todas as colunas da linha.
    exportarCSV(rows, "empresas");
    toast({ title: `${rows.length} empresas exportadas` });
  };


  if (!orgId) return <SemOrganizacao />;

  return (
    <PageShell
      icon={Building2Icon}
      kicker="Organizações"
      title="Empresas"
      description={`${filtered.length} empresas no diretório`}
      actions={
        <>
          <SegmentedControl<ViewMode>
            rotuloGrupo="Visualização"
            valor={viewMode}
            onChange={setViewMode}
            opcoes={[
              { valor: "table", rotulo: "Tabela", icone: List },
              { valor: "cards", rotulo: "Cartões", icone: LayoutGrid },
            ]}
          />
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} aria-label="Alternar filtros">
            <Filter className="mr-1 h-3.5 w-3.5" /><span className="hidden sm:inline">Filtros</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCsvOpen(true)} aria-label="Importar CSV" className="hidden sm:flex">
            <Upload className="mr-1.5 h-3.5 w-3.5" />Importar
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} aria-label="Exportar CSV" className="hidden sm:flex">
            <Download className="mr-1.5 h-3.5 w-3.5" />Exportar
          </Button>
          <Button onClick={() => setCreateOpen(true)} aria-label="Criar nova empresa">
            <Plus className="mr-1 sm:mr-2 h-4 w-4" /><span className="hidden sm:inline">Nova Empresa</span><span className="sm:hidden">Nova</span>
          </Button>
        </>
      }
    >


      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar empresas..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="space-y-1">
            <Label className="text-xs">Indústria</Label>
            <Select value={filters.industry || "all"} onValueChange={(v) => setFilters({ ...filters, industry: v === "all" ? undefined : v })}>
              <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {industries.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tamanho</Label>
            <Select value={filters.size || "all"} onValueChange={(v) => setFilters({ ...filters, size: v === "all" ? undefined : v })}>
              <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="1-10">1-10</SelectItem>
                <SelectItem value="11-50">11-50</SelectItem>
                <SelectItem value="51-200">51-200</SelectItem>
                <SelectItem value="201-500">201-500</SelectItem>
                <SelectItem value="500+">500+</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
          {Object.values(filters).some(Boolean) && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setFilters({})}>
              <X className="mr-1 h-3 w-3" />Limpar
            </Button>
          )}
        </div>
      )}

      {selectedCompanies.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-2">
          <span className="text-sm font-medium">{selectedCompanies.size} selecionadas</span>
          <Button size="sm" variant="destructive" onClick={batchDelete}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />Excluir
          </Button>
        </div>
      )}

      {carregando && <LoadingState linhas={8} />}

      {!carregando && falhou && (
        <ErrorState
          descricao="A lista de empresas não pôde ser carregada. Nenhum dado foi alterado."
          onTentarNovamente={() => refetch()}
        />
      )}

      {!carregando && !falhou && filtered.length === 0 && (
        <EmptyState
          icone={Building2Icon}
          titulo={search ? "Nenhuma empresa encontrada" : "Nenhuma empresa cadastrada"}
          descricao={
            search
              ? "Nenhuma empresa corresponde ao que você buscou."
              : "Cadastre a primeira empresa ou importe uma planilha."
          }
          acao={
            !search && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />Nova empresa
              </Button>
            )
          }
        />
      )}

      {!carregando && !falhou && filtered.length > 0 && viewMode === "table" && (
        <div className="vx-table">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Selecionar todas" /></TableHead>
                <TableHead><SortHeader rotulo="Empresa" campo="name" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></TableHead>
                <TableHead className="hidden sm:table-cell"><SortHeader rotulo="Domínio" campo="domain" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></TableHead>
                <TableHead className="hidden md:table-cell"><SortHeader rotulo="Indústria" campo="industry" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></TableHead>
                <TableHead className="hidden lg:table-cell"><SortHeader rotulo="Tamanho" campo="size" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></TableHead>
                <TableHead className="hidden lg:table-cell"><SortHeader rotulo="Receita" campo="revenue" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></TableHead>
                <TableHead className="hidden md:table-cell"><SortHeader rotulo="Criado em" campo="created_at" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => setDrawerCompany(c)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selectedCompanies.has(c.id)} onCheckedChange={() => toggleOne(c.id)} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {c.domain ? (
                        <img
                          src={`https://logo.clearbit.com/${c.domain}`}
                          alt=""
                          className="h-8 w-8 rounded-md bg-muted object-contain"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            <Building2 className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <span className="font-medium">{c.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden sm:table-cell">{c.domain}</TableCell>
                  <TableCell className="text-muted-foreground hidden md:table-cell">{c.industry}</TableCell>
                  <TableCell className="text-muted-foreground hidden lg:table-cell">{c.size}</TableCell>
                  <TableCell className="text-muted-foreground hidden lg:table-cell">{formatarMoedaInteira(Number(c.revenue))}</TableCell>
                  <TableCell className="text-muted-foreground text-xs hidden md:table-cell">
                    {c.created_at ? formatarData(c.created_at) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </div>
      )}

      {!carregando && !falhou && filtered.length > 0 && viewMode === "cards" && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {paginated.map((c) => (
            <Card key={c.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setDrawerCompany(c)}>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-3">
                  {c.domain ? (
                    <img src={`https://logo.clearbit.com/${c.domain}`} alt="" className="h-10 w-10 rounded-md bg-muted object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <Avatar className="h-10 w-10"><AvatarFallback className="bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></AvatarFallback></Avatar>
                  )}
                  <div className="overflow-hidden">
                    <p className="font-medium truncate">{c.name}</p>
                    {c.industry && <p className="text-xs text-muted-foreground truncate">{c.industry}</p>}
                  </div>
                </div>
                {c.domain && <p className="text-xs text-muted-foreground">{c.domain}</p>}
                {c.revenue && <p className="text-sm font-semibold text-primary">{formatarMoedaInteira(Number(c.revenue))}</p>}
              </CardContent>
            </Card>
          ))}
          {paginated.length === 0 && <div className="col-span-full py-10 text-center text-muted-foreground">Nenhuma empresa encontrada</div>}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Página {page + 1} de {totalPages} · {sorted.length} empresas</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      <CompanyDrawer company={drawerCompany} onClose={() => setDrawerCompany(null)} onUpdate={invalidate} />
      <CompanyCreateModal open={createOpen} onOpenChange={setCreateOpen} onCreated={invalidate} />
      <CSVImportModal open={csvOpen} onOpenChange={setCsvOpen} onImported={invalidate} entityType="companies" />
    </PageShell>
  );
}
