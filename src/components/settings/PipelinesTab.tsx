import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Database } from "@/integrations/supabase/types";
import { LinhaDeEtapa } from "@/components/crm/LinhaDeEtapa";

type PipelineStage = Database["public"]["Tables"]["pipeline_stages"]["Row"];

export function PipelinesTab({ orgId }: { orgId: string | null }) {
  const { toast } = useToast();
  const [pipelines, setPipelines] = useState<Database["public"]["Tables"]["pipelines"]["Row"][]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState("");
  const [newPipelineName, setNewPipelineName] = useState("");
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState("#3b82f6");
  const [newStageProb, setNewStageProb] = useState("0");
  // Loss reasons
  const [lossReasons, setLossReasons] = useState<any[]>([]);
  const [newLossReason, setNewLossReason] = useState("");

  const fetchAll = useCallback(async () => {
    if (!orgId) return;
    const [{ data: p }, { data: s }, { data: lr }] = await Promise.all([
      supabase.from("pipelines").select("*").eq("org_id", orgId),
      supabase.from("pipeline_stages").select("*").eq("org_id", orgId).order("order"),
      supabase.from("loss_reasons").select("*").eq("org_id", orgId) as any,
    ]);
    setPipelines(p || []);
    setStages(s || []);
    setLossReasons(lr || []);
    if (p?.length && !selectedPipeline) setSelectedPipeline(p[0].id);
  }, [orgId, selectedPipeline]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const createPipeline = async () => {
    if (!orgId || !newPipelineName) return;
    const { data } = await supabase.from("pipelines").insert({ org_id: orgId, name: newPipelineName, is_default: pipelines.length === 0 }).select().single();
    setNewPipelineName("");
    if (data) setSelectedPipeline(data.id);
    fetchAll();
    toast({ title: "Funil criado" });
  };

  const deletePipeline = async (id: string) => {
    await supabase.from("pipeline_stages").delete().eq("pipeline_id", id);
    await supabase.from("pipelines").delete().eq("id", id);
    setSelectedPipeline("");
    fetchAll();
    toast({ title: "Funil excluído" });
  };

  const addStage = async () => {
    if (!orgId || !selectedPipeline || !newStageName) return;
    const maxOrder = stages.filter((s) => s.pipeline_id === selectedPipeline).reduce((max, s) => Math.max(max, s.order), -1);
    await supabase.from("pipeline_stages").insert({
      org_id: orgId, pipeline_id: selectedPipeline, name: newStageName,
      order: maxOrder + 1, color: newStageColor, win_probability: parseFloat(newStageProb) || 0,
    });
    setNewStageName("");
    fetchAll();
    toast({ title: "Etapa adicionada" });
  };

  const deleteStage = async (id: string) => {
    await supabase.from("pipeline_stages").delete().eq("id", id);
    fetchAll();
    toast({ title: "Etapa excluída" });
  };

  /**
   * Renomear, recolorir e mudar a probabilidade -- que esta tela NÃO permitia.
   * Só mostrava o valor e um botão de apagar; para corrigir um nome, era
   * preciso apagar a etapa e criar de novo, perdendo os negócios nela.
   *
   * Grava no `blur`, não a cada tecla: um `update` por caractere digitado é
   * uma consulta por caractere.
   */
  const salvarEtapa = async (id: string, mudanca: Partial<{ name: string; color: string; win_probability: number }>) => {
    await supabase.from("pipeline_stages").update(mudanca).eq("id", id);
    fetchAll();
  };

  const moveStage = async (stageId: string, direction: "up" | "down") => {
    const pStages = stages.filter((s) => s.pipeline_id === selectedPipeline).sort((a, b) => a.order - b.order);
    const idx = pStages.findIndex((s) => s.id === stageId);
    if ((direction === "up" && idx === 0) || (direction === "down" && idx === pStages.length - 1)) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    await Promise.all([
      supabase.from("pipeline_stages").update({ order: pStages[swapIdx].order }).eq("id", pStages[idx].id),
      supabase.from("pipeline_stages").update({ order: pStages[idx].order }).eq("id", pStages[swapIdx].id),
    ]);
    fetchAll();
  };

  const addLossReason = async () => {
    if (!orgId || !newLossReason) return;
    await supabase.from("loss_reasons").insert({ org_id: orgId, label: newLossReason } as any);
    setNewLossReason("");
    fetchAll();
    toast({ title: "Razão de perda adicionada" });
  };

  const deleteLossReason = async (id: string) => {
    await supabase.from("loss_reasons").delete().eq("id", id);
    fetchAll();
  };

  // Edições ainda não gravadas, por id de etapa. Sem isto, cada tecla digitada
  // no nome seria um UPDATE.
  const [rascunho, setRascunho] = useState<Record<string, Partial<{ name: string; color: string; win_probability: number }>>>({});

  const pipelineStages = stages.filter((s) => s.pipeline_id === selectedPipeline).sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Funis e etapas</CardTitle>
          <CardDescription className="text-[10px]">Gerencie seus funis de venda e as etapas de cada um</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Nome do funil" value={newPipelineName} onChange={(e) => setNewPipelineName(e.target.value)} className="h-8 text-xs" />
            <Button size="sm" className="h-8 text-xs" onClick={createPipeline}><Plus className="mr-1 h-3 w-3" />Criar</Button>
          </div>
          {pipelines.length > 0 && (
            <div className="flex gap-2">
              <Select value={selectedPipeline} onValueChange={setSelectedPipeline}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {selectedPipeline && (
                <Button variant="destructive" size="sm" className="h-8 text-[10px]" onClick={() => deletePipeline(selectedPipeline)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedPipeline && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Etapas</CardTitle>
            {/* Dizia "Arraste para reordenar" e não havia arraste nenhum. */}
            <CardDescription className="text-[10px]">Configure as etapas do funil selecionado. Use as setas para reordenar.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Nome" value={newStageName} onChange={(e) => setNewStageName(e.target.value)} className="h-8 text-xs flex-1" />
              <Input type="color" value={newStageColor} onChange={(e) => setNewStageColor(e.target.value)} className="w-10 h-8 p-0.5" />
              <Input type="number" placeholder="Prob %" value={newStageProb} onChange={(e) => setNewStageProb(e.target.value)} className="h-8 text-xs w-20" min="0" max="100" />
              <Button size="sm" className="h-8" onClick={addStage}><Plus className="h-3 w-3" /></Button>
            </div>
            <div className="space-y-1">
              {pipelineStages.map((s, i) => (
                <LinhaDeEtapa
                  key={s.id}
                  etapa={{
                    id: s.id,
                    name: rascunho[s.id]?.name ?? s.name,
                    color: rascunho[s.id]?.color ?? s.color ?? "#94a3b8",
                    win_probability: rascunho[s.id]?.win_probability ?? (Number(s.win_probability) || 0),
                  }}
                  indice={i}
                  total={pipelineStages.length}
                  // O rascunho existe para que digitar não dispare um `update`
                  // por caractere. A gravação acontece ao sair do campo.
                  onChange={(mudanca) =>
                    setRascunho((r) => ({ ...r, [s.id]: { ...r[s.id], ...mudanca } }))
                  }
                  onSalvar={() => {
                    const pendente = rascunho[s.id];
                    if (!pendente) return;
                    setRascunho((r) => {
                      const { [s.id]: _, ...resto } = r;
                      return resto;
                    });
                    salvarEtapa(s.id, pendente);
                  }}
                  onRemover={() => deleteStage(s.id)}
                  onMover={(direcao) => moveStage(s.id, direcao === "cima" ? "up" : "down")}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Razões de Perda</CardTitle>
          <CardDescription className="text-[10px]">Motivos customizáveis quando um negócio é marcado como perdido</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Ex: Preço alto" value={newLossReason} onChange={(e) => setNewLossReason(e.target.value)} className="h-8 text-xs flex-1" />
            <Button size="sm" className="h-8" onClick={addLossReason}><Plus className="h-3 w-3" /></Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {lossReasons.map((lr: any) => (
              <Badge key={lr.id} variant="secondary" className="text-[10px] gap-1">
                {lr.label}
                <button onClick={() => deleteLossReason(lr.id)} className="hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
