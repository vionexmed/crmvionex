import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  FileText,
  Handshake,
  Inbox,
  Instagram,
  LayoutDashboard,
  Mail,
  Megaphone,
  MessageSquare,
  Package,
  Plug,
  Receipt,
  Settings,
  Shield,
  Target,
  TrendingUp,
  Users,
  UsersRound,
  Zap,
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
    // O que se faz. Painel para ver, Atividades para registrar.
    //
    // "Leads" saiu. Era uma FILA DE TRIAGEM: cada lead precisava ser aprovado à
    // mão, um por um, e só ali o ciclo de vida passava de "contatado" para
    // "oportunidade". Triar lead por lead não escala, e o lead novo já cai no
    // kanban desde 20260826170000 -- a tela cobrava um trabalho que o quadro já
    // fazia melhor.
    //
    // Quem quer ver só os leads filtra por estágio em Contatos, e é para lá que
    // /leads redireciona. O que substituiu a aprovação foi o gatilho
    // `negocio_move_ciclo` (20260831120000): arrastar o card para a segunda
    // coluna É a qualificação.
    label: "Trabalho",
    items: [
      { title: "Painel", url: "/dashboard", icon: LayoutDashboard, noCelular: true },
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
      // Catálogo do que se vende. Fica em Registros e não em Trabalho porque é
      // cadastro consultado, não tela de trabalho diário -- o mesmo critério
      // que põe Empresas aqui e Atividades lá.
      { title: "Produtos", url: "/produtos", icon: Package },
      { title: "Orçamentos", url: "/orcamentos", icon: Receipt },
    ],
  },
  {
    label: "Atendimento",
    items: [
      // Os CANAIS, em paralelo. Cada pessoa vê só a própria caixa — a RLS
      // impede ver a do colega.
      //
      // Um item por canal, e não um item "Atendimento" com filtro dentro: é a
      // barra lateral que troca de canal, e é assim que a pessoa pensa. Duas
      // ROTAS e não `?canal=`, porque `isActive` compara por
      // `pathname.startsWith` -- com query string os dois itens ficariam
      // apagados, já que o pathname seria o mesmo para ambos.
      { title: "WhatsApp", url: "/conversations", icon: MessageSquare },
      { title: "Instagram", url: "/instagram", icon: Instagram },
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
      // Voltou ao menu. Eu a tinha tirado por causa dos cartões sem fonte, e
      // errei a avaliação: o painel do META funciona -- lê `meta_campaigns` e
      // `meta_insights`, que são tabelas sincronizadas. Só o Google não está
      // integrado, e agora a tela diz isso em vez de mostrar zero.
      { title: "Marketing", url: "/marketing/visao-geral", icon: Megaphone, adminOnly: true },
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

/**
 * O grupo a que uma rota pertence — a fonte do rótulo acima do título da página.
 *
 * Antes cada tela DIGITAVA esse rótulo (`kicker="Diretório"`), e o resultado foi
 * medido: 14 valores distintos para 18 telas, dos quais **15 discordavam do
 * grupo que a lateral mostrava acesa** ao mesmo tempo. Contatos dizia
 * "Diretório" e a lateral dizia "Registros"; o Painel dizia "Operação" e a
 * lateral dizia "Trabalho".
 *
 * Pior sintoma: Relatórios e Metas ficam no MESMO grupo e escreviam "Análises" e
 * "Analytics" — a mesma palavra, uma traduzida e outra não. Ninguém mantinha
 * aquilo como taxonomia porque não havia taxonomia a manter.
 *
 * Derivando daqui, o cabeçalho não tem como discordar: lê da mesma lista que
 * desenha a lateral.
 *
 * O casamento é por PREFIXO e o mais longo vence — senão `/settings` capturaria
 * `/settings/security`, e a tela de Segurança herdaria o grupo de Configurações.
 */
const TODOS_OS_DESTINOS: { url: string; grupo: string }[] = [
  ...NAV_GRUPOS.flatMap((g) => g.items.map((i) => ({ url: i.url, grupo: g.label }))),
  ...MENU_DA_CONTA.map((i) => ({ url: i.url, grupo: "Conta" })),
].sort((a, b) => b.url.length - a.url.length);

export function grupoDaRota(pathname: string): string | undefined {
  const rota = pathname.replace(/\/+$/, "") || "/";
  return TODOS_OS_DESTINOS.find(
    (d) => rota === d.url || rota.startsWith(`${d.url}/`),
  )?.grupo;
}
