import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useLeads, useUpdateContactsStatus, useUpdateContactOwner } from "@/hooks/queries/useContacts";
import { usePipelines } from "@/hooks/queries/usePipelines";
import { useMembers } from "@/hooks/queries/useMembers";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { contactsKeys } from "@/hooks/queries/useContacts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  UserPlus, Phone, Building2, FileText, Zap, Trash2, CheckCircle2,
  Clock, Globe, RefreshCw, Eye, XCircle, MessageCircle, Calendar,
  Briefcase, AlignLeft, Mail, UserCog,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CADASTRO_FIELDS, LIFECYCLE_LABELS, LIFECYCLE_COLORS, type LifecycleStage,
} from "@/lib/contact-options";

type Lead = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  created_at: string;
  owner_id: string | null;
  lifecycle_stage: LifecycleStage;
  metadata: Record<string, string> | null;
  // Vem do embed `companies:companies(name)` em listLeads — não existe no tipo
  // gerado da tabela, por isso opcional.
  companies?: { name: string } | null;
};

const sourceLabel = (src: string) => {
  const map: Record<string, string> = {
    site_vionex: "Site Vionex",
    landing_page: "Landing Page",
    google_forms_vionex: "Google Forms",
    landing_page_teste: "Teste",
    cadastro_likawave: "Cadastro Likawave",
  };
  return map[src] || src || "—";
};


