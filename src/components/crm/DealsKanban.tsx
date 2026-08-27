import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Trophy, XCircle, ChevronDown, ChevronRight } from "lucide-react";
import {
  DndContext, closestCenter, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable,
} from "@dnd-kit/core";
import type { DealWithRelations } from "@/lib/api/deals";
import type { Database } from "@/integrations/supabase/types";


type Stage = Database["public"]["Tables"]["pipeline_stages"]["Row"];
type Contact = Database["public"]["Tables"]["contacts"]["Row"];

function formatCurrency(value: number, currency: string = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

/* ── Visual do card ──────────────────────────────────────── */

/**
 * O que o card MOSTRA, sem nada de arraste.
 *
 * Extraído porque o `DragOverlay` desenhava um card próprio, simplificado: você
 * pegava um card com empresa, probabilidade e responsável, e arrastava outro com
 * título e valor. Ele até tinha `w-[220px]` fixo, dessincronizado de
 * `sm:w-[240px]` desde que a coluna ganhou o breakpoint. Um componente só
 * elimina a categoria de divergência.
 *
 * `ContactsKanbanByOwner` já fazia isso (ContactCardVisual); os dois kanbans
 * tinham divergido sem motivo.
 */
function DealCardVisual({
  deal,
  stageColor,
  onContactClick,
  arrastando,
}: {
  deal: DealWithRelations;
  stageColor?: string;
  onContactClick?: (contact: Contact) => void;
  /** No clone, sombra mais forte e borda de acento. */
  arrastando?: boolean;
}) {
  const nomeContato = deal.contact
    ? `${deal.contact.first_name} ${deal.contact.last_name || ""}`.trim()
    : null;

  // O gatilho que põe todo contato no funil nomeia o negócio como
  // "Lead: <nome>". Resultado no card: o nome aparecia no título E no subtítulo,
  // duas linhas dizendo a mesma coisa em 25 cards seguidos.
  //
  // Casamento EXATO, não por prefixo: um negócio renomeado à mão para
  // "Lead: fulano da empresa X" continua mostrando o próprio título, porque ali
  // o texto carrega informação que o nome do contato não tem.
  const tituloEhRedundante = !!nomeContato && deal.title === `Lead: ${nomeContato}`;

  const titulo = tituloEhRedundante ? nomeContato : deal.title;
  const subtitulo = deal.company?.name ?? null;
  // Quando o título já É o nome da pessoa, o subtítulo fica só com a empresa.
  const mostrarPessoa = !tituloEhRedundante && !!nomeContato;

  const valor = Number(deal.value) || 0;
  const probability = Number(deal.probability) || 0;

  return (
    <div
      className={`rounded-lg border bg-card p-3 transition-shadow ${
        arrastando
          ? "border-primary shadow-lg"
          : "border-border shadow-[var(--shadow-xs)] group-hover:shadow-[var(--shadow-sm)]"
      }`}
      style={{ borderLeftWidth: 3, borderLeftColor: stageColor || "hsl(var(--primary))" }}
    >
      <p className="truncate text-[13px] font-semibold leading-snug text-foreground">
        {titulo}
      </p>

      {(subtitulo || mostrarPessoa) && (
        <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
          {subtitulo}
          {subtitulo && mostrarPessoa && " · "}
          {mostrarPessoa && (
            onContactClick && deal.contact ? (
              <button
                type="button"
                // stopPropagation nos DOIS eventos: sem o pointerdown, o dnd-kit
                // captura o gesto e o clique nunca chega; sem o click, ele sobe
                // para o card e navega para o negócio junto com o painel.
                onClick={(e) => {
                  e.stopPropagation();
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

      <div className="mt-2 flex items-center justify-between gap-1 border-t border-border/60 pt-2">
        {/* Valor zero perde o peso, não o lugar.
            Em negrito e monoespaçado, "R$ 0,00" repetido 25 vezes era o elemento
            de maior destaque visual do quadro e o de menor informação. */}
        <span
          className={`num text-[12px] tabular-nums ${
            valor > 0 ? "font-semibold text-foreground" : "font-normal text-muted-foreground"
          }`}
        >
          {formatCurrency(valor, deal.currency || "BRL")}
        </span>

        <div className="flex items-center gap-1.5">
          {probability > 0 && (
            <span
              className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none ${
                probability >= 70
                  ? "bg-success/12 text-success"
                  : probability >= 40
                    ? "bg-warning/12 text-warning"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {probability}%
            </span>
          )}
          {deal.owner && (
            <Avatar className="h-5 w-5 ring-1 ring-border">
              <AvatarImage src={deal.owner.avatar_url || ""} />
              <AvatarFallback className="bg-primary/10 text-[8px] font-bold text-primary">
                {deal.owner.name?.charAt(0)?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Card arrastável ─────────────────────────────────────── */

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
  // O clone visual do drag é o DragOverlay — o card original só fica translúcido.
  // Aplicar transform aqui fazia DOIS cards se moverem ao mesmo tempo.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });

  // Um arraste abortado não pode engolir o clique seguinte, e soltar um card não
  // pode abrir o negócio. Mesmo padrão de ContactsKanbanByOwner.
  const arrastou = useRef(false);
  useEffect(() => {
    if (isDragging) arrastou.current = true;
  }, [isDragging]);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // Depois dos spreads de propósito: {...listeners} já traz um onPointerDown,
      // e este o substitui e o rechama à mão. Inverter a ordem desarma a guarda.
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
      style={isDragging ? { opacity: 0.4 } : undefined}
      className="group cursor-pointer rounded-lg active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
    >
      <DealCardVisual deal={deal} stageColor={stageColor} onContactClick={onContactClick} />
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
    // `bg-card/50` e não `bg-muted`: --background e --muted têm o MESMO valor
    // (220 14% 97%), então o truque clássico de coluna cinza sobre página branca
    // é literalmente invisível no tema claro. Branco a 50% sobre a página fica
    // um degrau mais claro que ela e um abaixo do card -- e no escuro o card já
    // é mais claro que o fundo, então a mesma regra vale nos dois temas.
    <div
      ref={setNodeRef}
      role="list"
      aria-label={`Etapa ${stage.name}`}
      className={`flex w-[264px] sm:w-[280px] shrink-0 flex-col rounded-xl border transition-colors ${
        isOver ? "border-primary/30 bg-primary/5" : "border-border bg-card/50"
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {/* A cor da etapa em 6px.
              Era uma barra de largura total com 4px de altura, e cinco delas em
              azul/roxo/laranja/vermelho/verde competiam com o conteúdo. Como
              ponto, a cor identifica sem disputar atenção. */}
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: stage.color || "hsl(var(--primary))" }}
          />
          <h3 className="truncate text-[13px] font-semibold leading-tight text-foreground">
            {stage.name}
          </h3>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {deals.length}
        </span>
      </div>

      <div className="border-b border-border/60 px-3 py-1.5">
        <span className="num text-[11px] tabular-nums text-muted-foreground">
          {formatCurrency(total)}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto max-h-[calc(100vh-300px)] p-2">
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            stageColor={stage.color || undefined}
            onClick={() => onDealClick(deal)}
            onContactClick={onContactClick}
          />
        ))}

        {/* Coluna vazia dizia apenas "+ Adicionar", e um quadro com quatro
            colunas assim não explica que dá para arrastar para dentro delas. */}
        {deals.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Arraste negócios para cá
          </p>
        )}

        <button
          onClick={() => onAddDeal(stage.id)}
          aria-label={`Adicionar negócio em ${stage.name}`}
          className="flex items-center justify-center gap-1 rounded-md border border-dashed border-border py-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
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
          <span className="text-xs text-muted-foreground">{formatCurrency(total)}</span>
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
                {formatCurrency(Number(deal.value) || 0, deal.currency || "BRL")}
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

  // Continuam MONTADAS sempre, mesmo fora do arraste: desmontar e recriar no
  // dragStart arriscaria o dnd-kit não medir o droppable a tempo. O que muda é
  // o peso -- discretas em repouso, evidentes quando são alvo.
  //
  // Sem `scale-105` no estado ativo. `scale` é `transform`, e um transform perto
  // do DragOverlay é exatamente o que faz o clone fugir do cursor neste projeto
  // (ver o comentário longo em index.css sobre .vx-page). A ênfase vem de cor e
  // borda, que não criam bloco de contenção.
  return (
    <div
      ref={setNodeRef}
      aria-label={`Soltar para marcar como ${label}`}
      className={`flex w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border transition-colors ${
        isOver
          ? "border-primary bg-primary/10"
          : "border-dashed border-border/60 bg-transparent"
      }`}
    >
      <Icon className={`h-4 w-4 ${isOver ? color : "text-muted-foreground/50"}`} />
      <span className={`text-[10px] font-medium ${isOver ? color : "text-muted-foreground/60"}`}>
        {label}
      </span>
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

        {/* O overlay vai para o BODY, por portal.
            Não é preciosismo: `.vx-page` no <main> anima `transform`, e um
            ancestral com transform vira bloco de contenção para position:fixed
            -- o clone passa a se posicionar em relação ao <main> e "foge do
            cursor" pela largura da sidebar. Já aconteceu aqui, e custou três
            correções erradas antes de a causa aparecer. Até agora o kanban
            dependia só do fill-mode:backwards do .vx-page, proteção indireta que
            qualquer wrapper novo com transform anula. O kanban de contatos já usa
            portal; este ficou para trás.

            E o clone usa o MESMO componente do card do quadro: antes era um card
            simplificado à parte, então você pegava um card e arrastava outro. */}
        {createPortal(
          <DragOverlay>
            {activeDeal && (
              <div className="w-[264px] sm:w-[280px] cursor-grabbing">
                <DealCardVisual
                  deal={activeDeal}
                  stageColor={
                    stages.find((s) => s.id === activeDeal.stage_id)?.color || undefined
                  }
                  arrastando
                />
              </div>
            )}
          </DragOverlay>,
          document.body,
        )}
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
