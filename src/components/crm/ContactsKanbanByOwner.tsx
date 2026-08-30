import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { GripVertical, UserX } from "lucide-react";
import {
  DndContext, closestCenter, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable,
} from "@dnd-kit/core";
import type { Database } from "@/integrations/supabase/types";
import { indexarPorId } from "@/lib/utils";
import { LIFECYCLE_COLORS, LIFECYCLE_LABELS, type LifecycleStage } from "@/lib/contact-options";

type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Company = Database["public"]["Tables"]["companies"]["Row"];
/**
 * O selo mostra o CICLO DE VIDA, não a coluna legada `status`.
 *
 * `status` tem 4 valores contra os 6 de `lifecycle_stage`, e o gatilho mapeia
 * com PERDA: `contacted` colapsa em `lead` e `opportunity` colapsa em
 * `prospect`. Este kanban mostrava "Lead" para quem já tinha sido contatado, e
 * "Prospect" -- em inglês -- para quem estava em negociação.
 *
 * Cores e rótulos vêm de `contact-options`, a mesma fonte da tela de Contatos e
 * da de Leads. Eram três listas separadas.
 */

/**
 * Só o visual do card. Serve a lista E o clone que segue o cursor durante o
 * arraste — antes o clone era um card simplificado, sem avatar, empresa nem
 * selo, então o que você pegava e o que você arrastava não eram a mesma coisa.
 */
function ContactCardVisual({
  contact,
  company,
  arrastando = false,
}: {
  contact: Contact;
  company?: Company | null;
  arrastando?: boolean;
}) {
  const estagio = (contact.lifecycle_stage || "lead") as LifecycleStage;
  return (
    <Card
      className={
        arrastando
          ? "cursor-grabbing border-primary bg-card shadow-lg"
          : "border-border bg-card transition-all hover:shadow-md"
      }
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          {/* Dica visual de que dá para arrastar. Sem listeners: o alvo é o
              card inteiro, este ícone só anuncia. */}
          <GripVertical
            aria-hidden
            className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-opacity ${
              arrastando ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          />
          <div className="flex-1 overflow-hidden space-y-1">
            <div className="flex items-center gap-2">
              <Avatar className="h-6 w-6 shrink-0">
                <AvatarFallback className="bg-primary/10 text-primary text-micro">
                  {contact.first_name?.[0] || "?"}{contact.last_name?.[0] || ""}
                </AvatarFallback>
              </Avatar>
              <p className="truncate text-sm font-medium">{contact.first_name} {contact.last_name}</p>
            </div>
            {company && (
              <p className="truncate text-xs text-muted-foreground">{company.name}</p>
            )}
            {contact.email && (
              <p className="truncate text-xs text-muted-foreground">{contact.email}</p>
            )}
            <Badge variant="secondary" className="gap-1.5 text-label">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: LIFECYCLE_COLORS[estagio] }}
              />
              {LIFECYCLE_LABELS[estagio]}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ContactCard({
  contact,
  company,
  onClick,
}: {
  contact: Contact;
  company?: Company | null;
  onClick: () => void;
}) {
  // O clone visual do drag é o DragOverlay — o card original só fica translúcido
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: contact.id });

  // Ao soltar, o navegador ainda dispara um `click` no elemento de origem — e
  // sem isto ele abria a gaveta do contato logo depois de cada arraste. Zerado
  // a cada pointerdown para um arraste abortado não engolir o clique seguinte.
  const arrastou = useRef(false);
  useEffect(() => {
    if (isDragging) arrastou.current = true;
  }, [isDragging]);

  return (
    <div
      ref={setNodeRef}
      style={isDragging ? { opacity: 0.4 } : undefined}
      {...attributes}
      {...listeners}
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
      className="group cursor-grab active:cursor-grabbing"
    >
      <ContactCardVisual contact={contact} company={company} />
    </div>
  );
}

