import { useState, useEffect } from "react";
import { LogOut } from "lucide-react";
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
import { LEAD_STAGES } from "@/lib/contact-options";
import { NAV_GRUPOS, ICONE_RISCO } from "./navegacao";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { profile, signOut, isAdmin } = useAuth();
  const { orgId } = useOrg();

  // Comercial (member) só vê os itens não-admin
  const visibleGroups = NAV_GRUPOS
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
        // Mesma fonte da página de Leads. Lia `status` (legado), que por
        // coincidência mapeia para os mesmos contatos -- mas se LEAD_STAGES
        // mudar, a coincidência acaba e o selo divergiria da tela em silêncio.
        .in("lifecycle_stage", LEAD_STAGES) as { count: number };
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
              /*
               * Recolhida, mostra SÓ o símbolo. O arquivo é a marca horizontal
               * (338x122): com object-contain num quadrado de 40px ele encolhe
               * para ~40x14 e o "vionex" vira um borrão ilegível.
               *
               * `object-cover` + `object-left` recorta em vez de encolher — o
               * navegador escala pela altura e corta a largura, e como o símbolo
               * ocupa o terço esquerdo do arquivo, sobra exatamente ele. Evita
               * manter um segundo arquivo só para este estado.
               */
              className={
                collapsed
                  ? "h-10 w-10 object-cover object-left"
                  : "w-full max-w-[160px] h-auto object-contain"
              }
            />
          </div>
        </SidebarHeader>

        <SidebarContent className="px-2 py-2">
          {/* Nav groups */}
          {visibleGroups.map((group) => (
            // Sem rótulo, o espaço que o separava some e os grupos encostam.
            // Uma margem menor mantém a leitura de blocos sem o vão do texto.
            <SidebarGroup key={group.label} className={collapsed ? "mt-2 py-0" : ""}>
              <SidebarGroupContent>
                {!collapsed && (
                  <p className="mb-1 mt-3 px-2 text-label font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/40">
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
                          {!collapsed && <span className="flex-1">{item.title}</span>}
                          {/* A contagem só faz sentido em Leads, e só quando há
                              o que atender. */}
                          {item.url === "/leads" && leadCount > 0 && !collapsed && (
                            <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive/90 px-1 text-micro font-bold leading-none text-white">
                              {leadCount > 99 ? "99+" : leadCount}
                            </span>
                          )}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}

                  {/* "Em Risco" abre um painel, não uma rota -- por isso fica
                      fora de NAV_GRUPOS e é renderizado aqui, ao lado de Leads,
                      que é o outro item de fila de trabalho. */}
                  {group.label === "Atenção" && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        tooltip="Em Risco"
                        onClick={() => setAtRiskOpen(true)}
                        className="vx-nav-item flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground/80"
                      >
                        <ICONE_RISCO className="h-4 w-4 shrink-0 text-warning/80" />
                        {!collapsed && <span>Em Risco</span>}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
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
                  <span className="truncate text-meta text-sidebar-foreground/50">
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
