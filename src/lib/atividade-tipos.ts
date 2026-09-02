import { Phone, Mail, CalendarDays, FileText, CheckSquare, Receipt } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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

export const ATIVIDADE_ICONE: Record<ActivityType, LucideIcon> = {
  call: Phone,
  email: Mail,
  meeting: CalendarDays,
  note: FileText,
  task: CheckSquare,
  orcamento: Receipt,
};

/** "E-mail" com hífen, alinhado a dashboard/canais.ts e ao menu. */
export const ATIVIDADE_ROTULO: Record<ActivityType, string> = {
  call: "Ligação",
  email: "E-mail",
  meeting: "Reunião",
  note: "Nota",
  task: "Tarefa",
  orcamento: "Orçamento",
};

/**
 * Cor do ícone, em token semântico.
 *
 * Eu escrevi este mapa com paleta fixa do Tailwind (`text-emerald-600`,
 * `text-blue-600`, `text-amber-600`, `text-violet-600`) -- justamente no módulo
 * criado para acabar com divergência. Cor fixa não tem variante escura: no tema
 * escuro elas ficam com contraste errado, e nenhuma reage à cor de destaque que o
 * usuário escolhe em Configurações.
 *
 * A distinção fina entre os cinco tipos é do ÍCONE, não da cor -- por isso não
 * inventei token novo só para diferenciar nota de tarefa.
 */
export const ATIVIDADE_COR: Record<ActivityType, string> = {
  call: "text-success",
  email: "text-primary",
  meeting: "text-warning",
  note: "text-muted-foreground",
  task: "text-foreground",
  // Cor de destaque, como o e-mail: as duas são coisas que SAEM para o cliente,
  // e o orçamento é a que mais pesa no funil.
  orcamento: "text-primary",
};

/**
 * Ordem de exibição nos seletores.
 *
 * `DealDetail` e `ContactDrawer` ofereciam note→call→email→meeting→task, e o
 * filtro de `Activities` usava call→meeting→task→email→note. Aqui a ordem é a do
 * registro: o que se anota mais primeiro.
 */
/**
 * TODOS os tipos, em ordem de exibição. Serve a filtro e a legenda.
 *
 * Inclui `orcamento`: filtrar por ele é justamente o que se quer quando alguém
 * pergunta "o que aconteceu com os orçamentos desta semana".
 */
export const ATIVIDADE_TIPOS: ActivityType[] = [
  "note", "call", "email", "meeting", "task", "orcamento",
];

/**
 * Os tipos que uma PESSOA registra à mão.
 *
 * `orcamento` fica fora: quem grava é o sistema, quando o cliente vê ou decide
 * no link público. Oferecê-lo no seletor de "registrar atividade" convidaria a
 * escrever à mão um evento que tem dono -- e aí a ficha teria dois "aprovado"
 * com horas diferentes, um real e um digitado.
 *
 * Duas listas e não uma com filtro no call site: quem monta um seletor novo
 * escolhe a lista pelo NOME, e errar exige escrever "todos" onde se queria
 * "manuais". Com uma lista só, esquecer o filtro é o caminho de menor esforço.
 */
export const ATIVIDADE_TIPOS_MANUAIS: ActivityType[] = ATIVIDADE_TIPOS.filter(
  (t) => t !== "orcamento",
);

/**
 * Tipos que, quando registrados, descrevem algo que JÁ ACONTECEU.
 *
 * `task` é a exceção: tarefa é o que falta fazer. Usado para decidir se o
 * registro grava `completed_at` -- ver DealDetail.addActivity.
 *
 * `orcamento` entra: o sistema só grava a linha DEPOIS de o evento acontecer
 * (visto, aprovado, recusado). Fora daqui ele nasceria pendente e a ficha do
 * contato mostraria "Orçamento aprovado" como coisa a fazer.
 */
export const ATIVIDADE_JA_ACONTECEU: ActivityType[] = ["note", "call", "email", "meeting", "orcamento"];

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
