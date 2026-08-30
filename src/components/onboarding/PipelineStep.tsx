import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, X, Rocket, Building2, Pencil, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { OnboardingStepProps } from "./types";

const TEMPLATES = {
  simple: {
    icon: Rocket,
    label: "Vendas Simples",
    desc: "4 stages",
    stages: ["Prospecção", "Contato feito", "Proposta", "Fechamento"],
  },
  b2b: {
    icon: Building2,
    label: "B2B Completo",
    desc: "6 stages",
    stages: ["Lead", "Qualificação", "Demo", "Proposta", "Negociação", "Fechamento"],
    default: true,
  },
  custom: {
    icon: Pencil,
    label: "Personalizado",
    desc: "Você define as etapas",
    stages: [] as string[],
  },
};

const COLORS = ["#6366f1", "#8b5cf6", "#f59e0b", "#ef4444", "#22c55e", "#06b6d4", "#ec4899", "#f97316"];
const PROBS = [10, 25, 40, 55, 70, 80, 90, 95];

type TemplateKey = keyof typeof TEMPLATES;

export function PipelineStep({ orgId, setCanContinue, onNext: _onNext, setStepData, stepData }: OnboardingStepProps) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<TemplateKey>("b2b");
  const [customStages, setCustomStages] = useState<string[]>([]);
  const [newStage, setNewStage] = useState("");
  const [loading, setLoading] = useState(false);
  const [alreadyCreated, setAlreadyCreated] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let active = true;

    void (async () => {
      const { data: pipeline } = await supabase
        .from("pipelines")
        .select("id, name, is_default, created_at")
        .eq("org_id", orgId)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!active || !pipeline) return;

      const { count } = await supabase
        .from("pipeline_stages")
        .select("id", { count: "exact", head: true })
        .eq("pipeline_id", pipeline.id);

      if (!active) return;

      setAlreadyCreated(true);
      setCanContinue(true);
      setStepData("pipelineName", pipeline.name);
      setStepData("stageCount", count ?? 0);
    })();

    return () => {
      active = false;
    };
  }, [orgId, setCanContinue, setStepData]);

  const stages = selected === "custom" ? customStages : TEMPLATES[selected].stages;
  const isValid = stages.length >= 2;

  useEffect(() => {
    if (!alreadyCreated) setCanContinue(false);
  }, [alreadyCreated, setCanContinue]);

  const addCustomStage = () => {
    const s = newStage.trim();
    if (!s || customStages.length >= 8 || customStages.includes(s)) return;
    setCustomStages([...customStages, s]);
    setNewStage("");
  };

  const removeCustomStage = (idx: number) => {
    setCustomStages(customStages.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (!orgId || !isValid || loading) return;
    setLoading(true);
    try {
      const currency = stepData.currency || "BRL";
      await supabase.from("pipelines").update({ is_default: false } as any).eq("org_id", orgId);
      const { data: pipeline, error } = await supabase
        .from("pipelines")
        .insert({ name: TEMPLATES[selected].label, org_id: orgId, is_default: true, currency })
        .select("id")
        .single();
      if (error || !pipeline) throw error || new Error("Falha ao criar pipeline");

      const stageInserts = stages.map((name, i) => ({
        name,
        pipeline_id: pipeline.id,
        org_id: orgId,
        order: i,
        color: COLORS[i % COLORS.length],
        win_probability: PROBS[Math.min(i, PROBS.length - 1)],
      }));
      const { error: stagesError } = await supabase.from("pipeline_stages").insert(stageInserts);
      if (stagesError) throw stagesError;

      setStepData("pipelineName", TEMPLATES[selected].label);
      setStepData("stageCount", stages.length);
      setAlreadyCreated(true);
      setCanContinue(true);
    } catch (err: any) {
      toast({ title: "Erro ao criar pipeline", description: err?.message, variant: "destructive" });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="vx-titulo-tela">Como é o seu processo de vendas?</h3>
        <p className="vx-subtitulo-tela mt-1">
          {alreadyCreated ? "Funil configurado com sucesso." : "Escolha um modelo ou crie do zero. Você pode editar as etapas a qualquer momento."}
        </p>
      </div>

      {!alreadyCreated && (
        <>
          <div className="grid gap-3">
            {(Object.entries(TEMPLATES) as [TemplateKey, typeof TEMPLATES[TemplateKey]][]).map(([key, tpl]) => (
              <button
                key={key}
                onClick={() => setSelected(key)}
                className={`flex items-start gap-3 rounded-lg border-2 p-4 text-left transition-colors ${
                  selected === key ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                }`}
              >
                <tpl.icon className={`h-5 w-5 mt-0.5 ${selected === key ? "text-primary" : "text-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{tpl.label}</span>
                    {(tpl as any).default && <span className="text-xs text-primary">← padrão</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{tpl.desc}</p>
                  {key !== "custom" && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {tpl.stages.join(" → ")}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>

          {selected === "custom" && (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex gap-2">
                <Input
                  value={newStage}
                  onChange={(e) => setNewStage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomStage())}
                  placeholder="Ex: Prospecção, Qualificação, Proposta..."
                  maxLength={30}
                />
                <Button size="icon" variant="outline" onClick={addCustomStage} disabled={customStages.length >= 8}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {customStages.map((s, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
                    {s}
                    <button onClick={() => removeCustomStage(i)} className="hover:text-destructive ml-1"><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
              {customStages.length > 0 && customStages.length < 2 && (
                <p className="text-xs text-destructive">Mínimo 2 stages necessários</p>
              )}
              {customStages.length >= 8 && (
                <p className="text-xs text-muted-foreground">Máximo de 8 stages atingido</p>
              )}
            </div>
          )}
        </>
      )}

      <button
        onClick={alreadyCreated ? undefined : handleSubmit}
        disabled={alreadyCreated || !isValid || loading || !orgId}
        className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
          alreadyCreated
            ? "bg-muted text-muted-foreground cursor-default"
            : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        }`}
      >
        {loading ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Criando funil...</>
        ) : alreadyCreated ? (
          <><Check className="h-4 w-4" /> Salvo com sucesso</>
        ) : (
          "Criar pipeline e continuar"
        )}
      </button>
    </div>
  );
}
