import { useState, useRef, useEffect, memo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Trophy, XCircle, ChevronDown, ChevronRight, FileText, Pencil, User } from "lucide-react";
import { ATIVIDADE_ICONE, ATIVIDADE_ROTULO, ATIVIDADE_COR, aconteceuEm } from "@/lib/atividade-tipos";
import { formatarDataCurta, formatarDataHora, formatarTempoRelativo } from "@/lib/formato";
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


/* ── Deal Card (Pipedrive-style) ─────────────────────────── */

/**
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
  onDealClick,
  onContactClick,
  onEditDeal,
}: {
  deal: DealWithRelations;
  onDealClick: (d: DealWithRelations) => void;
  /** Abre o painel da PESSOA, sem sair do quadro. */
  onContactClick?: (contact: Contact) => void;
  /** Abre o formulário de edição. Ausente: o card não mostra o lápis. */
  onEditDeal?: (d: DealWithRelations) => void;
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

  /**
   * As ações do rodapé do card.
   *
   * Uma lista e não três blocos de JSX: as três diferem só no ícone, no rótulo e
   * no que fazem, e escrever o botão três vezes convidaria os três a divergirem
   * no próximo ajuste de estilo.
   *
   * Só as que TÊM destino hoje. A referência mostra quatro (ver, editar, e-mail,
   * agenda); e-mail e agenda exigiriam trazer o compositor e o formulário de
   * atividade para esta tela, e botão que não leva a lugar nenhum é pior que
   * botão ausente.
   */
  const acoes = [
    /*
     * O OLHO SAIU, e é o que respondia "está confuso, não?".
     *
     * Ele fazia exatamente o que clicar no card já faz -- abrir o negócio --
     * então havia dois caminhos idênticos e um terceiro (o lápis) parecido, o
     * que fazia os três lerem como variações da mesma coisa.
     *
     * Ficam as duas que o clique no card NÃO faz: editar sem sair do quadro, e
     * abrir a PESSOA em vez do negócio.
     */
    ...(onEditDeal
      ? [{ chave: "editar", titulo: "Editar", Icone: Pencil, aoClicar: () => onEditDeal(deal) }]
      : []),
    ...(onContactClick && deal.contact
      ? [{ chave: "pessoa", titulo: nome ?? "Ver pessoa", Icone: User, aoClicar: () => onContactClick(deal.contact!) }]
      : []),
  ];

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
        onDealClick(deal);
      }}
    >
      {/* Title */}
      <p className="truncate text-corpo font-semibold leading-snug text-foreground mb-0.5">
        {deal.title}
      </p>

      {/* Empresa (texto) · Pessoa (clicável) */}
      {(deal.company || nomeContato) && (
        <p className="truncate text-meta text-muted-foreground leading-tight mb-2">
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
                  title={formatarDataHora(n.completed_at)}
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
              title={formatarDataHora(ultimaInteracao.completed_at)}
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
            className={`line-clamp-1 flex-1 text-meta leading-tight ${
              acaoAtrasada ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {textoDe(proximaAcao) ?? ATIVIDADE_ROTULO[proximaAcao.type]}
          </p>
          <span
            className={`shrink-0 text-label font-medium ${
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
        <span className="num text-xs font-bold text-foreground tabular-nums">
          {formatarMoeda(Number(deal.value) || 0, deal.currency || "BRL")}
        </span>

        <div className="flex items-center gap-1.5">
          {probability > 0 && (
            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-micro font-bold leading-none
              ${probability >= 70 ? "bg-success/12 text-success" : probability >= 40 ? "bg-warning/12 text-warning" : "bg-muted text-muted-foreground"}`}>
              {probability}%
            </span>
          )}
          {deal.owner && (
            <Avatar className="h-5 w-5 ring-1 ring-border">
              <AvatarImage src={deal.owner.avatar_url || ""} />
              <AvatarFallback className="bg-primary/10 text-primary text-micro font-bold">
                {deal.owner.name?.charAt(0)?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      </div>

      {/*
        AÇÕES RÁPIDAS, separadas por uma linha -- é o que a referência faz.

        `stopPropagation` nos DOIS eventos, e não só no clique: sem o
        `onPointerDown`, o dnd-kit começa a arrastar o card a partir do botão e o
        clique nunca chega a acontecer.
      */}
      <div className="-mx-3.5 -mb-3 mt-2.5 flex items-center gap-1 border-t border-border px-2 pt-1.5">
        {acoes.map(({ chave, titulo, Icone, aoClicar }) => (
          <button
            key={chave}
            type="button"
            title={titulo}
            aria-label={titulo}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (arrastou.current) return;
              aoClicar();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
  onDealClick,
  onContactClick,
  onAddDeal,
  onEditDeal,
}: {
  stage: Stage;
  deals: DealWithRelations[];
  onDealClick: (d: DealWithRelations) => void;
  onContactClick?: (contact: Contact) => void;
  onAddDeal: (stageId: string) => void;
  onEditDeal?: (d: DealWithRelations) => void;
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
            <p className="mt-0.5 truncate text-meta text-muted-foreground">
              <span className="num font-semibold tabular-nums text-foreground">
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
            onDealClick={onDealClick}
            onContactClick={onContactClick}
            onEditDeal={onEditDeal}
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
              <p className="truncate text-corpo font-medium">{deal.title}</p>
              {deal.company && (
                <p className="truncate text-meta text-muted-foreground">{deal.company.name}</p>
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
  onMarkWon: (dealId: string) => void;
  onMarkLost: (dealId: string) => void;
}

export function DealsKanban({
  deals, wonDeals, lostDeals, stages, onDragEnd, onDealClick, onContactClick, onAddDeal, onEditDeal, onMarkWon, onMarkLost,
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
              onDealClick={onDealClick}
              onContactClick={onContactClick}
              onAddDeal={onAddDeal}
              onEditDeal={onEditDeal}
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
                <p className="text-corpo font-medium">{activeDeal.title}</p>
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