export default function Leads() {
  const { orgId } = useOrg();
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: leads = [], isLoading: loading, refetch } = useLeads();
  const { data: pipelines = [] } = usePipelines();
  const { data: members = [] } = useMembers();
  const { mutate: assignOwner } = useUpdateContactOwner();

  const ownerName = (ownerId: string | null) => {
    if (!ownerId) return null;
    const m = members.find((x) => x.id === ownerId);
    return m?.name || m?.email || "Desconhecido";
  };

  const [viewing, setViewing] = useState<Lead | null>(null);
  const [qualifying, setQualifying] = useState<Lead | null>(null);
  const [selectedPipeline, setSelectedPipeline] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { mutateAsync: updateStatus } = useUpdateContactsStatus();

  useEffect(() => {
    if (pipelines.length > 0 && !selectedPipeline) {
      setSelectedPipeline(pipelines[0].id);
    }
  }, [pipelines, selectedPipeline]);

  const deleteLeadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contacts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      toast({ title: "Lead removido" });
      if (viewing?.id === id) setViewing(null);
      if (orgId) qc.invalidateQueries({ queryKey: contactsKeys.all(orgId) });
    },
    onError: (e: any) => {
      toast({ title: "Erro ao remover lead", description: e.message, variant: "destructive" });
    },
  });

  const disqualifyMutation = useMutation({
    mutationFn: async (lead: Lead) => {
      const { error } = await supabase.from("contacts").update({ status: "churned" }).eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Lead desqualificado" });
      setViewing(null);
      if (orgId) qc.invalidateQueries({ queryKey: contactsKeys.all(orgId) });
    },
    onError: (e: any) => {
      toast({ title: "Erro ao desqualificar", description: e.message, variant: "destructive" });
    },
  });

  const qualifyMutation = useMutation({
    mutationFn: async ({ lead, pipelineId }: { lead: Lead; pipelineId: string }) => {
      if (!orgId) throw new Error("No org");
      // RPC atômica: status → prospect + criação do negócio na mesma transação
      const { error } = await supabase.rpc("qualify_lead", {
        p_contact_id: lead.id,
        p_pipeline_id: pipelineId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Lead qualificado!", description: "Movido para Contatos e negócio criado." });
      setQualifying(null);
      // Invalida TODAS as queries de contatos (lista de leads E lista de contatos)
      if (orgId) qc.invalidateQueries({ queryKey: contactsKeys.all(orgId) });
      qc.invalidateQueries({ queryKey: ["deals"] });
      navigate("/deals");
    },
    onError: (e: any) => {
      toast({ title: "Erro ao qualificar", description: e.message, variant: "destructive" });
    },
  });

  const deleteLead = (id: string) => deleteLeadMutation.mutate(id);
  const disqualify = (lead: Lead) => disqualifyMutation.mutate(lead);

  const openQualify = (lead: Lead) => {
    setViewing(null);
    setQualifying(lead);
    if (!selectedPipeline && pipelines.length > 0) {
      setSelectedPipeline(pipelines[0].id);
    }
  };

  const qualify = () => {
    if (!qualifying || !selectedPipeline) return;
    qualifyMutation.mutate({ lead: qualifying, pipelineId: selectedPipeline });
  };

  // ── Seleção múltipla + aprovar/recusar em lote ──
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const allSelected = leads.length > 0 && leads.every((l) => selected.has(l.id));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)));
  };
  const batchUpdate = async (status: "prospect" | "churned") => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    try {
      // Aprovar = vira prospect e aparece em Contatos; Recusar = churned.
      // Não cria negócio — para isso use "Qualificar" num lead específico.
      await updateStatus({ ids, status });
      setSelected(new Set());
      toast({
        title: status === "prospect"
          ? `${ids.length} lead(s) aprovado(s)`
          : `${ids.length} lead(s) recusado(s)`,
        description: status === "prospect"
          ? "Movidos para Contatos como prospect."
          : "Marcados como recusados.",
      });
    } catch (e: any) {
      toast({ title: "Erro na ação em lote", description: e.message, variant: "destructive" });
    }
  };

  const fullName = (lead: Lead) =>
    [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Sem nome";

  const meta = (lead: Lead, key: string) =>
    (lead.metadata as any)?.[key] || "";

  const whatsappLink = (phone: string) => {
    const clean = phone.replace(/\D/g, "");
    return `https://wa.me/${clean.startsWith("55") ? clean : "55" + clean}`;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon={UserPlus}
        kicker="Captação"
        title="Leads"
        description={`${leads.length} lead${leads.length !== 1 ? "s" : ""} aguardando qualificação`}
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Atualizar
          </Button>
        }
      />

      {/* Barra de ações em lote */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-2">
          <span className="text-sm font-medium">{selected.size} selecionado(s)</span>
          <Button size="sm" className="h-8" onClick={() => batchUpdate("prospect")}>
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Aprovar
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-destructive hover:text-destructive hover:bg-destructive/5" onClick={() => batchUpdate("churned")}>
            <XCircle className="mr-1.5 h-3.5 w-3.5" />Recusar
          </Button>
          <Button size="sm" variant="ghost" className="h-8 ml-auto" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          Carregando leads...
        </div>
      ) : leads.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <UserPlus className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="font-heading font-semibold text-base">Nenhum lead ainda</p>
              <p className="text-sm text-muted-foreground mt-1">
                Quando alguém preencher o formulário em vionex.med.br, o lead aparece aqui automaticamente.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          <div className="grid grid-cols-[auto_1.8fr_1.2fr_1.2fr_1.1fr_1.4fr_1fr_0.9fr_auto] gap-3 px-4 py-2.5 bg-muted/50 border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground items-center">
            <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Selecionar todos" />
            <span>Nome</span>
            <span className="flex items-center gap-1"><Phone className="h-3 w-3" />Telefone</span>
            <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />Empresa</span>
            <span className="flex items-center gap-1"><FileText className="h-3 w-3" />Ciclo de vida</span>
            <span className="flex items-center gap-1"><UserCog className="h-3 w-3" />Responsável</span>
            <span className="flex items-center gap-1"><Globe className="h-3 w-3" />Origem</span>
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Recebido</span>
            <span>Ações</span>
          </div>

          {leads.map((lead, i) => (
            <div
              key={lead.id}
              className={`grid grid-cols-[auto_1.8fr_1.2fr_1.2fr_1.1fr_1.4fr_1fr_0.9fr_auto] gap-3 px-4 py-3 items-center text-sm border-b border-border last:border-0 hover:bg-muted/30 transition-colors ${selected.has(lead.id) ? "bg-primary/5" : i % 2 !== 0 ? "bg-muted/10" : ""}`}
            >
              <Checkbox checked={selected.has(lead.id)} onCheckedChange={() => toggleOne(lead.id)} aria-label={`Selecionar ${fullName(lead as Lead)}`} />
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                  {(lead.first_name || "?").charAt(0).toUpperCase()}
                </div>
                <span className="font-medium truncate">{fullName(lead as Lead)}</span>
              </div>
              <span className="text-muted-foreground font-mono text-xs">{lead.phone || "—"}</span>
              <span className="text-muted-foreground truncate">{(lead as Lead).companies?.name || meta(lead as Lead, "company") || "—"}</span>
              {/* Estágio do ciclo de vida — antes não existia: /leads mostrava
                  tudo como "Lead" sem distinguir quem já foi abordado. */}
              <span className="flex items-center gap-1.5 text-xs">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: LIFECYCLE_COLORS[(lead as Lead).lifecycle_stage] }}
                />
                <span className="truncate">{LIFECYCLE_LABELS[(lead as Lead).lifecycle_stage]}</span>
              </span>
              {/* Responsável — atribuível pelo admin. Sem dono, a RLS esconde o
                  lead de todo vendedor, então isto não é enfeite. */}
              {isAdmin ? (
                <Select
                  value={(lead as Lead).owner_id ?? "none"}
                  onValueChange={(v) => assignOwner({ id: lead.id, ownerId: v === "none" ? null : v })}
                >
                  <SelectTrigger className="h-7 text-[11px]" aria-label={`Responsável por ${fullName(lead as Lead)}`}>
                    <SelectValue placeholder="Sem responsável" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem responsável</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name || m.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="truncate text-xs text-muted-foreground">
                  {ownerName((lead as Lead).owner_id) ?? "—"}
                </span>
              )}
              <Badge variant="outline" className="text-[10px] font-medium w-fit">{sourceLabel(meta(lead as Lead, "source"))}</Badge>
              <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                {formatDistanceToNow(new Date(lead.created_at), { locale: ptBR, addSuffix: true })}
              </span>
              <div className="flex items-center gap-1.5">
                <Button size="icon" variant="outline" className="h-7 w-7" title="Ver detalhes" onClick={() => setViewing(lead as Lead)}>
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="default" className="h-7 text-[11px] px-2.5" onClick={() => openQualify(lead as Lead)}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                  Qualificar
                </Button>
                {isAdmin && (
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => deleteLead(lead.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Lead Detail Sheet ── */}
      <Sheet open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {viewing && (
            <>
              <SheetHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary text-xl font-bold">
                    {(viewing.first_name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <SheetTitle className="font-heading text-lg">{fullName(viewing)}</SheetTitle>
                    <Badge variant="outline" className="text-[10px] mt-1">Lead</Badge>
                  </div>
                </div>
              </SheetHeader>

              <div className="space-y-4 mt-2">
                {/* Info cards */}
                <div className="space-y-3">
                  <div className="flex items-start gap-3 rounded-md border border-border p-3">
                    <Phone className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Telefone / WhatsApp</p>
                      {viewing.phone ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{viewing.phone}</span>
                          <a
                            href={whatsappLink(viewing.phone)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[11px] text-green-600 hover:underline"
                          >
                            <MessageCircle className="h-3 w-3" />
                            WhatsApp
                          </a>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Não informado</span>
                      )}
                    </div>
                  </div>

                  {viewing.email && (
                    <div className="flex items-start gap-3 rounded-md border border-border p-3">
                      <Mail className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">E-mail</p>
                        <a href={`mailto:${viewing.email}`} className="text-sm text-primary hover:underline break-all">{viewing.email}</a>
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-3 rounded-md border border-border p-3">
                    <Briefcase className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Especialidade / Empresa</p>
                      <span className="text-sm">{viewing.title || (viewing.companies as any)?.name || meta(viewing, "company") || "Não informado"}</span>
                    </div>
                  </div>

                  {meta(viewing, "notes") && (
                    <div className="flex items-start gap-3 rounded-md border border-border p-3">
                      <AlignLeft className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Observações</p>
                        <span className="text-sm leading-relaxed whitespace-pre-line">{meta(viewing, "notes")}</span>
                      </div>
                    </div>
                  )}

                  {/* Dados estruturados do cadastro (ex.: formulário Likawave) */}
                  {CADASTRO_FIELDS.some((f) => meta(viewing, f.key)) && (
                    <div className="rounded-md border border-border p-3 space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Dados do cadastro</p>
                      <div className="grid grid-cols-1 gap-y-2">
                        {CADASTRO_FIELDS.filter((f) => meta(viewing, f.key)).map((f) => (
                          <div key={f.key} className="flex items-start justify-between gap-3 text-sm">
                            <span className="text-muted-foreground shrink-0">{f.label}</span>
                            <span className="text-right font-medium">{meta(viewing, f.key)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-start gap-3 rounded-md border border-border p-3">
                      <Globe className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Origem</p>
                        <span className="text-sm">{sourceLabel(meta(viewing, "source"))}</span>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 rounded-md border border-border p-3">
                      <Calendar className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Recebido em</p>
                        <span className="text-sm">{format(new Date(viewing.created_at), "dd/MM/yyyy HH:mm")}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Actions */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ações</p>
                  <Button className="w-full" onClick={() => openQualify(viewing)}>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Qualificar → criar negócio
                  </Button>
                  <Button variant="outline" className="w-full text-destructive hover:text-destructive hover:bg-destructive/5" onClick={() => disqualify(viewing)}>
                    <XCircle className="h-4 w-4 mr-2" />
                    Desqualificar
                  </Button>
                  {isAdmin && (
                    <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => deleteLead(viewing.id)}>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Excluir lead
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Qualify Modal ── */}
      <Dialog open={!!qualifying} onOpenChange={(o) => !o && setQualifying(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Qualificar Lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <p className="font-medium">{qualifying && fullName(qualifying)}</p>
              {qualifying?.phone && (
                <p className="text-muted-foreground text-xs mt-0.5">{qualifying.phone}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Adicionar ao funil
              </label>
              {pipelines.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum funil encontrado. Crie um em Configurações → Funis e etapas.
                </p>
              ) : (
                <Select value={selectedPipeline} onValueChange={setSelectedPipeline}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o funil" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              O lead passa para <strong>Em negociação</strong> e o negócio dele avança para a etapa seguinte à de entrada.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQualifying(null)}>Cancelar</Button>
            <Button onClick={qualify} disabled={qualifyMutation.isPending || !selectedPipeline}>
              <Zap className="h-3.5 w-3.5 mr-1.5" />
              {qualifyMutation.isPending ? "Qualificando..." : "Qualificar e criar negócio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
