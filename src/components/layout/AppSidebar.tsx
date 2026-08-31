import { useState } from "react";
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
import { NAV_GRUPOS, ICONE_RISCO, MENU_DA_CONTA } from "./navegacao";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNavigate } from "react-router-dom";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut, isAdmin } = useAuth();

  // Comercial (member) só vê os itens não-admin
  const visibleGroups = NAV_GRUPOS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => isAdmin || !item.adminOnly),
    }))
    .filter((group) => group.items.length > 0);

  const [atRiskOpen, setAtRiskOpen] = useState(false);
  // A CONTAGEM DE LEADS SAIU, junto com a tela.
  //
  // Ela abria uma assinatura de realtime em `contacts` para a organização
  // inteira, só para desenhar um número ao lado de um item de menu -- e o item
  // não existe mais. Quem quer o número vê o cartão "Leads recebidos" no painel,
  // que já conta a mesma coisa pela função SQL.

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  return (
    <>
      <Sidebar collapsible="icon" className="border-r border-sidebar-border">
        {/* Header — Logo */}
        <SidebarHeader className="px-2 py-2 border-b border-sidebar-border">
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
                  <p className="mb-1 mt-3 px-2 text-label font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/45">
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
                          className="vx-nav-item flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sidebar-foreground/85 text-sm"
                          activeClassName="vx-nav-active"
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          {!collapsed && <span className="flex-1">{item.title}</span>}
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
                        className="vx-nav-item flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground/85"
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
        <SidebarFooter className="border-t border-sidebar-border p-3">
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
                  <span className="truncate text-corpo font-semibold text-sidebar-foreground">
                    {profile?.name || "Usuário"}
                  </span>
                  <span className="truncate text-meta text-sidebar-foreground/55">
                    {profile?.email}
                  </span>
                </div>
                {/* O menu da conta. Antes aqui só havia o botão de sair, e as
                    cinco telas de configuração ocupavam um sexto do menu
                    lateral -- sendo que ninguém abre o CRM para ir em
                    Segurança. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="shrink-0 rounded-md p-1.5 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      aria-label="Conta e configurações"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top" className="w-52">
                    {MENU_DA_CONTA.filter((i) => isAdmin || !i.adminOnly).map((item) => (
                      <DropdownMenuItem key={item.url} onClick={() => navigate(item.url)} className="gap-2">
                        <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {item.title}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={signOut} className="gap-2 text-destructive focus:text-destructive">
                      <LogOut className="h-4 w-4 shrink-0" />
                      Sair
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </SidebarFooter>
      </Sidebar>

      <AtRiskPanel open={atRiskOpen} onOpenChange={setAtRiskOpen} />
    </>
  );
}
