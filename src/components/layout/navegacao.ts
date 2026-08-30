import {
  Activity, AlertTriangle, BarChart3, Building2, CheckSquare, FileText, Handshake,
  Inbox, LayoutDashboard, Mail, Megaphone, MessageSquare, Plug, Settings, Shield,
  Target, TrendingUp, UserPlus, Users, Zap,
} from "lucide-react";

/**
 * Os destinos do sistema, em um lugar só.
 *
 * A barra lateral e a barra inferior do celular mantinham listas SEPARADAS, e
 * elas divergiram: 13 destinos existiam só na lateral e eram inalcançáveis no
 * celular — Leads, Tarefas, Metas, Equipe, Lead Scoring, Templates, Sequências,
 * Marketing e as três telas de configuração.
 *
 * Pior: a primeira aba do celular, "Home", apontava para `/`, que é o LOGIN.
 * A navegação principal do celular levava para a tela de entrada.
 */

export type ItemNav = {
  title: string;
  url: string;
  icon: React.ElementType;
  adminOnly?: boolean;
  /** Aparece nas quatro abas fixas do celular, na ordem em que estão aqui. */
  noCelular?: boolean;
};

export type GrupoNav = { label: string; items: ItemNav[] };

export const NAV_GRUPOS: GrupoNav[] = [
  {
    // Antes chamava "Principal", igual ao grupo de baixo -- dois blocos
    // seguidos com o mesmo título. Estes dois são fila de trabalho: o que
    // precisa de alguém agora, com contagem.
    label: "Atenção",
    items: [
      { title: "Leads", url: "/leads", icon: UserPlus },
    ],
  },
  {
    label: "Principal",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, noCelular: true },
      { title: "Contatos", url: "/contacts", icon: Users, noCelular: true },
      { title: "Empresas", url: "/companies", icon: Building2 },
      { title: "Negócios", url: "/deals", icon: Handshake, noCelular: true },
      { title: "Atividades", url: "/activities", icon: Activity, noCelular: true },
      // Tarefas é o filtro `tipo=task` de Atividades, não uma tela própria.
      // Eram duas telas fazendo a MESMA consulta, e os filtros de data de
      // Atividades já eram superconjunto dos de Tarefas.
      { title: "Tarefas", url: "/activities?tipo=task", icon: CheckSquare },
    ],
  },
  {
    label: "Atendimento",
    items: [
      // Os dois CANAIS de atendimento, em paralelo: WhatsApp e e-mail.
      // Cada pessoa vê só a própria caixa — a RLS impede ver a do colega.
      { title: "WhatsApp", url: "/conversations", icon: MessageSquare },
      { title: "E-mail", url: "/inbox", icon: Inbox },
      { title: "Templates", url: "/email-templates", icon: FileText, adminOnly: true },
      { title: "Sequências", url: "/email-sequences", icon: Zap, adminOnly: true },
    ],
  },
  {
    label: "Marketing",
    items: [
      { title: "Visão Geral", url: "/marketing/visao-geral", icon: Megaphone, adminOnly: true },
    ],
  },
  {
    label: "Analytics",
    items: [
      { title: "Metas", url: "/sales-goals", icon: Target },
      { title: "Lead Scoring", url: "/lead-scoring", icon: TrendingUp, adminOnly: true },
      { title: "Relatórios", url: "/reports", icon: BarChart3 },
      { title: "Automações", url: "/automations", icon: Zap, adminOnly: true },
    ],
  },
  {
    label: "Admin",
    items: [
      // Todo mundo vê quem é da equipe; só admin consegue alterar.
      { title: "Equipe", url: "/team", icon: Users },
      // Abas de empresa só aparecem para admin dentro da própria página.
      { title: "Configurações", url: "/settings", icon: Settings },
      // Conectar a conta é configuração pessoal, não operação de atendimento.
      { title: "Conectar e-mail", url: "/settings/email", icon: Mail },
      { title: "Integrações", url: "/settings/integrations", icon: Plug, adminOnly: true },
      { title: "Segurança", url: "/settings/security", icon: Shield, adminOnly: true },
    ],
  },
];

/** Ícone do painel de risco, que é botão e não rota — por isso fica fora. */
export const ICONE_RISCO = AlertTriangle;

/** As quatro abas fixas da barra inferior do celular. */
export const ABAS_CELULAR: ItemNav[] = NAV_GRUPOS.flatMap((g) => g.items).filter((i) => i.noCelular);

/**
 * Tudo o que não cabe nas quatro abas, agrupado igual à lateral.
 *
 * Como sai da MESMA lista, um destino novo aparece nos dois lugares sozinho --
 * que é o que faltava para os 13 sumirem.
 */
export function gruposDoMenuMais(isAdmin: boolean): GrupoNav[] {
  return NAV_GRUPOS
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.noCelular && (isAdmin || !i.adminOnly)),
    }))
    .filter((g) => g.items.length > 0);
}
