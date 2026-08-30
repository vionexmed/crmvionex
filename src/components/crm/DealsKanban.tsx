import { useState, useRef, useEffect } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Trophy, XCircle, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { ATIVIDADE_ICONE, ATIVIDADE_ROTULO, ATIVIDADE_COR, aconteceuEm } from "@/lib/atividade-tipos";
import { formatarDataCurta, formatarTempoRelativo } from "@/lib/formato";
import {
  DndContext, closestCenter, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable,
} from "@dnd-kit/core";
import type { DealWithRelations } from "@/lib/api/deals";
import type { Database } from "@/integrations/supabase/types";
import { formatarMoeda } from "@/lib/formato";


type Stage = Database["public"]["Tables"]["pipeline_stages"]["Row"];
type Contact = Database["public"]["Tables"]["contacts"]["Row"];


/* ── Deal Card (Pipedrive-style) ─────────────────────────── */

function DealCard({
  deal,
  stageColor,
  onClick,
  onContactClick,
}: {
  deal: DealWithRelations;
  stageColor?: string;
  onClick: () => void;
  /** Abre o painel da PESSOA, sem sair do quadro. */
  onContactClick?: (contact: Contact) => void;
}) {
  // O clone visual do drag é o DragOverlay — o card original só fica translúcido
  // (aplicar transform aqui fazia DOIS cards se moverem ao mesmo tempo)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });
  const style = {
    borderLeftColor: stageColor || "hsl(var(--primary))",
    ...(isDragging ? { opacity: 0.4 } : {}),
  };

  // Empresa e pessoa deixaram de ser uma string só: o nome da pessoa agora é
  // clicável e abre o painel dela. Antes o subtítulo inteiro era texto morto --
  // o nome estava ali e não levava a nada.
  const nome = deal.contact
    ? `${deal.contact.first_name} ${deal.contact.last_name || ""}`.trim()
    : null;

  // O nome sai do subtítulo quando o título JÁ É ele.
  //
  // Os negócios criados pelo gatilho de entrada se chamam pelo nome da pessoa
  // (antes era "Lead: <nome>", prefixo removido em 20260827120000). Sem esta
  // linha, o card mostra o mesmo nome duas vezes seguidas -- o prefixo estava
  // mascarando a repetição, não evitando.
  const nomeContato = nome && nome !== deal.title ? nome : null;
  const probability = Number(deal.probability) || 0;

  // Última interação e próxima ação, o modelo do Pipedrive.
  //
  // As atividades vêm embutidas na listagem, então nada aqui custa consulta.
  //
  // O `.sort()` abaixo é seguro porque vem sempre depois de um `.filter()`, que
  // já devolve array novo. Ordenar `deal.atividades` direto mutaria o cache do
  // react-query, que trata o próprio estado como imutável -- e o efeito seria
  // uma reordenação fantasma em outro render.
  const atividades = deal.atividades ?? [];

  // Só CONCLUÍDA é interação: atividade agendada não é algo que aconteceu.
  // Mesmo critério de "Abordagens realizadas" no painel; divergir aqui faria as
  // duas telas discordarem sobre o mesmo evento.
  //
  // Qualquer TIPO, incluindo nota -- e aqui os dois conceitos se separam de
  // propósito. "Abordagem" no painel exige call/email/meeting, porque anotar algo
  // não é falar com ninguém. "Interação" é a última coisa que aconteceu neste
  // registro, e uma nota é. Por isso esta linha não se chama abordagem.
  const concluidas = atividades
    .filter((a) => a.completed_at)
    .sort((a, b) => aconteceuEm(b) - aconteceuEm(a));

  /**
   * TODAS as notas, não só a última -- e o card cresce conforme.
   *
   * Mostrava só a interação mais recente, então o segundo registro do mesmo
   * negócio ficava invisível: você anotava e o card não mudava, o que faz
   * parecer que o registro não funcionou.
   *
   * Nota tem tratamento próprio porque é o que a pessoa ESCREVEU -- ligação e
   * reunião costumam ter título genérico ("Ligação"), e empilhar cinco linhas
   * dizendo "Ligação" não informaria nada.
   */
  const notas = concluidas.filter((a) => a.type === "note");

  /** A última interação que NÃO é nota, para o card não repetir o que já listou. */
  const ultimaInteracao = concluidas.find((a) => a.type !== "note") ?? null;

  // Próxima ação: pendente COM prazo. Sem prazo não há o que cobrar, e a
  // atividade viraria uma linha permanente sem informação de urgência.
  const proximaAcao = atividades
    .filter((a) => !a.completed_at && a.due_date)
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())[0] ?? null;

  // O corpo é o que a pessoa escreveu; o título costuma ser genérico ("Nota").
  const textoDe = (a: { body?: string | null; title?: string | null } | null) =>
    a ? (a.body?.trim() || a.title?.trim() || null) : null;

  // Comparação por DIA, não por instante: vencer hoje não está atrasado. Mesmo
  // critério do chip de close_date.
  const inicioDeHoje = new Date();
  inicioDeHoje.setHours(0, 0, 0, 0);
  const acaoAtrasada =
    !!proximaAcao?.due_date && new Date(proximaAcao.due_date) < inicioDeHoje;

  // Um arraste abortado não pode engolir o clique seguinte, e soltar um card não
  // pode abrir painel. Mesmo padrão de ContactsKanbanByOwner.
  const arrastou = useRef(false);
  useEffect(() => {
    if (isDragging) arrastou.current = true;
  }, [isDragging]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="vx-deal-card"
      onPointerDown={(e) => {
        arrastou.current = false;
        listeners?.onPointerDown?.(e);
      }}
      onClick={() => {
        if (arrastou.current) {
          arrastou.current = false;
          return;
        }
        onClick();
      }}
    >
      {/* Title */}
      <p className="truncate text-[13px] font-semibold leading-snug text-foreground mb-0.5">
        {deal.title}
      </p>

      {/* Empresa (texto) · Pessoa (clicável) */}
      {(deal.company || nomeContato) && (
        <p className="truncate text-[11px] text-muted-foreground leading-tight mb-2">
          {deal.company?.name}
          {deal.company && nomeContato && " · "}
          {nomeContato && (
            onContactClick && deal.contact ? (
              <button
                type="button"
                // stopPropagation senão o clique sobe para o card e navega para o
                // negócio -- o painel abriria e a rota mudaria no mesmo clique.
                onClick={(e) => {
                  e.stopPropagation();
                  if (arrastou.current) return;
                  onContactClick(deal.contact!);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="underline decoration-dotted underline-offset-2 hover:text-foreground"
              >
                {nomeContato}
              </button>
            ) : (
              nomeContato
            )
          )}
        </p>
      )}

      {/* Todas as notas, da mais recente para a mais antiga.
          Sem teto: o pedido foi explicitamente que o card cresça com elas. O
          limite prático é a coluna rolar, o que já acontece. */}
      {notas.length > 0 && (
        <div className="mb-2 space-y-1">
          {notas.map((n) => (
            <div
              key={n.id}
              className="flex items-start gap-1.5 rounded-md bg-muted/60 px-2 py-1.5"
            >
              <FileText className="mt-px h-3 w-3 shrink-0 text-muted-foreground" />
              <p className="flex-1 text-meta leading-tight text-muted-foreground">
                {textoDe(n) ?? ATIVIDADE_ROTULO.note}
              </p>
              {n.completed_at && (
                <span
                  title={new Date(n.completed_at).toLocaleString("pt-BR")}
                  className="shrink-0 text-label text-muted-foreground"
                >
                  {formatarTempoRelativo(n.completed_at)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Última interação: o que aconteceu, e quando.
          `line-clamp-2` em vez de truncate -- cortar em 40 caracteres devolveria
          "Cliente pediu para retornar na..." e a informação útil ficaria fora. */}
      {ultimaInteracao && (
        <div className="mb-2 flex items-start gap-1.5 rounded-md bg-muted/60 px-2 py-1.5">
          {(() => {
            const Icone = ATIVIDADE_ICONE[ultimaInteracao.type];
            return (
              <Icone
                className={`mt-px h-3 w-3 shrink-0 ${ATIVIDADE_COR[ultimaInteracao.type]}`}
              />
            );
          })()}
          <p className="line-clamp-2 flex-1 text-meta leading-tight text-muted-foreground">
            {textoDe(ultimaInteracao) ?? ATIVIDADE_ROTULO[ultimaInteracao.type]}
          </p>
          {ultimaInteracao.completed_at && (
            <span
              title={new Date(ultimaInteracao.completed_at).toLocaleString("pt-BR")}
              className="shrink-0 text-label text-muted-foreground"
            >
              {formatarTempoRelativo(ultimaInteracao.completed_at)}
            </span>
          )}
        </div>
      )}

      {/* Próxima ação: só quando existe. Negócio sem pendência não ganha linha,
          então o card não fica com espaço reservado para nada. */}
      {proximaAcao && (
        <div
          className={`mb-2 flex items-start gap-1.5 rounded-md px-2 py-1.5 ${
            acaoAtrasada ? "bg-destructive/[0.07]" : "bg-muted/40"
          }`}
        >
          {(() => {
            const Icone = ATIVIDADE_ICONE[proximaAcao.type];
            return (
              <Icone
                className={`mt-px h-3 w-3 shrink-0 ${
                  acaoAtrasada ? "text-destructive" : "text-muted-foreground"
                }`}
              />
            );
          })()}
          <p
            className={`line-clamp-1 flex-1 text-[11px] leading-tight ${
              acaoAtrasada ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {textoDe(proximaAcao) ?? ATIVIDADE_ROTULO[proximaAcao.type]}
          </p>
          <span
            className={`shrink-0 text-[10px] font-medium ${
              acaoAtrasada ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {acaoAtrasada
              ? "atrasada"
              : formatarDataCurta(proximaAcao.due_date)}
          </span>
        </div>
      )}

      {/* Bottom row */}
      <div className="flex items-center justify-between gap-1">
        <span className="num text-[12px] font-bold text-foreground tabular-nums">
          {formatarMoeda(Number(deal.value) || 0, deal.currency || "BRL")}
        </span>

        <div className="flex items-center gap-1.5">
          {probability > 0 && (
            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none
              ${probability >= 70 ? "bg-success/12 text-success" : probability >= 40 ? "bg-warning/12 text-warning" : "bg-muted text-muted-foreground"}`}>
              {probability}%
            </span>
          )}
          {deal.owner && (
            <Avatar className="h-5 w-5 ring-1 ring-border">
              <AvatarImage src={deal.owner.avatar_url || ""} />
              <AvatarFallback className="bg-primary/10 text-primary text-[8px] font-bold">
                {deal.owner.name?.charAt(0)?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Stage Column (Pipedrive-style) ──────────────────────── */

function StageColumn({
  stage,
  deals,
  onDealClick,
  onContactClick,
  onAddDeal,
}: {
  stage: Stage;
  deals: DealWithRelations[];
  onDealClick: (d: DealWithRelations) => void;
  onContactClick?: (contact: Contact) => void;
  onAddDeal: (stageId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const total = deals.reduce((s, d) => s + (Number(d.value) || 0), 0);

  return (
    <div
      ref={setNodeRef}
      className={`flex w-[264px] sm:w-[288px] shrink-0 flex-col transition-colors ${
        isOver ? "bg-primary/5" : ""
      }`}
    >
      {/* Header — Pipedrive style */}
      <div className="mb-1 px-1">
        <h3 className="text-[13px] font-bold text-foreground leading-tight">{stage.name}</h3>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground font-medium">
            {formatarMoeda(total)}
          </span>
          <span className="text-[11px] text-muted-foreground">
            · {deals.length} {deals.length === 1 ? "negócio" : "negócios"}
          </span>
        </div>
      </div>

      {/* Color bar */}
      <div
        className="h-1 w-full rounded-full mb-2"
        style={{ backgroundColor: stage.color || "hsl(var(--primary))" }}
      />

      {/* Cards */}
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto max-h-[calc(100vh-240px)] pr-0.5">
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            stageColor={stage.color || undefined}
            onClick={() => onDealClick(deal)}
            onContactClick={onContactClick}
          />
        ))}

        {/* Add button at bottom */}
        <button
          onClick={() => onAddDeal(stage.id)}
          className="flex items-center justify-center gap-1 rounded-md border border-dashed border-border py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
        >
          <Plus className="h-3 w-3" /> Adicionar
        </button>
      </div>
    </div>
  );
}

/* ── Collapsible Won/Lost ────────────────────────────────── */

function CollapsibleStatusColumn({
  title,
  icon: Icon,
  deals,
  color,
  onDealClick,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  deals: DealWithRelations[];
  color: string;
  onDealClick: (d: DealWithRelations) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const total = deals.reduce((s, d) => s + (Number(d.value) || 0), 0);

  if (deals.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-muted/20">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between px-3 py-2 hover:bg-accent/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${color}`} />
          <span className="text-sm font-semibold">{title}</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {deals.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{formatarMoeda(total)}</span>
          {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>
      {!collapsed && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1.5 p-2 border-t border-border">
          {deals.map((deal) => (
            <div
              key={deal.id}
              className="cursor-pointer rounded-md border border-border bg-card p-2 hover:shadow-sm transition-shadow"
              onClick={() => onDealClick(deal)}
            >
              <p className="truncate text-[13px] font-medium">{deal.title}</p>
              {deal.company && (
                <p className="truncate text-[11px] text-muted-foreground">{deal.company.name}</p>
              )}
              <p className={`text-xs font-semibold mt-0.5 ${color}`}>
                {formatarMoeda(Number(deal.value) || 0, deal.currency || "BRL")}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Won/Lost Drop Zones ─────────────────────────────────── */

function WonLostDropZone({
  id,
  label,
  icon: Icon,
  color,
}: {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-16 shrink-0 flex-col items-center justify-center rounded-lg border-2 border-dashed transition-all ${
        isOver ? "border-primary bg-primary/10 scale-105" : "border-border bg-muted/10"
      }`}
    >
      <Icon className={`h-5 w-5 ${color}`} />
      <span className={`mt-1 text-[10px] font-medium ${color}`}>{label}</span>
    </div>
  );
}

/* ── Main Kanban ─────────────────────────────────────────── */

interface DealsKanbanProps {
  deals: DealWithRelations[];
  wonDeals: DealWithRelations[];
  lostDeals: DealWithRelations[];
  stages: Stage[];
  onDragEnd: (dealId: string, newStageId: string) => void;
  onDealClick: (deal: DealWithRelations) => void;
  /** Clique no nome da pessoa: abre o painel dela sem sair do quadro. */
  onContactClick?: (contact: Contact) => void;
  onAddDeal: (stageId?: string) => void;
  onMarkWon: (dealId: string) => void;
  onMarkLost: (dealId: string) => void;
}

export function DealsKanban({
  deals, wonDeals, lostDeals, stages, onDragEnd, onDealClick, onContactClick, onAddDeal, onMarkWon, onMarkLost,
}: DealsKanbanProps) {
  const [activeDeal, setActiveDeal] = useState<DealWithRelations | null>(null);

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 8 },
  });
  const keyboardSensor = useSensor(KeyboardSensor);
  const sensors = useSensors(pointerSensor, touchSensor, keyboardSensor);

  const handleDragStart = (event: DragStartEvent) => {
    const deal = deals.find((d) => d.id === event.active.id);
    setActiveDeal(deal || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDeal(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = active.id as string;
    const overId = over.id as string;

    if (overId === "won-drop") {
      onMarkWon(dealId);
    } else if (overId === "lost-drop") {
      onMarkLost(dealId);
    } else if (dealId !== overId) {
      onDragEnd(dealId, overId);
    }
  };

  // Chegar aqui agora significa uma coisa só: o funil existe e está SEM ETAPAS.
  // Os casos de "carregando", "falhou" e "nenhum funil na organização" são
  // resolvidos em Deals.tsx, antes de montar este componente. Antes tudo isso
  // caía nesta mensagem, que mandava configurar um funil já configurado.
  if (stages.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border py-20">
        <div className="text-center">
          <p className="text-muted-foreground">Este funil não tem etapas</p>
          <p className="text-sm text-muted-foreground">Vá em Configurações → Funis e etapas para adicionar</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={deals.filter((d) => d.stage_id === stage.id)}
              onDealClick={onDealClick}
              onContactClick={onContactClick}
              onAddDeal={onAddDeal}
            />
          ))}

          {/* Won/Lost drop zones */}
          <WonLostDropZone id="won-drop" label="Ganho" icon={Trophy} color="text-success" />
          <WonLostDropZone id="lost-drop" label="Perdido" icon={XCircle} color="text-destructive" />
        </div>

        <DragOverlay>
          {activeDeal && (
            <div className="w-[264px] sm:w-[288px] opacity-90">
              <div className="rounded-md border border-primary bg-card p-2.5 shadow-lg">
                <p className="text-[13px] font-medium">{activeDeal.title}</p>
                <p className="text-xs font-semibold text-foreground mt-0.5">
                  {formatarMoeda(Number(activeDeal.value) || 0, activeDeal.currency || "BRL")}
                </p>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Collapsible won/lost sections below kanban */}
      {(wonDeals.length > 0 || lostDeals.length > 0) && (
        <div className="space-y-2">
          <CollapsibleStatusColumn title="Ganhos" icon={Trophy} deals={wonDeals} color="text-success" onDealClick={onDealClick} />
          <CollapsibleStatusColumn title="Perdidos" icon={XCircle} deals={lostDeals} color="text-destructive" onDealClick={onDealClick} />
        </div>
      )}
    </div>
  );
}
