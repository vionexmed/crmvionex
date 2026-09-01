import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useDeals, useCreateDeal, useUpdateDeal, useUpdateDealStage, useUpdateDealStatus, useBatchUpdateDeals, dealsKeys } from "@/hooks/queries/useDeals";
import { useContactsPicker } from "@/hooks/queries/useContacts";
import { useCompanies } from "@/hooks/queries/useCompanies";
import { useMembers } from "@/hooks/queries/useMembers";
import { usePipelines, usePipelineStages, useSavePipelineStages } from "@/hooks/queries/usePipelines";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Kanban, List, TrendingUp, Plus, Filter, Settings2, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import { DealsKanban } from "@/components/crm/DealsKanban";
import { ContactDrawer } from "@/components/crm/ContactDrawer";
import { DealsList } from "@/components/crm/DealsList";
import { DealsForecast } from "@/components/crm/DealsForecast";
import { DealsFilters, type DealFilters } from "@/components/crm/DealsFilters";
import type { Database } from "@/integrations/supabase/types";
import type { EditingStage } from "@/lib/api/pipelines";
import { mensagemErro } from "@/lib/erro-supabase";
import { indexarPorId } from "@/lib/utils";
import { PageShell } from "@/components/layout/PageShell";
import { SegmentedControl } from "@/components/layout/SegmentedControl";
import { LinhaDeEtapa, COR_PADRAO_DE_ETAPA } from "@/components/crm/LinhaDeEtapa";
import { SemOrganizacao } from "@/components/layout/SemOrganizacao";
import type { DealWithRelations } from "@/lib/api/deals";
export type { DealWithRelations } from "@/lib/api/deals";

type Deal = Database["public"]["Tables"]["deals"]["Row"];
type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];
type ViewMode = "kanban" | "list" | "forecast";

