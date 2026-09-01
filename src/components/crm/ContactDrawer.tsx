import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/contexts/AuthContext";
import { Sheet, SheetContent} from "@/components/ui/sheet";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Edit2, X, Phone, Mail,
  Building2, Briefcase, Save, MapPin, Star, MessageCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  AREAS_ATUACAO, PAISES, CADASTRO_FIELDS, getContactOrigin,
  LIFECYCLE_LABELS, type LifecycleStage,
} from "@/lib/contact-options";
import {
  ATIVIDADE_ICONE, ATIVIDADE_ROTULO, ATIVIDADE_JA_ACONTECEU,
} from "@/lib/atividade-tipos";
import type { Database } from "@/integrations/supabase/types";
import { LoadingState, ErrorState } from "@/components/layout/EstadoDaLista";
import { PageTabs } from "@/components/layout/PageTabs";
import { Activity, Handshake, LayoutList, StickyNote } from "lucide-react";
import { formatarData, formatarDataCurta, formatarDataHoraCurta, formatarMoeda } from "@/lib/formato";
import { SeloDeNegocio } from "@/components/crm/SeloDeNegocio";

type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type Company = Database["public"]["Tables"]["companies"]["Row"];
type Deal = Database["public"]["Tables"]["deals"]["Row"];
type Activity = Database["public"]["Tables"]["activities"]["Row"];
type ActivityType = Database["public"]["Enums"]["activity_type"];
type Stage = Database["public"]["Tables"]["pipeline_stages"]["Row"];

/**
 * O ciclo de vida substituiu o `status` nesta gaveta, e não era só rótulo.
 *
 * O Select escrevia a coluna LEGADA, com quatro valores para seis estágios. Dois
 * defeitos concretos vinham disso:
 *
 *  - alguém em 'opportunity' (negócio em andamento) aparecia como "Prospect", e
 *    escolher "Lead" fazia o trigger REBAIXAR o ciclo de vida -- quebrando o
 *    invariante "só avança" e devolvendo uma negociação viva para a fila;
 *  - o valor padrão do Select era "prospect", então salvar um contato sem status
 *    definido o marcava como qualificado sem ninguém ter qualificado.
 */
const LIFECYCLE_BADGE: Record<LifecycleStage, string> = {
  lead: "bg-muted text-muted-foreground",
  contacted: "bg-primary/10 text-primary",
  qualified: "bg-primary/10 text-primary",
  opportunity: "bg-warning/10 text-warning",
  customer: "bg-success/10 text-success",
  disqualified: "bg-destructive/10 text-destructive",
};
// Ícones e rótulos vêm de lib/atividade-tipos.ts, que é a fonte única.
const activityIcons = ATIVIDADE_ICONE;
const activityLabels = ATIVIDADE_ROTULO;


interface ContactDrawerProps {
  contact: Contact | null;
  onClose: () => void;
  onUpdate: () => void;
  companies: Company[];
}

/**
 * Placeholder das abas de relacionados: carregando, falhou, ou vazio de fato.
 *
 * Estava declarado DENTRO do render do drawer -- tipo novo a cada render, o que
 * remonta o bloco a cada atualização de estado do componente inteiro. E
 * reimplementava à mão o spinner e o bloco de erro que `LoadingState` e
 * `ErrorState` já fazem, em formato levemente diferente dos dois.
 *
 * A ordem importa e é a mesma dos primitivos: erro ANTES de vazio. "Nenhum
 * negócio vinculado" era exibido enquanto a consulta rodava E quando ela
 * falhava -- nos dois casos a tela afirmava um fato que não conhecia, e um
 * vendedor decidindo abordar alguém "que não tem negócio aberto" merece saber
 * que a lista não carregou.
 */
function EstadoLista({
  vazio,
  carregando,
  falhou,
  onTentarNovamente,
}: {
  vazio: string;
  carregando: boolean;
  falhou: boolean;
  onTentarNovamente: () => void;
}) {
  if (carregando) return <LoadingState linhas={2} />;
  if (falhou) return <ErrorState descricao="" onTentarNovamente={onTentarNovamente} className="py-6" />;
  return <p className="py-6 text-center text-sm text-muted-foreground">{vazio}</p>;
}