function OwnerColumn({
  owner,
  contacts,
  porEmpresa,
  onContactClick,
}: {
  owner: { id: string; name: string; avatar_url?: string | null } | null;
  contacts: Contact[];
  // Índice, não lista. Cada coluna varria `companies` inteira para CADA
  // contato: com mil contatos e mil empresas são um milhão de comparações por
  // render, e um render acontece a cada arrastar de card.
  porEmpresa: Map<string, Company>;
  onContactClick: (c: Contact) => void;
}) {
  const columnId = owner?.id || "unassigned";
  const { setNodeRef, isOver } = useDroppable({ id: columnId });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-[260px] sm:w-[280px] shrink-0 flex-col rounded-lg border border-border transition-colors ${
        isOver ? "bg-primary/5 border-primary/30" : "bg-muted/20"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          {owner ? (
            <Avatar className="h-6 w-6">
              <AvatarImage src={owner.avatar_url || ""} />
              <AvatarFallback className="bg-primary/10 text-primary text-micro">
                {owner.name?.charAt(0)?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
          ) : (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
              <UserX className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          )}
          <h3 className="vx-titulo-secao truncate max-w-[140px]">
            {owner?.name || "Sem responsável"}
          </h3>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-label font-medium text-muted-foreground">
            {contacts.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <div className="flex flex-1 flex-col gap-1.5 p-2 overflow-y-auto max-h-[calc(100vh-260px)]">
        {contacts.map((contact) => (
          <ContactCard
            key={contact.id}
            contact={contact}
            company={contact.company_id ? porEmpresa.get(contact.company_id) : undefined}
            onClick={() => onContactClick(contact)}
          />
        ))}
        {contacts.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Arraste leads aqui
          </p>
        )}
      </div>
    </div>
  );
}

interface ContactsKanbanByOwnerProps {
  contacts: Contact[];
  members: Profile[];
  companies: Company[];
  onContactClick: (c: Contact) => void;
  onOwnerChange: (contactId: string, newOwnerId: string | null) => void;
}

export function ContactsKanbanByOwner({
  contacts,
  members,
  companies,
  onContactClick,
  onOwnerChange,
}: ContactsKanbanByOwnerProps) {
  const [activeContact, setActiveContact] = useState<Contact | null>(null);

  // Construído uma vez por mudança de `companies`, não por coluna e não por
  // render -- construir dentro do render trocaria uma varredura por outra.
  const porEmpresa = useMemo(() => indexarPorId(companies), [companies]);

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 8 },
  });
  const keyboardSensor = useSensor(KeyboardSensor);
  const sensors = useSensors(pointerSensor, touchSensor, keyboardSensor);

  const handleDragStart = (event: DragStartEvent) => {
    const contact = contacts.find((c) => c.id === event.active.id);
    setActiveContact(contact || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveContact(null);
    const { active, over } = event;
    if (!over) return;
    const contactId = active.id as string;
    const targetOwnerId = over.id as string;
    const newOwnerId = targetOwnerId === "unassigned" ? null : targetOwnerId;

    const contact = contacts.find((c) => c.id === contactId);
    if (!contact) return;
    if (contact.owner_id === newOwnerId) return;

    onOwnerChange(contactId, newOwnerId);
  };

  // Colunas: "sem responsável" + todos os membros da equipe
  const visibleMembers = members;

  const unassignedContacts = contacts.filter((c) => !c.owner_id);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {/* Unassigned column */}
        <OwnerColumn
          owner={null}
          contacts={unassignedContacts}
          porEmpresa={porEmpresa}
          onContactClick={onContactClick}
        />

        {/* One column per member */}
        {visibleMembers.map((member) => (
          <OwnerColumn
            key={member.id}
            owner={{ id: member.id, name: member.name || member.email || "?", avatar_url: member.avatar_url }}
            contacts={contacts.filter((c) => c.owner_id === member.id)}
            porEmpresa={porEmpresa}
            onContactClick={onContactClick}
          />
        ))}
      </div>

      {/*
        Portal para o body. O DragOverlay é `position: fixed` com coordenadas de
        viewport, e `fixed` se ancora no ancestral mais próximo que tenha
        transform/filter/perspective — não na viewport. O <main> tem .vx-page,
        cuja animação de entrada mexe em transform, então o clone se ancorava
        nele e ganhava de offset a largura da sidebar: parecia fugir do cursor.
        O fill-mode do .vx-page foi corrigido, mas durante os 0,25s da animação
        o transform existe de verdade — e qualquer transform futuro em algum
        ancestral traria o problema de volta. No body não há do que fugir.

        Sem largura própria também de propósito: o DragOverlay mede o card
        arrastado e aplica width/height no wrapper dele. Qualquer w-[...] aqui
        dentro briga com essa medida.
      */}
      {createPortal(
        <DragOverlay>
          {activeContact && (
            <ContactCardVisual
              contact={activeContact}
              company={activeContact.company_id ? porEmpresa.get(activeContact.company_id) : undefined}
              arrastando
            />
          )}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}
