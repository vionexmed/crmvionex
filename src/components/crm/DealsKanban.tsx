import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Trophy, XCircle, ChevronDown, ChevronRight, CalendarDays, Flag } from "lucide-react";
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

/* ── Cor da etapa ────────────────────────────────────────── */

/**
 * A cor da etapa vem do banco como hex livre, escolhido pelo usuário em
 * Configurações. Duas coisas precisam dela em runtime, e nenhuma pode sair de
 * classe Tailwind (o compilador não gera classe para valor dinâmico):
 *
 *   - o fundo da coluna, num tom levíssimo
 *   - a pílula do cabeçalho, na cor cheia
 *
 * `null` é caso real (a coluna pode nunca ter sido colorida), e aí caímos no
 * token --primary, que respeita a cor de destaque escolhida pelo usuário.
 */
function hexParaRgb(hex: string): [number, number, number] | null {
  const limpo = hex.trim().replace(/^#/, "");
  const completo =
    limpo.length === 3 ? limpo.split("").map((c) => c + c).join("") : limpo;
  if (!/^[0-9a-f]{6}$/i.test(completo)) return null;
  return [
    parseInt(completo.slice(0, 2), 16),
    parseInt(completo.slice(2, 4), 16),
    parseInt(completo.slice(4, 6), 16),
  ];
}

/** Tom de fundo da coluna: a cor da etapa quase dissolvida. */
function tintaDaColuna(hex: string | null, alpha = 0.07): string | undefined {
  if (!hex) return undefined;
  const rgb = hexParaRgb(hex);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : undefined;
}

/**
 * Texto branco ou escuro sobre a pílula, conforme a luminância da cor.
 *
 * Não é refinamento: o usuário pode escolher amarelo ou verde-limão para uma
 * etapa, e branco sobre amarelo é ilegível. Fórmula de luminância relativa da
 * WCAG; o corte em 0.6 é empírico e cobre bem o meio da escala.
 */
function textoSobre(hex: string | null): string | undefined {
  if (!hex) return undefined;
  const rgb = hexParaRgb(hex);
  if (!rgb) return undefined;
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminancia = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminancia > 0.6 ? "hsl(213 41% 10%)" : "#ffffff";
}

/* ── Chip de metadado ────────────────────────────────────── */

/**
 * Pílula contornada, no formato que o ClickUp usa para data, prioridade e campos
 * personalizados. Contorno em vez de preenchimento de propósito: cinco chips
 * preenchidos por card viram confete.
 */
function Chip({
  children,
  tom = "neutro",
}: {
  children: React.ReactNode;
  tom?: "neutro" | "alerta" | "positivo" | "atencao";
}) {
  const tons = {
    neutro: "border-border text-muted-foreground",
    alerta: "border-destructive/40 text-destructive",
    positivo: "border-success/40 text-success",
    atencao: "border-warning/40 text-warning",
  } as const;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[11px] font-medium leading-none ${tons[tom]}`}
    >
      {children}
    </span>
  );
}

/* ── Visual do card ──────────────────────────────────────── */

/**
 * O que o card MOSTRA, sem nada de arraste.
 *
 * Extraído porque o `DragOverlay` desenhava um card próprio, simplificado: você
 * pegava um card com empresa, probabilidade e responsável, e arrastava outro com
 * título e valor.
 *
 * O formato segue o do ClickUp: título com peso, uma linha de contexto, e os
 * metadados como pílulas contornadas na base -- avatar, prazo, valor,
 * probabilidade. Cada pílula aparece só quando tem conteúdo. Campo vazio
 * ocupando lugar fixo foi o que fez "R$ 0,00" virar o elemento mais destacado
 * do quadro em 25 cards seguidos.
 */
function DealCardVisual({
  deal,
  onContactClick,
  arrastando,
}: {
  deal: DealWithRelations;
  onContactClick?: (contact: Contact) => void;
  /** No clone, sombra mais forte e borda de acento. */
  arrastando?: boolean;
}) {
  const nomeContato = deal.contact
    ? `${deal.contact.first_name} ${deal.contact.last_name || ""}`.trim()
    : null;

  // O gatilho que põe todo contato no funil nomeia o negócio como
  // "Lead: <nome>". Resultado no card: o nome aparecia no título E na linha de
  // baixo, duas linhas dizendo a mesma coisa.
  //
  // Casamento EXATO, não por prefixo: um negócio renomeado à mão para
  // "Lead: fulano da empresa X" mantém o próprio título, porque ali o texto
  // carrega informação que o nome do contato não tem.
  const tituloEhRedundante = !!nomeContato && deal.title === `Lead: ${nomeContato}`;
  const titulo = tituloEhRedundante ? nomeContato : deal.title;
  const empresa = deal.company?.name ?? null;
  const mostrarPessoa = !tituloEhRedundante && !!nomeContato;

  const valor = Number(deal.value) || 0;
  const probability = Number(deal.probability) || 0;

  // Prazo, com o mesmo tratamento do ClickUp: vermelho quando já passou.
  // Comparação por dia, não por instante -- fechar hoje não está atrasado.
  const prazo = deal.close_date ? new Date(`${deal.close_date}T12:00:00`) : null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const atrasado = !!prazo && prazo < hoje && deal.status === "open";
  const prazoTexto = prazo
    ? prazo.toLocaleDateString("pt-BR", { day: "numeric", month: "short" })
    : null;

  const temMeta = !!deal.owner || !!prazoTexto || valor > 0 || probability > 0;

  return (
    <div
      className={`rounded-xl border bg-card p-3.5 transition-shadow ${
        arrastando
          ? "border-primary shadow-lg"
          : "border-border/70 shadow-[var(--shadow-xs)] group-hover:shadow-[var(--shadow-sm)]"
      }`}
    >
      <p className="text-[14px] font-semibold leading-snug text-foreground">
        {titulo}
      </p>

      {(empresa || mostrarPessoa) && (
        <p className="mt-1 truncate text-[12px] leading-tight text-muted-foreground">
          {empresa}
          {empresa && mostrarPessoa && " · "}
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

      {temMeta && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {deal.owner && (
            <Avatar className="h-[22px] w-[22px] ring-1 ring-border">
              <AvatarImage src={deal.owner.avatar_url || ""} />
              <AvatarFallback className="bg-primary/10 text-[9px] font-bold text-primary">
                {deal.owner.name?.charAt(0)?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
          )}

          {prazoTexto && (
            <Chip tom={atrasado ? "alerta" : "neutro"}>
              <CalendarDays className="h-3 w-3" />
              {prazoTexto}
            </Chip>
          )}

          {valor > 0 && (
            <Chip>
              <span className="num tabular-nums">
                {formatCurrency(valor, deal.currency || "BRL")}
              </span>
            </Chip>
          )}

          {probability > 0 && (
            <Chip tom={probability >= 70 ? "positivo" : probability >= 40 ? "atencao" : "neutro"}>
              <Flag className="h-3 w-3" />
              {probability}%
            </Chip>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Card arrastável ─────────────────────────────────────── */

function DealCard({
  deal,
  onClick,
  onContactClick,
}: {
  deal: DealWithRelations;
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
      <DealCardVisual deal={deal} onContactClick={onContactClick} />
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

  const cor = stage.color;
  const tinta = tintaDaColuna(cor);
  const corTexto = textoSobre(cor);

  return (
    // A cor da etapa banha a COLUNA num tom quase dissolvido, e os cards ficam
    // brancos por cima. É o que dá o ar de aplicativo moderno sem virar confete:
    // antes eram cinco barras chapadas de 4px disputando atenção com o conteúdo.
    //
    // Sem borda: o próprio tom já delimita. Borda somada a fundo tingido é o
    // dobro de delimitação para o mesmo trabalho.
    <div
      ref={setNodeRef}
      role="list"
      aria-label={`Etapa ${stage.name}`}
      className={`flex w-[288px] shrink-0 flex-col rounded-2xl transition-colors sm:w-[300px] ${
        isOver ? "ring-2 ring-primary/40" : ""
      } ${tinta ? "" : "bg-primary/[0.05]"}`}
      style={tinta ? { backgroundColor: tinta } : undefined}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* A pílula é o gesto central do ClickUp: o nome da etapa DENTRO da
              cor, em vez de a cor numa barra ao lado dele. */}
          <span
            className={`truncate rounded-lg px-2.5 py-1 text-[12px] font-semibold leading-none ${
              cor ? "" : "bg-primary text-primary-foreground"
            }`}
            style={cor ? { backgroundColor: cor, color: corTexto } : undefined}
          >
            {stage.name}
          </span>
          {/* Contagem FORA da pílula, em texto simples -- também como no
              ClickUp. Dentro, competiria com o nome. */}
          <span className="shrink-0 text-[12px] font-medium text-muted-foreground">
            {deals.length}
          </span>
        </div>

        {total > 0 && (
          <span className="num shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatCurrency(total)}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-2.5 pb-2.5 max-h-[calc(100vh-300px)]">
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            onClick={() => onDealClick(deal)}
            onContactClick={onContactClick}
          />
        ))}

        {/* Coluna vazia dizia apenas "+ Adicionar", e um quadro com quatro
            colunas assim não explica que dá para arrastar para dentro delas. */}
        {deals.length === 0 && (
          <p className="py-10 text-center text-xs text-muted-foreground">
            Arraste negócios para cá
          </p>
        )}

        {/* Sem contorno tracejado: sobre fundo tingido ele virava uma terceira
            moldura na mesma área. Texto e ícone bastam. */}
        <button
          onClick={() => onAddDeal(stage.id)}
          aria-label={`Adicionar negócio em ${stage.name}`}
          className="flex items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-card/70 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar
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
      className={`flex w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border transition-colors ${
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
        <div className="flex gap-3 overflow-x-auto pb-4">
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
              <div className="w-[288px] sm:w-[300px] cursor-grabbing">
                <DealCardVisual deal={activeDeal} arrastando />
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