export default function Deals() {
  const { orgId } = useOrg();
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Declare view state FIRST — used in conditional query params below
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [selectedPipeline, setSelectedPipeline] = useState<string>("");
  const [listPage, setListPage] = useState(0);

  // Supporting data
  const { data: allStages = [], isLoading: stagesLoading, isError: stagesError } = usePipelineStages();
  const { data: pipelines = [], isLoading: pipelinesLoading, isError: pipelinesError } = usePipelines();
  // Lista leve, sem o teto de 1000 linhas do PostgREST (inclui leads)
  const { data: contacts = [] } = useContactsPicker();
  const { data: companies = [] } = useCompanies();
  const { data: members = [] } = useMembers();

  // Kanban + Forecast: all deals (no pagination needed)
  const { data: allDealsResult = { data: [], count: 0 } } = useDeals();
  // List: server-side paginated
  const { data: listDealsResult = { data: [], count: 0 }, isFetching: listFetching } = useDeals(
    viewMode === "list" ? { page: listPage, pageSize: DEFAULT_PAGE_SIZE } : {}
  );

  const listTotalPages = Math.ceil((listDealsResult.count) / DEFAULT_PAGE_SIZE);

  const { mutateAsync: createDeal } = useCreateDeal();
  const { mutateAsync: updateDeal } = useUpdateDeal();
  const { mutateAsync: updateStage } = useUpdateDealStage();
  const { mutateAsync: updateStatus } = useUpdateDealStatus();
  const { mutateAsync: batchUpdate } = useBatchUpdateDeals();
  const { mutateAsync: savePipelineStages, isPending: savingPipeline } = useSavePipelineStages();

  // Junção do dono, feita no cliente porque `deals.owner_id` aponta para
  // `auth.users` e não para `profiles` -- sem FK entre as duas, o PostgREST não
  // consegue embutir o perfil.
  //
  // Índice em vez de `.find()` por negócio: varria a lista de membros inteira
  // para cada negócio, duas vezes (lista e kanban).
  const porDono = useMemo(() => indexarPorId(members), [members]);
  const allDeals = useMemo(
    () => allDealsResult.data.map((d) => ({ ...d, owner: (d.owner_id && porDono.get(d.owner_id)) ?? null })),
    [allDealsResult.data, porDono]
  );
  const listDeals = useMemo(
    () => listDealsResult.data.map((d) => ({ ...d, owner: (d.owner_id && porDono.get(d.owner_id)) ?? null })),
    [listDealsResult.data, porDono]
  );
  // Painel da pessoa. O contato vem do embed do próprio negócio, então abrir o
  // painel não custa consulta nenhuma.
  const [contatoNoPainel, setContatoNoPainel] = useState<ContactRow | null>(null);

  /**
   * Estável, porque desce até o card de cada negócio.
   *
   * Era `onDealClick={(d) => navigate(...)}` -- identidade nova a cada render
   * do pai. Com o dnd-kit, arrastar um card faz o quadro renderizar
   * continuamente, e um callback instável obriga TODOS os cards a renderizar
   * junto. `React.memo` no card não adiantaria nada enquanto esta prop mudasse:
   * ele compararia, veria diferente, e renderizaria igual -- pagando a
   * comparação sem pular nada.
   */
  const abrirNegocio = useCallback(
    (d: DealWithRelations) => navigate(`/deals/${d.id}`),
    [navigate],
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | null>(null);
  const [form, setForm] = useState<Partial<Deal>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<DealFilters>({});
  const [, setPresetStageId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Loss reason modal
  const [lossModalOpen, setLossModalOpen] = useState(false);
  const [lossDealId, setLossDealId] = useState<string | null>(null);
  const [lossReason, setLossReason] = useState("");
  const [lossNote, setLossNote] = useState("");

  // Batch selection
  const [selectedDeals, setSelectedDeals] = useState<Set<string>>(new Set());

  // Pipeline customization
  const [pipelineDialogOpen, setPipelineDialogOpen] = useState(false);
  const [editingStages, setEditingStages] = useState<EditingStage[]>([]);

  // Initialize selectedPipeline once pipelines load
  useEffect(() => {
    if (pipelines.length && !selectedPipeline) {
      const def = pipelines.find((p) => p.is_default) || pipelines[0];
      setSelectedPipeline(def.id);
    }
  }, [pipelines, selectedPipeline]);

  // Realtime subscription — invalidate cache on remote changes
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel("deals-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "deals", filter: `org_id=eq.${orgId}` }, () => {
        qc.invalidateQueries({ queryKey: dealsKeys.all(orgId) });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orgId, qc]);

  // useMemo porque este array é dependência do useEffect abaixo. Sem ele, um
  // array novo a cada render fazia o efeito reavaliar em todo render.
  const pipelineStages = useMemo(
    () => allStages.filter((s) => s.pipeline_id === selectedPipeline),
    [allStages, selectedPipeline],
  );

  // A tela distingue três situações que antes eram uma só.
  //
  // `selectedPipeline` nasce "" e só é preenchido por um useEffect depois de
  // usePipelines resolver, então `pipelineStages` é [] no primeiro render --
  // e o DealsKanban lê [] como "organização sem funil". Resultado: toda entrada
  // em /deals piscava "Nenhum funil configurado", e se a consulta falhasse a
  // mensagem ficava permanente, mandando o usuário configurar algo que já existe.
  const funilCarregando = stagesLoading || pipelinesLoading;
  const funilFalhou = stagesError || pipelinesError;
  const semFunil = !funilCarregando && !funilFalhou && pipelines.length === 0;

  // Open "new deal" sheet from URL param
  const shouldOpenNew = searchParams.get("action") === "new";
  useEffect(() => {
    if (shouldOpenNew && pipelineStages.length > 0) {
      openNew();
      searchParams.delete("action");
      setSearchParams(searchParams, { replace: true });
    }
  }, [shouldOpenNew, pipelineStages]);

  const openPipelineEditor = () => {
    // Cópia antes de ordenar: `.sort()` é IN PLACE, e `pipelineStages` é o
    // resultado de um useMemo -- é o mesmo array que alimenta as colunas do
    // kanban. Ordenar aqui reordenava a memoização por efeito colateral, de
    // dentro de um manipulador de clique.
    const current = [...pipelineStages]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ id: s.id, name: s.name, color: s.color || COR_PADRAO_DE_ETAPA, win_probability: Number(s.win_probability) || 0, order: s.order }));
    setEditingStages(current.length > 0 ? current : [{ name: "", color: COR_PADRAO_DE_ETAPA, win_probability: 50, order: 0 }]);
    setPipelineDialogOpen(true);
  };

  const handleSavePipeline = async () => {
    if (!orgId || !selectedPipeline) return;
    const currentStageIds = pipelineStages.map((s) => s.id);
    await savePipelineStages({ pipelineId: selectedPipeline, currentStageIds, editingStages });
    setPipelineDialogOpen(false);
    toast({ title: "Funil atualizado!" });
  };

  // Apply client-side filters to all deals (Kanban/Forecast)
  const filteredAllDeals = allDeals.filter((d) => {
    if (filters.ownerId && d.owner_id !== filters.ownerId) return false;
    if (filters.minValue && (Number(d.value) || 0) < filters.minValue) return false;
    if (filters.maxValue && (Number(d.value) || 0) > filters.maxValue) return false;
    if (filters.closeDateFrom && d.close_date && d.close_date < filters.closeDateFrom) return false;
    if (filters.closeDateTo && d.close_date && d.close_date > filters.closeDateTo) return false;
    const stageIds = pipelineStages.map((s) => s.id);
    if (d.stage_id && !stageIds.includes(d.stage_id) && d.status === "open") return false;
    return true;
  });

  const handleDragEnd = async (dealId: string, newStageId: string) => {
    await updateStage({ id: dealId, stageId: newStageId });
  };

  /**
   * Abre a gaveta em modo EDIÇÃO.
   *
   * O estado `editing` e o modo de edição da gaveta já existiam -- inclusive o
   * título "Editar Negócio" e o `handleSave` que faz update em vez de insert --
   * e NADA os acionava. Estava construído pela metade: dava para editar e não
   * havia por onde.
   *
   * `useCallback` pelo mesmo motivo de `abrirNegocio`: a prop desce até o card de
   * cada negócio, e arrastar faz o quadro renderizar continuamente. Uma
   * identidade nova a cada render obrigaria todos os cards a renderizar junto, e
   * o `memo` do card só pagaria a comparação sem pular nada.
   */
  const abrirEdicao = useCallback((d: DealWithRelations) => {
    setEditing(d);
    setPresetStageId(null);
    setForm({
      title: d.title,
      value: d.value,
      currency: d.currency,
      stage_id: d.stage_id,
      status: d.status,
      probability: d.probability,
      contact_id: d.contact_id,
      company_id: d.company_id,
      owner_id: d.owner_id,
      close_date: d.close_date,
    });
    setSheetOpen(true);
  }, []);

  const openNew = (stageId?: string) => {
    setEditing(null);
    setPresetStageId(stageId || null);
    setForm({
      title: "", value: 0, currency: "BRL",
      stage_id: stageId || pipelineStages[0]?.id,
      status: "open", probability: 0,
    });
    setSheetOpen(true);
  };

  const handleSave = async () => {
    if (!orgId || !form.title) return;
    try {
    if (editing) {
      await updateDeal({
        id: editing.id,
        deal: {
          title: form.title, value: Number(form.value) || 0, currency: form.currency,
          stage_id: form.stage_id, probability: Number(form.probability) || 0,
          close_date: form.close_date, contact_id: form.contact_id || null,
          company_id: form.company_id || null, owner_id: form.owner_id || null,
        },
      });
    } else {
      await createDeal({
        org_id: orgId, title: form.title!, value: Number(form.value) || 0,
        currency: form.currency || "BRL", stage_id: form.stage_id,
        probability: Number(form.probability) || 0, close_date: form.close_date,
        status: "open", owner_id: form.owner_id || user?.id,
        contact_id: form.contact_id || null, company_id: form.company_id || null,
      });
    }
    setSheetOpen(false);
    toast({ title: editing ? "Negócio atualizado" : "Negócio criado" });
    } catch (e: unknown) {
      toast({ title: "Erro ao salvar negócio", description: mensagemErro(e), variant: "destructive" });
    }
  };

  const markAsWon = async (dealId: string) => {
    try {
      await updateStatus({ id: dealId, status: "won" });
      toast({ title: "Negócio marcado como ganho! 🎉" });
    } catch (e: unknown) {
      toast({ title: "Erro ao atualizar negócio", description: mensagemErro(e), variant: "destructive" });
    }
  };

  const openLossModal = (dealId: string) => {
    setLossDealId(dealId);
    setLossReason("");
    setLossNote("");
    setLossModalOpen(true);
  };

  const confirmLoss = async () => {
    if (!lossDealId) return;
    const reason = lossNote ? `${lossReason}: ${lossNote}` : lossReason;
    try {
      await updateStatus({ id: lossDealId, status: "lost", lossReason: reason });
      setLossModalOpen(false);
      toast({ title: "Negócio marcado como perdido" });
    } catch (e: unknown) {
      toast({ title: "Erro ao atualizar negócio", description: mensagemErro(e), variant: "destructive" });
    }
  };

  const handleBatchAction = async (action: "won" | "lost" | "delete") => {
    const ids = Array.from(selectedDeals);
    try {
      await batchUpdate({ ids, action });
      setSelectedDeals(new Set());
      const messages = { won: "ganhos", lost: "perdidos", delete: "excluídos" };
      toast({ title: `${ids.length} negócios ${messages[action]}` });
    } catch (e: unknown) {
      toast({ title: "Erro na ação em lote", description: mensagemErro(e), variant: "destructive" });
    }
  };

  if (!orgId) return <SemOrganizacao />;

  const openDeals = filteredAllDeals.filter((d) => d.status === "open");
  const wonDeals  = filteredAllDeals.filter((d) => d.status === "won");
  const lostDeals = filteredAllDeals.filter((d) => d.status === "lost");
  const totalCount = viewMode === "list" ? listDealsResult.count : filteredAllDeals.length;

  return (
    <PageShell
      title="Negócios"
      contagem={{ valor: totalCount, unidade: "negócio no funil", plural: "negócios no funil" }}
      meta={
        listFetching && viewMode === "list" ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            atualizando
          </span>
        ) : undefined
      }
      actions={
        <>
          {/* Era um grupo de pílulas escrito à mão, o quarto do projeto, com
              medidas próprias e sem `aria-pressed` -- nenhuma das quatro cópias
              anunciava a seleção para leitor de tela. */}
          <SegmentedControl<ViewMode>
            rotuloGrupo="Visualização"
            valor={viewMode}
            onChange={setViewMode}
            opcoes={[
              { valor: "kanban", rotulo: "Kanban", icone: Kanban },
              { valor: "list", rotulo: "Lista", icone: List },
              { valor: "forecast", rotulo: "Previsão", icone: TrendingUp },
            ]}
          />
          {pipelines.length > 0 && (
            <Select value={selectedPipeline} onValueChange={setSelectedPipeline}>
              <SelectTrigger className="h-8 w-40 border-border text-xs" aria-label="Funil">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {isAdmin && (
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={openPipelineEditor} aria-label="Personalizar funil">
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-8" onClick={() => setShowFilters(!showFilters)} aria-label="Alternar filtros">
            <Filter className="mr-1 h-3 w-3" /><span className="hidden sm:inline">Filtro</span>
          </Button>
          <Button onClick={() => openNew()} size="sm" className="h-8 gap-1">
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Negócio</span>
          </Button>
        </>
      }
    >
      {showFilters && (
        <DealsFilters filters={filters} onFiltersChange={setFilters} members={members} />
      )}

      {/* Carregando, falhou e "não existe" pedem respostas diferentes. */}
      {viewMode === "kanban" && funilCarregando && (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-border py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {viewMode === "kanban" && funilFalhou && (
        <div className="rounded-lg border border-dashed border-destructive/40 py-16 text-center">
          <p className="font-medium">Não foi possível carregar o funil</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Seus negócios continuam salvos. Recarregue a página para tentar de novo.
          </p>
        </div>
      )}

      {viewMode === "kanban" && semFunil && (
        <div className="rounded-lg border border-dashed border-border py-20 text-center">
          <p className="text-muted-foreground">Nenhum funil configurado</p>
          <p className="text-sm text-muted-foreground">
            Vá em Configurações → Funis e etapas para criar
          </p>
        </div>
      )}

      {viewMode === "kanban" && !funilCarregando && !funilFalhou && !semFunil && (
        <DealsKanban
          deals={openDeals}
          wonDeals={wonDeals}
          lostDeals={lostDeals}
          stages={pipelineStages}
          onDragEnd={handleDragEnd}
          onDealClick={abrirNegocio}
          onContactClick={setContatoNoPainel}
          onAddDeal={openNew}
          onEditDeal={abrirEdicao}
          onMarkWon={markAsWon}
          onMarkLost={openLossModal}
        />
      )}

      {viewMode === "list" && (
        <>
          <DealsList
            deals={listDeals}
            stages={allStages}
            selectedDeals={selectedDeals}
            onSelectionChange={setSelectedDeals}
            onDealClick={abrirNegocio}
            onBatchAction={handleBatchAction}
            canDelete={isAdmin}
          />
          {listTotalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Página {listPage + 1} de {listTotalPages} · {listDealsResult.count} negócios
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={listPage === 0} onClick={() => setListPage(listPage - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={listPage >= listTotalPages - 1} onClick={() => setListPage(listPage + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {viewMode === "forecast" && (
        <DealsForecast deals={openDeals} stages={pipelineStages} />
      )}

      {/* Create/Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? "Editar Negócio" : "Novo Negócio"}</SheetTitle>
            <SheetDescription>{editing ? "Atualize os dados do negócio" : "Preencha os dados do novo negócio"}</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label>Título</Label>
              <Input value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Nome do negócio" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Valor</Label>
                <Input type="number" value={form.value ?? ""} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>Moeda</Label>
                <Select value={form.currency || "BRL"} onValueChange={(v) => setForm({ ...form, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BRL">BRL (R$)</SelectItem>
                    <SelectItem value="USD">USD ($)</SelectItem>
                    <SelectItem value="EUR">EUR (€)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Etapa</Label>
              <Select value={form.stage_id || ""} onValueChange={(v) => setForm({ ...form, stage_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {pipelineStages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Contato</Label>
              <Select value={form.contact_id || "none"} onValueChange={(v) => setForm({ ...form, contact_id: v === "none" ? null : v })}>
                <SelectTrigger><SelectValue placeholder="Selecionar contato" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {contacts.map((c) => <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Empresa</Label>
              <Select value={form.company_id || "none"} onValueChange={(v) => setForm({ ...form, company_id: v === "none" ? null : v })}>
                <SelectTrigger><SelectValue placeholder="Selecionar empresa" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma</SelectItem>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {isAdmin && (
              <div className="space-y-2">
                <Label>Responsável</Label>
                <Select value={form.owner_id || "none"} onValueChange={(v) => setForm({ ...form, owner_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="Selecionar responsável" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name || m.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Probabilidade (%)</Label>
                <Input type="number" min={0} max={100} value={form.probability ?? ""} onChange={(e) => setForm({ ...form, probability: Number(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>Fechamento</Label>
                <Input type="date" value={form.close_date || ""} onChange={(e) => setForm({ ...form, close_date: e.target.value })} />
              </div>
            </div>
            <Button onClick={handleSave} className="w-full">{editing ? "Salvar" : "Criar Negócio"}</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Loss Reason Modal */}
      <Dialog open={lossModalOpen} onOpenChange={setLossModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Motivo da Perda</DialogTitle>
            <DialogDescription>Por que este negócio foi perdido?</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Motivo</Label>
              <Select value={lossReason} onValueChange={setLossReason}>
                <SelectTrigger><SelectValue placeholder="Selecionar motivo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Preço">Preço muito alto</SelectItem>
                  <SelectItem value="Concorrência">Perdeu para concorrência</SelectItem>
                  <SelectItem value="Timing">Timing inadequado</SelectItem>
                  <SelectItem value="Budget">Sem orçamento</SelectItem>
                  <SelectItem value="Fit">Produto não atende</SelectItem>
                  <SelectItem value="Sem resposta">Sem resposta do cliente</SelectItem>
                  <SelectItem value="Outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Observação (opcional)</Label>
              <Textarea value={lossNote} onChange={(e) => setLossNote(e.target.value)} placeholder="Detalhes adicionais..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLossModalOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmLoss} disabled={!lossReason}>Confirmar Perda</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Customization Dialog */}
      <Dialog open={pipelineDialogOpen} onOpenChange={setPipelineDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Personalizar funil</DialogTitle>
            <DialogDescription>Edite as etapas do seu funil de vendas</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {/* A linha é compartilhada com Configurações. Eram dois editores
                e nenhum completo: aqui não dava para reordenar, lá não dava
                para renomear nem recolorir. */}
            {editingStages.map((stage, idx) => (
              <LinhaDeEtapa
                key={idx}
                etapa={stage}
                indice={idx}
                total={editingStages.length}
                onChange={(mudanca) =>
                  setEditingStages(editingStages.map((s, i) => (i === idx ? { ...s, ...mudanca } : s)))
                }
                onRemover={
                  editingStages.length > 1
                    ? () => setEditingStages(editingStages.filter((_, i) => i !== idx))
                    : undefined
                }
                onMover={(direcao) => {
                  const destino = direcao === "cima" ? idx - 1 : idx + 1;
                  if (destino < 0 || destino >= editingStages.length) return;
                  const arr = [...editingStages];
                  [arr[idx], arr[destino]] = [arr[destino], arr[idx]];
                  // `order` acompanha a posição: é o campo que o banco lê, e a
                  // etapa de entrada do funil é identificada pelo MENOR order.
                  setEditingStages(arr.map((s, i) => ({ ...s, order: i })));
                }}
              />
            ))}
            <Button variant="outline" size="sm"
              onClick={() => setEditingStages([...editingStages, { name: "", color: COR_PADRAO_DE_ETAPA, win_probability: 50, order: editingStages.length }])}>
              <Plus className="mr-1 h-3.5 w-3.5" />Adicionar etapa
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPipelineDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSavePipeline} disabled={savingPipeline || editingStages.some((s) => !s.name.trim())}>
              {savingPipeline && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Painel da pessoa, sem sair do quadro.
          `onUpdate` invalida negócios TAMBÉM: editar a pessoa muda o subtítulo
          dos cards, e o drawer escreve direto no supabase, fora do react-query --
          sem isto o card continuaria mostrando o nome antigo. */}
      <ContactDrawer
        contact={contatoNoPainel}
        onClose={() => setContatoNoPainel(null)}
        onUpdate={() => {
          qc.invalidateQueries({ queryKey: ["contacts"] });
          qc.invalidateQueries({ queryKey: ["deals"] });
        }}
        companies={companies}
      />
    </PageShell>
  );
}
