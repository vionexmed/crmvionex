import { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import { Plus, Trophy, XCircle, ChevronDown, ChevronRight, Pencil, Eye, Mail, Calendar } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { formatarDataCurta } from "@/lib/formato";
import {
  DndContext, closestCenter, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable,
} from "@dnd-kit/core";
import type { DealWithRelations } from "@/lib/api/deals";
import type { Database } from "@/integrations/supabase/types";
import { formatarMoeda, pluralizar } from "@/lib/formato";


type Stage = Database["public"]["Tables"]["pipeline_stages"]["Row"];
type Contact = Database["public"]["Tables"]["contacts"]["Row"];


/* ── Deal Card ───────────────────────────────────────────── */

/**
 * O card do quadro, no desenho da referência: título com caixa de seleção,
 * uma linha de subtítulo, `valor · data`, divisória e quatro botões redondos.
 *
 * AS TRÊS LINHAS DE CONTEXTO SAÍRAM -- notas, última interação e próxima ação.
 * Elas não existem na referência, e a decisão de segui-la foi tomada
 * explicitamente. O efeito colateral que vale registrar: `dealsApi.list` ainda
 * EMBUTE `atividades` na consulta, e agora ninguém lê. É peso morto na listagem
 * até alguém tirar de lá -- não tirei junto porque mexer no embed arrasta a
 * invalidação de cache entre negócios e atividades, que é outra história.
 *
 * `memo` porque o quadro renderiza CONTINUAMENTE durante o arraste -- o dnd-kit
 * atualiza a posição a cada movimento do ponteiro. Sem isso, mover um card
 * renderiza os duzentos.
 *
 * Só funciona com as props estáveis, e é por isso que o clique recebe
 * `onDealClick` + `deal` em vez de `onClick={() => onDealClick(deal)}`: a arrow
 * inline tem identidade nova a cada render, e `memo` compararia, veria
 * diferente e renderizaria igual -- pagando a comparação sem pular nada.
 */
const DealCard = memo(function DealCard({
  deal,
  selecionado,
  onDealClick,
  onContactClick,
  onEditDeal,
  onAlternarSelecao,
}: {
  deal: DealWithRelations;
  /** Marcado na seleção em lote. A mesma que a lista usa. */
  selecionado: boolean;
  onDealClick: (d: DealWithRelations) => void;
  /** Abre o painel da PESSOA, sem sair do quadro. */
  onContactClick?: (contact: Contact) => void;
  /** Abre o formulário de edição. Ausente: o card não mostra o lápis. */
  onEditDeal?: (d: DealWithRelations) => void;
  /** Ausente: a caixa de seleção não aparece -- não há barra que a receba. */
  onAlternarSelecao?: (id: string) => void;
}) {
  // O clone visual do drag é o DragOverlay — o card original só fica translúcido
  // (aplicar transform aqui fazia DOIS cards se moverem ao mesmo tempo)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });
  // A cor da etapa saiu do card: ela agora vive na faixa do cabeçalho da coluna.
  // Ver o comentário de `.vx-deal-card` no index.css.
  const style = isDragging ? { opacity: 0.4 } : undefined;

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

  // Um arraste abortado não pode engolir o clique seguinte, e soltar um card não
  // pode abrir painel. Mesmo padrão de ContactsKanbanByOwner.
  const arrastou = useRef(false);
  useEffect(() => {
    if (isDragging) arrastou.current = true;
  }, [isDragging]);

  const email = deal.contact?.email?.trim() || null;

  /**
   * OS QUATRO BOTÕES da referência: abrir, editar, e-mail e agenda.
   *
   * Uma lista e não quatro blocos de JSX: os quatro diferem só no ícone, no
   * rótulo e no que fazem, e escrever o botão quatro vezes convidaria os quatro
   * a divergirem no próximo ajuste de estilo.
   *
   * `desabilitado` existe por causa do e-mail: sem endereço no contato não há
   * para onde mandar, e um botão que abre um `mailto:` vazio é pior que um
   * botão apagado -- o cliente de e-mail abre em branco e a pessoa não entende
   * o que aconteceu. O `title` diz o motivo em vez de só apagar.
   *
   * Abrir e agenda caem os dois no negócio: é lá que se agenda uma atividade, e
   * a referência não tem uma tela de agenda para onde apontar.
   */
  const acoes: {
    chave: string;
    titulo: string;
    Icone: React.ComponentType<{ className?: string }>;
    aoClicar: () => void;
    desabilitado?: boolean;
  }[] = [
    { chave: "abrir", titulo: "Abrir negócio", Icone: Eye, aoClicar: () => onDealClick(deal) },
    ...(onEditDeal
      ? [{ chave: "editar", titulo: "Editar", Icone: Pencil, aoClicar: () => onEditDeal(deal) }]
      : []),
    {
      chave: "email",
      titulo: email ? `Escrever para ${email}` : "Sem e-mail no contato",
      Icone: Mail,
      desabilitado: !email,
      aoClicar: () => { if (email) window.location.href = `mailto:${email}`; },
    },
    {
      chave: "agenda",
      titulo: "Agendar atividade — abre o negócio",
      Icone: Calendar,
      aoClicar: () => onDealClick(deal),
    },
  ];

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`vx-deal-card ${selecionado ? "vx-deal-card--marcado" : ""}`}
      onPointerDown={(e) => {
        arrastou.current = false;
        listeners?.onPointerDown?.(e);
      }}
      onClick={() => {
        if (arrastou.current) {
          arrastou.current = false;
          return;
        }
        onDealClick(deal);
      }}
    >
      {/*
        TÍTULO e CAIXA DE SELEÇÃO na mesma linha, como na referência.

        A caixa alimenta a MESMA seleção da visão de lista, então marcar aqui e
        trocar para lista mantém a marcação -- e a barra de ações em lote que já
        existe aparece igual. Sem isso ela seria enfeite: caixa que marca e não
        leva a ação nenhuma é o controle morto que o resto deste arquivo evita.

        `items-start` e não `center`: o título quebra em duas linhas em negócio
        de nome longo, e centralizar faria a caixa descer junto.
      */}
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium leading-snug text-foreground">
          {deal.title}
        </p>
        {onAlternarSelecao && (
          <span
            // Nos DOIS eventos: sem o `onPointerDown`, o dnd-kit começa a
            // arrastar o card a partir da caixa e o clique nunca acontece.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="mt-0.5 shrink-0"
          >
            <Checkbox
              checked={selecionado}
              onCheckedChange={() => onAlternarSelecao(deal.id)}
              aria-label={`Selecionar ${deal.title}`}
            />
          </span>
        )}
      </div>

      {/* Empresa (texto) · Pessoa (clicável) */}
      {(deal.company || nomeContato) && (
        <p className="mt-1 truncate text-xs text-muted-foreground leading-tight">
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

      {/*
        VALOR · DATA, a terceira linha da referência.

        Sem a classe `num` (JetBrains Mono): a referência escreve o valor na
        MESMA fonte do resto, e a mono destoava logo abaixo de duas linhas de
        Roboto. `tabular-nums` fica -- é ele que alinha os dígitos, e a Roboto
        também tem o conjunto tabular.
      */}
      <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
          {formatarMoeda(Number(deal.value) || 0, deal.currency || "BRL")}
        </span>
        {deal.close_date && (
          <>
            {/* O ponto separador é um <span>, não o caractere "·": em 11px a
                bolinha de 3px lê como separador, e o "·" da fonte some. */}
            <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-muted-foreground/50" aria-hidden />
            <span className="truncate text-xs text-muted-foreground">
              {formatarDataCurta(deal.close_date)}
            </span>
          </>
        )}
      </div>

      {/*
        AÇÕES RÁPIDAS, separadas por uma linha -- é o que a referência faz.

        Os botões são círculos CONTORNADOS. Sem borda eram ícones cinza soltos
        sobre o branco, e nada dizia que eram clicáveis antes de o mouse passar
        por cima -- num card que inteiro já é clicável, é a diferença entre
        "ícone" e "botão".

        `stopPropagation` nos DOIS eventos, e não só no clique: sem o
        `onPointerDown`, o dnd-kit começa a arrastar o card a partir do botão e o
        clique nunca chega a acontecer.
      */}
      <div className="-mx-3.5 -mb-3.5 mt-2.5 flex items-center gap-2 border-t border-border px-3.5 py-2.5">
        {acoes.map(({ chave, titulo, Icone, aoClicar, desabilitado }) => (
          <button
            key={chave}
            type="button"
            title={titulo}
            aria-label={titulo}
            disabled={desabilitado}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (arrastou.current) return;
              aoClicar();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <Icone className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
});

/* ── Stage Column (Pipedrive-style) ──────────────────────── */

function StageColumn({
  stage,
  deals,
  selecionados,
  onDealClick,
  onContactClick,
  onAddDeal,
  onEditDeal,
  onAlternarSelecao,
}: {
  stage: Stage;
  deals: DealWithRelations[];
  selecionados: Set<string>;
  onDealClick: (d: DealWithRelations) => void;
  onContactClick?: (contact: Contact) => void;
  onAddDeal: (stageId: string) => void;
  onEditDeal?: (d: DealWithRelations) => void;
  onAlternarSelecao?: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const total = deals.reduce((s, d) => s + (Number(d.value) || 0), 0);

  return (
    <div
      ref={setNodeRef}
      className={`flex h-full w-[264px] min-h-0 shrink-0 flex-col rounded-xl transition-colors sm:w-[288px] ${
        isOver ? "bg-primary/5" : ""
      }`}
    >
      {/*
        O CABEÇALHO VIROU CARTÃO, com a faixa colorida NO TOPO.

        Era texto solto sobre o fundo, com a barra de cor por baixo -- a etapa não
        se lia como um objeto, e a barra parecia sublinhar o título em vez de
        identificar a coluna. Agora cabeçalho e cards são a mesma matéria (cartão
        branco sobre o cinza da página), e a cor identifica a coluna de longe.

        `overflow-hidden` é o que faz a faixa herdar o arredondamento do cartão;
        sem ele ela vaza nos cantos de cima.
      */}
      <div className="mb-2 overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-xs)]">
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: stage.color || "hsl(var(--primary))" }}
        />
        <div className="flex items-start justify-between gap-2 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <h3 className="vx-titulo-secao truncate text-foreground">{stage.name}</h3>
            <p className="mt-0.5 truncate text-label text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">
                {formatarMoeda(total)}
              </span>
              {" · "}
              {deals.length} {pluralizar(deals.length, "negócio", "negócios")}
            </p>
          </div>
          {/*
            O `+` fica VISÍVEL, e não escondido num menu.
            A referência põe "Add New Deal" no topo da coluna; um `...` no lugar
            teria o mesmo desenho e nenhuma descoberta -- ninguém abre menu para
            procurar a ação mais usada da tela.
          */}
          <button
            type="button"
            onClick={() => onAddDeal(stage.id)}
            title={`Novo negócio em ${stage.name}`}
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/*
        A ROLAGEM DA COLUNA, e por que ela estava espremida.

        Era `pr-0.5` -- DOIS pixels para a barra de rolagem, que então passava por
        cima da borda direita dos cards. E `max-h-[calc(100vh-240px)]` era um
        número mágico: 240 não corresponde a nada que exista no layout, então em
        telas de altura diferente a coluna terminava antes ou depois do que devia.

        Agora `pr-2 -mr-2`: a barra ganha 8px de canaleta, e a margem negativa
        devolve esse espaço para os cards não encolherem. E a altura vem do PAI --
        `min-h-0` é o que permite um filho de flex encolher abaixo do conteúdo,
        sem o qual `flex-1` cresce em vez de rolar.

        `pb-2` no fim para o último card não encostar na borda: sem ele parece que
        a lista foi cortada, não que acabou.
      */}
      <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-2 pr-2">
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            selecionado={selecionados.has(deal.id)}
            onDealClick={onDealClick}
            onContactClick={onContactClick}
            onEditDeal={onEditDeal}
            onAlternarSelecao={onAlternarSelecao}
          />
        ))}

        {/* O "Adicionar" do rodapé saiu: a ação subiu para o `+` do cabeçalho,
            onde a referência a coloca e onde ela não se afasta conforme a coluna
            enche -- numa coluna de dez cards, o botão de baixo ficava fora da
            tela. A zona vazia que sobra é o alvo de soltar do arraste. */}
        <div className="min-h-[60px] flex-1" />
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
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-label font-medium text-muted-foreground">
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
              className="cursor-pointer rounded-md border border-border bg-card p-2 transition-colors hover:border-primary/40"
              onClick={() => onDealClick(deal)}
            >
              <p className="truncate text-sm font-medium">{deal.title}</p>
              {deal.company && (
                <p className="truncate text-label text-muted-foreground">{deal.company.name}</p>
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
      <span className={`mt-1 text-label font-medium ${color}`}>{label}</span>
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
  /** Abre o formulário de edição a partir do card. Ausente: o lápis não aparece. */
  onEditDeal?: (deal: DealWithRelations) => void;
  /**
   * A MESMA seleção da visão de lista, e é o que faz a caixa do card valer algo.
   *
   * Marcar no quadro e trocar para lista mantém a marcação, e a barra de ações
   * em lote que já existe (`BarraDeSelecao`, em DealsList) recebe as duas. Sem
   * estas duas props a caixa não aparece -- não há barra para receber o clique.
   */
  selectedDeals?: Set<string>;
  onSelectionChange?: (s: Set<string>) => void;
  onMarkWon: (dealId: string) => void;
  onMarkLost: (dealId: string) => void;
}

export function DealsKanban({
  deals, wonDeals, lostDeals, stages, onDragEnd, onDealClick, onContactClick, onAddDeal, onEditDeal, onMarkWon, onMarkLost,
  selectedDeals, onSelectionChange,
}: DealsKanbanProps) {
  const [activeDeal, setActiveDeal] = useState<DealWithRelations | null>(null);

  // Estável para o `memo` do card: uma arrow inline aqui teria identidade nova a
  // cada render do quadro e faria os duzentos cards renderizarem de novo.
  const alternarSelecao = useCallback((id: string) => {
    if (!onSelectionChange || !selectedDeals) return;
    const proxima = new Set(selectedDeals);
    if (proxima.has(id)) proxima.delete(id);
    else proxima.add(id);
    onSelectionChange(proxima);
  }, [selectedDeals, onSelectionChange]);

  const semSelecao = useMemo(() => new Set<string>(), []);

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
    // `min-h-0` em cada nível até a coluna: sem ele a altura para de descer no
    // primeiro flex e a coluna volta a crescer em vez de rolar.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* `flex-1 min-h-0` e não `h-full`: a faixa ocupa o que sobrou da casca
            sem depender de o pai já ter altura resolvida, e é isso que faz a
            rolagem acontecer DENTRO de cada coluna em vez de na página. */}
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-2">
          {stages.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={deals.filter((d) => d.stage_id === stage.id)}
              selecionados={selectedDeals ?? semSelecao}
              onDealClick={onDealClick}
              onContactClick={onContactClick}
              onAddDeal={onAddDeal}
              onEditDeal={onEditDeal}
              onAlternarSelecao={onSelectionChange ? alternarSelecao : undefined}
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
                <p className="text-sm font-medium">{activeDeal.title}</p>
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
