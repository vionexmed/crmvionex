import {
  Activity, AlertTriangle, BarChart3, Building2, FileText, Handshake,
  Inbox, LayoutDashboard, Mail, MessageSquare, Plug, Settings, Shield,
  Target, TrendingUp, UserPlus, Users, UsersRound, Zap,
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
    // O que se faz. Painel para ver, Leads para atender, Atividades para
    // registrar -- os três destinos de quem abre o CRM para trabalhar.
    label: "Trabalho",
    items: [
      { title: "Painel", url: "/dashboard", icon: LayoutDashboard, noCelular: true },
      { title: "Leads", url: "/leads", icon: UserPlus },
      { title: "Atividades", url: "/activities", icon: Activity, noCelular: true },
    ],
  },
  {
    // O que se guarda. Antes chamava "Principal", que não descrevia nada -- e
    // convivia com um grupo "Atenção" de um item só.
    label: "Registros",
    items: [
      { title: "Contatos", url: "/contacts", icon: Users, noCelular: true },
      { title: "Empresas", url: "/companies", icon: Building2 },
      { title: "Negócios", url: "/deals", icon: Handshake, noCelular: true },
    ],
  },
  {
    label: "Atendimento",
    items: [
      // Os dois CANAIS, em paralelo. Cada pessoa vê só a própria caixa — a RLS
      // impede ver a do colega.
      { title: "WhatsApp", url: "/conversations", icon: MessageSquare },
      { title: "E-mail", url: "/inbox", icon: Inbox },
      { title: "Templates", url: "/email-templates", icon: FileText, adminOnly: true },
      { title: "Sequências", url: "/email-sequences", icon: Zap, adminOnly: true },
    ],
  },
  {
    // Era "Analytics", e continha Automações e Lead Scoring -- que não são
    // analytics. "Análise" descreve o que os quatro têm em comum: olhar para
    // trás, ou fazer o sistema agir sozinho a partir do que se viu.
    label: "Análise",
    items: [
      { title: "Relatórios", url: "/reports", icon: BarChart3 },
      { title: "Metas", url: "/sales-goals", icon: Target },
      { title: "Lead Scoring", url: "/lead-scoring", icon: TrendingUp, adminOnly: true },
      { title: "Automações", url: "/automations", icon: Zap, adminOnly: true },
    ],
  },
];

/**
 * Configuração, no menu da conta em vez de na navegação.
 *
 * Eram cinco itens ocupando um sexto do menu lateral -- e configuração não é
 * destino de trabalho: ninguém abre o CRM para ir em Segurança. Linear e Attio
 * fazem assim, e o rodapé da lateral já tinha o avatar e o nome da pessoa.
 *
 * Não some nada: as cinco continuam sendo páginas inteiras, com as mesmas
 * rotas. Muda de onde se chega nelas.
 */
export const MENU_DA_CONTA: ItemNav[] = [
  { title: "Equipe", url: "/team", icon: UsersRound },
  { title: "Configurações", url: "/settings", icon: Settings },
  { title: "Conectar e-mail", url: "/settings/email", icon: Mail },
  { title: "Integrações", url: "/settings/integrations", icon: Plug, adminOnly: true },
  { title: "Segurança", url: "/settings/security", icon: Shield, adminOnly: true },
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
  return [
    ...NAV_GRUPOS,
    // No celular não existe rodapé de lateral -- o menu da conta vive lá. Sem
    // esta linha, as cinco telas de configuração ficariam inalcançáveis no
    // celular, que é exatamente o defeito que este arquivo existe para impedir.
    { label: "Conta", items: MENU_DA_CONTA },
  ]
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.noCelular && (isAdmin || !i.adminOnly)),
    }))
    .filter((g) => g.items.length > 0);
}
