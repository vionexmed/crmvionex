import { Phone, Mail, CalendarDays, FileText, CheckSquare } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

export type ActivityType = Database["public"]["Enums"]["activity_type"];

/**
 * Ícone, rótulo e cor por tipo de atividade — fonte única.
 *
 * Este mapa estava em SEIS cópias, e elas já haviam divergido:
 *
 *   DealDetail.tsx        CalendarDays para reunião, "Email"
 *   ContactDrawer.tsx     idem
 *   Activities.tsx        Calendar (outro ícone), + um mapa de cor só dele
 *   NotificationBell.tsx  Calendar
 *   ActivitiesReport.tsx  só rótulos, Record<string, string>
 *   CustomReportBuilder   idem
 *
 * Duas divergências reais: o ícone de reunião (`CalendarDays` contra `Calendar`)
 * e o rótulo de e-mail ("Email" aqui, "E-mail" em dashboard/canais.ts e na
 * navegação). Nenhuma das duas dá erro de tipo -- a mesma atividade
 * simplesmente aparecia diferente dependendo da tela.
 *
 * Mesmo movimento de lib/contact-options.ts e dashboard/canais.ts, que existem
 * pelo mesmo motivo.
 */

export const ATIVIDADE_ICONE: Record<
  ActivityType,
  React.ComponentType<{ className?: string }>
> = {
  call: Phone,
  email: Mail,
  meeting: CalendarDays,
  note: FileText,
  task: CheckSquare,
};

/** "E-mail" com hífen, alinhado a dashboard/canais.ts e ao menu. */
export const ATIVIDADE_ROTULO: Record<ActivityType, string> = {
  call: "Ligação",
  email: "E-mail",
  meeting: "Reunião",
  note: "Nota",
  task: "Tarefa",
};

/** Cor do ícone. Só Activities.tsx tinha isto; agora todos podem usar. */
export const ATIVIDADE_COR: Record<ActivityType, string> = {
  call: "text-emerald-600",
  email: "text-blue-600",
  meeting: "text-amber-600",
  note: "text-muted-foreground",
  task: "text-violet-600",
};

/**
 * Ordem de exibição nos seletores.
 *
 * `DealDetail` e `ContactDrawer` ofereciam note→call→email→meeting→task, e o
 * filtro de `Activities` usava call→meeting→task→email→note. Aqui a ordem é a do
 * registro: o que se anota mais primeiro.
 */
export const ATIVIDADE_TIPOS: ActivityType[] = ["note", "call", "email", "meeting", "task"];

/**
 * Tipos que, quando registrados, descrevem algo que JÁ ACONTECEU.
 *
 * `task` é a exceção: tarefa é o que falta fazer. Usado para decidir se o
 * registro grava `completed_at` -- ver DealDetail.addActivity.
 */
export const ATIVIDADE_JA_ACONTECEU: ActivityType[] = ["note", "call", "email", "meeting"];

/**
 * Quando a atividade de fato aconteceu.
 *
 * `due_date` é previsão, não registro. `completed_at` é a verdade; `created_at`
 * é o caminho alternativo para as linhas antigas, gravadas antes de o registro
 * passar a marcar conclusão.
 *
 * Mesma definição de `aconteceuEm` em pages/Activities.tsx, que resolveu este
 * problema primeiro.
 */
export function aconteceuEm(a: { completed_at?: string | null; created_at?: string | null }): number {
  const d = a.completed_at || a.created_at;
  return d ? new Date(d).getTime() : 0;
}