export function ContactDrawer({ contact, onClose, onUpdate, companies }: ContactDrawerProps) {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Contact>>({});
  const [phoneValid, setPhoneValid] = useState(true);
  // Metadata fields (editable separately)
  const [meta, setMeta] = useState({ pais: "", cidade: "", interesse: "", empresa_manual: "" });
  const [activities, setActivities] = useState<Activity[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [activityForm, setActivityForm] = useState({ type: "note" as ActivityType, title: "", body: "" });
  // Carregando e falhou eram indistinguíveis de "não tem nada".
  const [carregando, setCarregando] = useState(false);
  const [falhou, setFalhou] = useState(false);

  /**
   * Uma frase para os três estados que antes eram um só.
   *
   * "Nenhum negócio vinculado" era exibido enquanto a consulta rodava E quando
   * ela falhava. Nos dois casos a tela afirmava um fato que não conhecia.
   */
  const fetchRelated = useCallback(async () => {
    if (!contact) return;
    setCarregando(true);
    setFalhou(false);
    const [aRes, dRes, sRes] = await Promise.all([
            // O histórico de um contato antigo cresce sem parar. A gaveta mostra as
      // mais recentes, então cortar pelo fim não esconde nada que estivesse
      // visível.
      supabase.from("activities").select("*").eq("contact_id", contact.id)
        .order("created_at", { ascending: false }).limit(500),
      supabase.from("deals").select("*").eq("contact_id", contact.id)
        .order("created_at", { ascending: false }).limit(200),
      supabase.from("pipeline_stages").select("*").eq("org_id", contact.org_id).order("order"),
    ]);
    // O erro era descartado aqui: `dRes.data || []` transforma falha em lista
    // vazia, e a aba Negócios passava a afirmar que a pessoa não tem negócio
    // nenhum -- afirmação que ela não tinha como sustentar. Um vendedor
    // decidindo abordar alguém "que não tem negócio aberto" merece saber que a
    // consulta falhou.
    const erro = aRes.error || dRes.error || sRes.error;
    if (erro) {
      setFalhou(true);
      setCarregando(false);
      return;
    }
    setActivities(aRes.data || []);
    setDeals(dRes.data || []);
    setStages(sRes.data || []);
    setCarregando(false);
  }, [contact]);

  useEffect(() => {
    if (contact) {
      setForm(contact);
      const m = ((contact as any).metadata as Record<string, string>) || {};
      setMeta({
        pais: m.pais || "",
        cidade: m.cidade || "",
        interesse: m.interesse || "",
        empresa_manual: m.empresa_manual || "",
      });
      setEditing(false);
      setPhoneValid(true);
      fetchRelated();
    }
  }, [contact, fetchRelated]);

  const handleSave = async () => {
    if (!contact) return;
    if (!phoneValid) {
      toast({ title: "Telefone inválido", description: "Corrija o telefone antes de salvar.", variant: "destructive" });
      return;
    }
    const existingMeta = ((contact as any).metadata as Record<string, unknown>) || {};
    const { error } = await supabase.from("contacts").update({
      first_name: form.first_name,
      last_name: form.last_name,
      email: form.email,
      phone: form.phone,
      title: form.title,
      lifecycle_stage: form.lifecycle_stage as LifecycleStage,
      linkedin_url: form.linkedin_url,
      company_id: (form as any).company_id || null,
      metadata: {
        ...existingMeta,
        pais: meta.pais,
        cidade: meta.cidade,
        interesse: meta.interesse,
        empresa_manual: meta.empresa_manual,
      } as never,
    }).eq("id", contact.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    setEditing(false);
    onUpdate();
    toast({ title: "Contato atualizado" });
  };

  const addActivity = async () => {
    if (!orgId || !contact || !activityForm.title) return;
    // O negócio ABERTO da pessoa, quando há um só.
    //
    // Gravava apenas `contact_id`, então a atividade não aparecia no card do
    // kanban -- que junta por `deal_id`. Era o espelho do defeito de DealDetail,
    // que gravava só `deal_id` e sumia do painel.
    //
    // Só vincula quando não há ambiguidade: com dois negócios abertos, escolher
    // um seria adivinhar, e adivinhar errado é pior que deixar sem vínculo. O
    // gatilho de entrada garante um negócio por contato, então o caso comum é
    // exatamente um.
    const abertos = deals.filter((d) => d.status === "open");
    const negocioUnico = abertos.length === 1 ? abertos[0].id : null;

    await supabase.from("activities").insert({
      org_id: orgId, contact_id: contact.id, type: activityForm.type,
      title: activityForm.title, body: activityForm.body, user_id: user?.id,
      deal_id: negocioUnico,
      // Mesma correção de DealDetail.addActivity: este formulário registra o que
      // aconteceu (não tem campo de prazo), e sem completed_at a ligação não era
      // contada em "Abordagens realizadas" e ficava pendente para sempre na tela
      // de Atividades. `task` fica de fora -- é o que falta fazer.
      completed_at: ATIVIDADE_JA_ACONTECEU.includes(activityForm.type)
        ? new Date().toISOString()
        : null,
    });
    setActivityForm({ type: "note", title: "", body: "" });
    fetchRelated();
    toast({ title: "Atividade adicionada" });
  };

  if (!contact) return null;

  return (
    <Sheet open={!!contact} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[520px] sm:max-w-[520px] overflow-y-auto p-0">
        {/* Header */}
        <div className="border-b border-border p-6">
          <div className="flex items-start gap-4">
            <Avatar className="h-14 w-14">
              <AvatarFallback className="bg-primary/10 text-primary text-lg">
                {contact.first_name?.[0] || "?"}{contact.last_name?.[0] || ""}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h2 className="vx-titulo-painel">{contact.first_name} {contact.last_name}</h2>
              {contact.title && <p className="text-sm text-muted-foreground">{contact.title}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className={LIFECYCLE_BADGE[contact.lifecycle_stage ?? "lead"]}>
                  {LIFECYCLE_LABELS[contact.lifecycle_stage ?? "lead"]}
                </Badge>
                {/* DE ONDE VEIO, ao lado de em que ponto está.
                    A lista mostrava a origem e a ficha não -- então abrir o
                    contato PERDIA a informação, e era preciso voltar e procurar
                    a linha para saber de qual planilha ou campanha ele saiu. */}
                {(() => {
                  const o = getContactOrigin((contact as Record<string, unknown>).metadata as Record<string, unknown> | null);
                  return (
                    <span
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-background px-2 py-0.5 text-label font-medium text-muted-foreground"
                      title={`Origem: ${o.label}`}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.color }} />
                      {o.label}
                    </span>
                  );
                })()}
              </div>
            </div>
            {/* mr-8 afasta do X de fechar do Sheet (que fica em right-4 top-4) */}
            <Button variant="outline" size="sm" className="mr-8 shrink-0" onClick={() => setEditing(!editing)}>
              {editing ? <X className="h-4 w-4" /> : <Edit2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <Tabs defaultValue="overview" className="p-4">
          <PageTabs
            abas={[
              { valor: "overview", rotulo: "Visão geral", icone: LayoutList, rotuloCurto: "Visão" },
              { valor: "activities", rotulo: "Atividades", icone: Activity, rotuloCurto: "Ativ." },
              { valor: "deals", rotulo: "Negócios", icone: Handshake },
              { valor: "notes", rotulo: "Notas", icone: StickyNote },
            ]}
          />

          {/* Overview */}
          <TabsContent value="overview" className="mt-4 space-y-4">
            {editing ? (
              <div className="space-y-3">
                {/* Nome */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-xs">Nome</Label>
                    <Input value={form.first_name || ""} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Sobrenome</Label>
                    <Input value={form.last_name || ""} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></div>
                </div>

                {/* Empresa */}
                <div className="space-y-1">
                  <Label className="text-xs">Empresa</Label>
                  {companies.length > 0 ? (
                    <Select value={(form as any).company_id || "none"} onValueChange={(v) => setForm({ ...form, company_id: v === "none" ? null : v } as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhuma</SelectItem>
                        {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={meta.empresa_manual} onChange={(e) => setMeta({ ...meta, empresa_manual: e.target.value })} placeholder="Nome da empresa" />
                  )}
                </div>

                {/* País + Cidade */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">País</Label>
                    <Select value={meta.pais || "__none__"} onValueChange={(v) => setMeta({ ...meta, pais: v === "__none__" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Nenhum —</SelectItem>
                        {PAISES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Cidade</Label>
                    <Input value={meta.cidade} onChange={(e) => setMeta({ ...meta, cidade: e.target.value })} placeholder="Ex: São Paulo" />
                  </div>
                </div>

                {/* Telefone */}
                <div className="space-y-1">
                  <Label className="text-xs">Telefone</Label>
                  <PhoneInput value={form.phone || ""} onChange={(e164, isValid) => { setForm({ ...form, phone: e164 }); setPhoneValid(isValid || !e164); }} />
                </div>

                {/* Email */}
                <div className="space-y-1"><Label className="text-xs">Email</Label>
                  <Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>

                {/* Área de atuação */}
                <div className="space-y-1">
                  <Label className="text-xs">Área de atuação</Label>
                  <Select value={form.title || "__none__"} onValueChange={(v) => setForm({ ...form, title: v === "__none__" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Nenhuma —</SelectItem>
                      {AREAS_ATUACAO.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {/* Produto / Interesse */}
                <div className="space-y-1"><Label className="text-xs">Produto / Interesse</Label>
                  <Input value={meta.interesse} onChange={(e) => setMeta({ ...meta, interesse: e.target.value })} placeholder="Ex: Likawave Pro, consultoria..." /></div>

                {/* Ciclo de vida. Sem valor padrão inventado: cai em 'lead',
                    que é o default da coluna, em vez de 'prospect'. */}
                <div className="space-y-1">
                  <Label className="text-xs">Ciclo de vida</Label>
                  <Select
                    value={form.lifecycle_stage ?? "lead"}
                    onValueChange={(v) => setForm({ ...form, lifecycle_stage: v as LifecycleStage })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(LIFECYCLE_LABELS) as LifecycleStage[]).map((e) => (
                        <SelectItem key={e} value={e}>{LIFECYCLE_LABELS[e]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button onClick={handleSave} className="w-full"><Save className="mr-2 h-4 w-4" />Salvar alterações</Button>
              </div>
            ) : (
              <div className="space-y-3">
                {contact.email && (
                  <div className="flex items-center gap-3 text-sm">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <a href={`mailto:${contact.email}`} className="text-primary hover:underline">{contact.email}</a>
                  </div>
                )}
                {contact.phone && (() => {
                  const cleanPhone = contact.phone.replace(/@s\.whatsapp\.net$/i, "").replace(/@lid$/i, "").replace(/@c\.us$/i, "");
                  const digits = cleanPhone.replace(/\D/g, "");
                  const wa = `https://wa.me/${digits.startsWith("55") ? digits : "55" + digits}`;
                  return (
                    <div className="flex items-center gap-3 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span>{cleanPhone}</span>
                      {digits && (
                        <a href={wa} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-label text-green-600 hover:underline">
                          <MessageCircle className="h-3 w-3" />WhatsApp
                        </a>
                      )}
                    </div>
                  );
                })()}
                {contact.title && (
                  <div className="flex items-center gap-3 text-sm">
                    <Briefcase className="h-4 w-4 text-muted-foreground" />
                    <span>{contact.title}</span>
                  </div>
                )}
                {contact.linkedin_url && (
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground">LinkedIn</span>
                    <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">{contact.linkedin_url}</a>
                  </div>
                )}
                {(() => {
                  const comp = companies.find((c) => c.id === (contact as any).company_id);
                  const meta = (contact as any).metadata as Record<string, string> | null;
                  const empresaManual = meta?.empresa_manual;
                  const empresa = comp?.name || empresaManual;
                  return empresa ? (
                    <div className="flex items-center gap-3 text-sm">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span>{empresa}</span>
                    </div>
                  ) : null;
                })()}
                {(() => {
                  const meta = (contact as any).metadata as Record<string, string> | null;
                  if (!meta) return null;
                  const pais = meta.pais;
                  const cidade = meta.cidade;
                  const localStr = [cidade, pais].filter(Boolean).join(", ");
                  return localStr ? (
                    <div className="flex items-center gap-3 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span>{localStr}</span>
                    </div>
                  ) : null;
                })()}
                {(() => {
                  const meta = (contact as any).metadata as Record<string, string> | null;
                  const interesse = meta?.interesse;
                  return interesse ? (
                    <div className="flex items-center gap-3 text-sm">
                      <Star className="h-4 w-4 text-muted-foreground" />
                      <span className="text-foreground">{interesse}</span>
                    </div>
                  ) : null;
                })()}

                {/* Dados do cadastro (formulário de captação) — cidade e interesse
                    já aparecem acima, então são omitidos aqui para não repetir */}
                {(() => {
                  const m = (contact as any).metadata as Record<string, string> | null;
                  if (!m) return null;
                  const extra = CADASTRO_FIELDS.filter(
                    (f) => f.key !== "cidade" && f.key !== "interesse" && m[f.key]
                  );
                  if (extra.length === 0) return null;
                  return (
                    <div className="rounded-md border border-border p-3 space-y-2 mt-1">
                      <p className="text-label font-semibold uppercase tracking-wider text-muted-foreground">Dados do cadastro</p>
                      <div className="space-y-1.5">
                        {extra.map((f) => (
                          <div key={f.key} className="flex items-start justify-between gap-3 text-sm">
                            <span className="text-muted-foreground shrink-0">{f.label}</span>
                            <span className="text-right font-medium">{m[f.key]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div className="space-y-1 text-sm text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span>Criado em</span>
                    <span>{contact.created_at ? formatarData(contact.created_at) : "—"}</span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="shrink-0">Origem</span>
                    <span className="text-right font-medium text-foreground">
                      {getContactOrigin((contact as Record<string, unknown>).metadata as Record<string, unknown> | null).label}
                    </span>
                  </div>
                  {/* Só quando veio de planilha. Saber a DATA da importação é o
                      que separa "entrou hoje pelo formulário" de "estava numa
                      lista de dois meses atrás" -- e o selo sozinho não conta. */}
                  {(() => {
                    const em = ((contact as Record<string, unknown>).metadata as Record<string, string> | null)?.importado_em;
                    if (!em) return null;
                    return (
                      <div className="flex items-center justify-between gap-3">
                        <span>Importado em</span>
                        <span>{formatarData(em)}</span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Activities */}
          <TabsContent value="activities" className="mt-4 space-y-4">
            <div className="space-y-2">
              <div className="flex gap-2">
                <Select value={activityForm.type} onValueChange={(v) => setActivityForm({ ...activityForm, type: v as ActivityType })}>
                  <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="note">Nota</SelectItem>
                    <SelectItem value="call">Ligação</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="meeting">Reunião</SelectItem>
                    <SelectItem value="task">Tarefa</SelectItem>
                  </SelectContent>
                </Select>
                <Input className="h-8 text-sm" placeholder="Título" value={activityForm.title} onChange={(e) => setActivityForm({ ...activityForm, title: e.target.value })} />
              </div>
              <Textarea placeholder="Descrição..." value={activityForm.body} onChange={(e) => setActivityForm({ ...activityForm, body: e.target.value })} rows={2} className="text-sm" />
              <Button size="sm" onClick={addActivity} disabled={!activityForm.title}>Adicionar</Button>
            </div>
            <div className="space-y-2">
              {activities.map((a) => {
                const Icon = activityIcons[a.type];
                return (
                  <div key={a.id} className="flex gap-3 rounded-lg border border-border p-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-label font-medium text-muted-foreground uppercase">{activityLabels[a.type]}</span>
                        <span className="text-label text-muted-foreground">
                          {formatarDataHoraCurta(a.created_at!)}
                        </span>
                      </div>
                      <p className="text-sm font-medium">{a.title}</p>
                      {a.body && <p className="mt-0.5 text-xs text-muted-foreground">{a.body}</p>}
                    </div>
                  </div>
                );
              })}
              {activities.length === 0 && <EstadoLista vazio="Nenhuma atividade" carregando={carregando} falhou={falhou} onTentarNovamente={fetchRelated} />}
            </div>
          </TabsContent>

          {/* Deals */}
          <TabsContent value="deals" className="mt-4 space-y-2">
            {deals.map((d) => {
              const stage = stages.find((s) => s.id === d.stage_id);
              return (
                <Card key={d.id}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{d.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {stage && (
                            <Badge variant="secondary" className="text-label">
                              {stage.name}
                            </Badge>
                          )}
                          <SeloDeNegocio status={d.status} />
                        </div>
                      </div>
                      <span className="text-sm font-bold text-primary">
                        {formatarMoeda(Number(d.value) || 0, d.currency || "BRL")}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {deals.length === 0 && <EstadoLista vazio="Nenhum negócio vinculado" carregando={carregando} falhou={falhou} onTentarNovamente={fetchRelated} />}
          </TabsContent>

          {/* Notes */}
          <TabsContent value="notes" className="mt-4 space-y-2">
            {activities.filter((a) => a.type === "note").map((a) => (
              <div key={a.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-muted-foreground">
                    {formatarDataCurta(a.created_at!)}
                  </span>
                </div>
                <p className="text-sm font-medium">{a.title}</p>
                {a.body && <p className="mt-1 text-sm text-muted-foreground">{a.body}</p>}
              </div>
            ))}
            {activities.filter((a) => a.type === "note").length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-6">Nenhuma nota</p>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
