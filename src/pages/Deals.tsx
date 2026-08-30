import { useState, useMemo, useEffect } from "react";
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
import { Kanban, List, TrendingUp, Plus, Filter, Settings2, Trash2, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
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

  // Enrich deals with owner profile (client-side join)
  const allDeals = useMemo(
    () => allDealsResult.data.map((d) => ({ ...d, owner: members.find((m) => m.id === d.owner_id) ?? null })),
    [allDealsResult.data, members]
  );
  const listDeals = useMemo(
    () => listDealsResult.data.map((d) => ({ ...d, owner: members.find((m) => m.id === d.owner_id) ?? null })),
    [listDealsResult.data, members]
  );
  // Painel da pessoa. O contato vem do embed do próprio negócio, então abrir o
  // painel não custa consulta nenhuma.
  const [contatoNoPainel, setContatoNoPainel] = useState<ContactRow | null>(null);
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
    const current = pipelineStages
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ id: s.id, name: s.name, color: s.color || "#94a3b8", win_probability: Number(s.win_probability) || 0, order: s.order }));
    setEditingStages(current.length > 0 ? current : [{ name: "", color: "#94a3b8", win_probability: 50, order: 0 }]);
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

  if (!orgId) {
    return <div className="py-20 text-center text-muted-foreground">Crie uma organização em Configurações primeiro.</div>;
  }

  const openDeals = filteredAllDeals.filter((d) => d.status === "open");
  const wonDeals  = filteredAllDeals.filter((d) => d.status === "won");
  const lostDeals = filteredAllDeals.filter((d) => d.status === "lost");
  const totalCount = viewMode === "list" ? listDealsResult.count : filteredAllDeals.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">Negócios</h1>
          <div className="flex rounded-md border border-border bg-muted/50 p-0.5">
            {[
              { mode: "kanban" as const, icon: Kanban, label: "Kanban" },
              { mode: "list" as const, icon: List, label: "Lista" },
              { mode: "forecast" as const, icon: TrendingUp, label: "Previsão" },
            ].map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                aria-label={`Visualização ${label}`}
                className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                  viewMode === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /><span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
          <Button onClick={() => openNew()} size="sm" className="gap-1">
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Negócio</span>
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {totalCount} {totalCount === 1 ? "negócio" : "negócios"}
            {viewMode === "list" && listFetching && <Loader2 className="inline ml-1.5 h-3 w-3 animate-spin" />}
          </span>
          {pipelines.length > 0 && (
            <Select value={selectedPipeline} onValueChange={setSelectedPipeline}>
              <SelectTrigger className="h-8 w-40 text-xs border-border"><SelectValue /></SelectTrigger>
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
        </div>
      </div>

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
          onDealClick={(d) => navigate(`/deals/${d.id}`)}
          onContactClick={setContatoNoPainel}
          onAddDeal={openNew}
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
            onDealClick={(d) => navigate(`/deals/${d.id}`)}
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
            {editingStages.map((stage, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="color"
                  value={stage.color}
                  onChange={(e) => setEditingStages(editingStages.map((s, i) => i === idx ? { ...s, color: e.target.value } : s))}
                  className="h-8 w-8 cursor-pointer rounded border-0 shrink-0"
                  aria-label={`Cor da etapa ${idx + 1}`}
                />
                <Input
                  value={stage.name}
                  onChange={(e) => setEditingStages(editingStages.map((s, i) => i === idx ? { ...s, name: e.target.value } : s))}
                  placeholder={`Etapa ${idx + 1}`}
                  className="flex-1"
                />
                <div className="flex items-center gap-1 shrink-0">
                  <Input
                    type="number" min={0} max={100}
                    value={stage.win_probability}
                    onChange={(e) => setEditingStages(editingStages.map((s, i) => i === idx ? { ...s, win_probability: Number(e.target.value) } : s))}
                    className="w-16 text-xs text-center"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                {editingStages.length > 1 && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                    onClick={() => setEditingStages(editingStages.filter((_, i) => i !== idx))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm"
              onClick={() => setEditingStages([...editingStages, { name: "", color: "#94a3b8", win_probability: 50, order: editingStages.length }])}>
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
    </div>
  );
}
