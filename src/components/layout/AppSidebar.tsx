import { useState, useEffect } from "react";
import {
  LayoutDashboard, Users, UserPlus, Building2, Activity, BarChart3,
  Settings, LogOut, CheckSquare, AlertTriangle, Inbox, FileText, Zap,
  Target, Plug, Shield, Handshake, MessageSquare, TrendingUp,
  Megaphone, Mail,
} from "lucide-react";
import vionexLogo from "@/assets/vionex-logo-sidebar.png";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { AtRiskPanel } from "@/components/crm/AtRiskPanel";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";

type NavItem = { title: string; url: string; icon: React.ElementType; adminOnly?: boolean };

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Principal",
    items: [
      { title: "Dashboard",  url: "/dashboard",  icon: LayoutDashboard },
      { title: "Contatos",   url: "/contacts",   icon: Users },
      { title: "Empresas",   url: "/companies",  icon: Building2 },
      { title: "Funil de vendas", url: "/deals",      icon: Handshake },
      { title: "Atividades", url: "/activities", icon: Activity },
      { title: "Tarefas",    url: "/tasks",      icon: CheckSquare },
    ],
  },
  {
    label: "Atendimento",
    items: [
      // Os dois CANAIS de atendimento, em paralelo: WhatsApp e e-mail.
      // Cada pessoa vê só a própria caixa — a RLS impede ver a do colega.
      { title: "WhatsApp",         url: "/conversations",   icon: MessageSquare },
      { title: "E-mail",           url: "/inbox",           icon: Inbox },
      { title: "Templates",        url: "/email-templates", icon: FileText,      adminOnly: true },
      { title: "Sequências",       url: "/email-sequences", icon: Zap,           adminOnly: true },
    ],
  },
  {
    label: "Marketing",
    items: [
      { title: "Visão Geral",     url: "/marketing/visao-geral", icon: Megaphone, adminOnly: true },
    ],
  },
  {
    label: "Analytics",
    items: [
      { title: "Metas",        url: "/sales-goals",  icon: Target },
      { title: "Lead Scoring", url: "/lead-scoring", icon: TrendingUp, adminOnly: true },
      { title: "Relatórios",   url: "/reports",      icon: BarChart3 },
      { title: "Automações",   url: "/automations",  icon: Zap,        adminOnly: true },
    ],
  },
  {
    label: "Admin",
    items: [
      // Todo mundo vê quem é da equipe; só admin consegue alterar.
      { title: "Equipe",       url: "/team",                  icon: Users },
      // Abas de empresa só aparecem para admin dentro da própria página.
      { title: "Configurações", url: "/settings",             icon: Settings },
      // Conectar a conta é configuração pessoal, não operação de atendimento.
      { title: "Conectar e-mail", url: "/settings/email",       icon: Mail },
      { title: "Integrações",  url: "/settings/integrations", icon: Plug,     adminOnly: true },
      { title: "Segurança",    url: "/settings/security",     icon: Shield,   adminOnly: true },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { profile, signOut, isAdmin } = useAuth();
  const { orgId } = useOrg();

  // Comercial (member) só vê os itens não-admin
  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => isAdmin || !item.adminOnly),
    }))
    .filter((group) => group.items.length > 0);

  const [atRiskOpen, setAtRiskOpen] = useState(false);
  const [leadCount, setLeadCount] = useState(0);

  useEffect(() => {
    if (!orgId) return;
    const fetchCount = async () => {
      const { count } = await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "lead") as { count: number };
      setLeadCount(count || 0);
    };
    fetchCount();
    const channel = supabase
      .channel("leads-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts", filter: `org_id=eq.${orgId}` }, fetchCount)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orgId]);

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  return (
    <>
      <Sidebar collapsible="icon" className="border-r border-sidebar-border">
        {/* Header — Logo */}
        <SidebarHeader className="px-2 py-2 border-b border-sidebar-border/50">
          <div className="flex items-center justify-center">
            <img
              src={vionexLogo}
              alt="VIONEX"
              className={collapsed ? "h-10 w-10 object-contain" : "w-full max-w-[160px] h-auto object-contain"}
            />
          </div>
        </SidebarHeader>

        <SidebarContent className="px-2 py-2">
          {/* Leads + Em Risco — sempre no topo */}
          <SidebarGroup>
            <SidebarGroupContent>
              {!collapsed && (
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/40">
                  Principal
                </p>
              )}
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/leads")} tooltip="Leads">
                    <NavLink
                      to="/leads"
                      className="vx-nav-item flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sidebar-foreground/80 text-sm"
                      activeClassName="vx-nav-active"
                    >
                      <UserPlus className="h-4 w-4 shrink-0" />
                      {!collapsed && (
                        <span className="flex-1">Leads</span>
                      )}
                      {leadCount > 0 && !collapsed && (
                        <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive/90 px-1 text-[9px] font-bold text-white leading-none">
                          {leadCount > 99 ? "99+" : leadCount}
                        </span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Em Risco"
                    onClick={() => setAtRiskOpen(true)}
                    className="vx-nav-item flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sidebar-foreground/80 text-sm cursor-pointer"
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 text-warning/80" />
                    {!collapsed && <span>Em Risco</span>}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Nav groups */}
          {visibleGroups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupContent>
                {!collapsed && (
                  <p className="mb-1 mt-3 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/40">
                    {group.label}
                  </p>
                )}
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                        <NavLink
                          to={item.url}
                          end={item.url === "/dashboard"}
                          className="vx-nav-item flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sidebar-foreground/80 text-sm"
                          activeClassName="vx-nav-active"
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          {!collapsed && <span>{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        {/* Footer — User */}
        <SidebarFooter className="border-t border-sidebar-border/50 p-3">
          <div className={`flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-sidebar-accent/50 ${collapsed ? "justify-center" : ""}`}>
            <Avatar className="h-8 w-8 shrink-0 ring-2 ring-sidebar-primary/20">
              <AvatarImage src={profile?.avatar_url || ""} />
              <AvatarFallback className="bg-sidebar-primary/20 text-sidebar-primary text-xs font-semibold">
                {profile?.name?.charAt(0)?.toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <>
                <div className="flex flex-1 flex-col overflow-hidden min-w-0">
                  <span className="truncate text-[13px] font-semibold text-sidebar-foreground">
                    {profile?.name || "Usuário"}
                  </span>
                  <span className="truncate text-[11px] text-sidebar-foreground/50">
                    {profile?.email}
                  </span>
                </div>
                <button
                  onClick={signOut}
                  className="shrink-0 rounded-md p-1.5 text-sidebar-foreground/40 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
                  aria-label="Sair"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </SidebarFooter>
      </Sidebar>

      <AtRiskPanel open={atRiskOpen} onOpenChange={setAtRiskOpen} />
    </>
  );
}
