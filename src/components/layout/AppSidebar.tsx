import { useState } from "react";
import { ChevronDown, LogOut, MoreHorizontal } from "lucide-react";
import vionexLogo from "@/assets/vionex-logo-sidebar.png";
import { NavLink } from "@/components/NavLink";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader, useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AtRiskPanel } from "@/components/crm/AtRiskPanel";
import { NAV_GRUPOS, ICONE_RISCO, MENU_DA_CONTA } from "./navegacao";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * A barra lateral, no formato de cartão flutuante.
 *
 * Era navy, encostada na borda, com todos os grupos abertos e um rótulo em
 * versalete sobre cada um. Agora é um cartão claro com respiro em volta -- o
 * `variant="floating"` do primitivo já dá o arredondamento, a borda e a sombra.
 *
 * O QUE MUDA DE ESTRUTURA, e não só de cor:
 *
 * - o PRIMEIRO grupo é plano, sem cabeçalho. São os destinos do dia a dia, e um
 *   rótulo "Trabalho" sobre "Painel / Atividades" não informa nada que os dois
 *   itens já não digam;
 * - os demais viram SEÇÕES RECOLHÍVEIS. Com quatro grupos e catorze itens, quem
 *   não usa Marketing carrega Marketing na tela o dia inteiro;
 * - o topo é só a MARCA, centralizada. Cheguei a pôr ali o nome da organização e
 *   um campo de busca, copiados da referência, e os dois saíram: a conta é de
 *   uma empresa só -- não há troca de workspace -- e a busca duplicava a do
 *   cabeçalho da página, com o mesmo ⌘K abrindo a mesma paleta.
 *
 * Recolhida vira um trilho de ícones, com o nome em tooltip.
 */

/** Quais seções começam fechadas. Vazio: todas abertas, e a pessoa decide. */
const FECHADAS_POR_PADRAO = new Set<string>();

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();
  const { profile, signOut, isAdmin } = useAuth();

  const [atRiskOpen, setAtRiskOpen] = useState(false);
  const [fechadas, setFechadas] = useState<Set<string>>(FECHADAS_POR_PADRAO);

  // Comercial (member) só vê os itens não-admin.
  const grupos = NAV_GRUPOS
    .map((g) => ({ ...g, items: g.items.filter((i) => isAdmin || !i.adminOnly) }))
    .filter((g) => g.items.length > 0);

  const alternar = (label: string) =>
    setFechadas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(label)) proximo.delete(label);
      else proximo.add(label);
      return proximo;
    });

  /**
   * O item de menu, nos dois estados.
   *
   * Uma função e não dois blocos de JSX porque recolhido e aberto diferem em
   * três coisas -- o rótulo, o alinhamento e o tooltip -- e não na estrutura.
   * Duplicar convidaria os dois a divergirem no próximo ajuste.
   */
  const item = (
    chave: string,
    /*
     * `ElementType` e não `ComponentType<{className}>`: os ícones vêm do lucide
     * como `ElementType`, e o tipo mais estreito recusava `ICONE_RISCO`. Aceitar
     * o mais amplo é o que deixa a função servir aos dois.
     */
    Icone: React.ElementType<{ className?: string }>,
    titulo: string,
    aoClicar?: () => void,
    url?: string,
    classeIcone?: string,
  ) => {
    const conteudo = (
      <>
        <Icone className={cn("h-[18px] w-[18px] shrink-0", classeIcone)} />
        {!collapsed && <span className="truncate">{titulo}</span>}
      </>
    );
    const classe = cn(
      "vx-nav-item flex w-full items-center rounded-lg text-sm font-medium text-sidebar-foreground",
      collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-2.5 py-2",
    );

    const corpo = url ? (
      <NavLink to={url} end={url === "/dashboard"} className={classe} activeClassName="vx-nav-active">
        {conteudo}
      </NavLink>
    ) : (
      <button type="button" onClick={aoClicar} className={cn(classe, "cursor-pointer")}>
        {conteudo}
      </button>
    );

    // Tooltip SÓ recolhida: aberta, o rótulo já está na tela e o balão vira
    // ruído que aparece a cada passagem de mouse.
    if (!collapsed) return <li key={chave}>{corpo}</li>;
    return (
      <li key={chave}>
        <Tooltip>
          <TooltipTrigger asChild>{corpo}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>{titulo}</TooltipContent>
        </Tooltip>
      </li>
    );
  };

  const nomeDaConta = profile?.name || "Usuário";

  return (
    <>
      <Sidebar collapsible="icon" variant="floating" className="border-none">
        {/* ---------- Cabeçalho: só a marca ---------- */}
        {/*
          O NOME DA ORGANIZAÇÃO E A BUSCA SAÍRAM.

          Eu os tinha trazido da referência, e aqui não se pagavam: a conta é de
          uma empresa só -- não há troca de workspace, então "Vionex / 4 pessoas"
          respondia uma pergunta que ninguém faz. E a busca duplicava a que já
          existe no cabeçalho da página, com o mesmo ⌘K abrindo a mesma paleta.

          Sobra a marca, maior e centralizada, que é o que o topo de uma lateral
          precisa fazer.
        */}
        <SidebarHeader className={cn("pt-4", collapsed ? "px-2 pb-1" : "px-3 pb-2")}>
          <div className="flex items-center justify-center">
            <img
              src={vionexLogo}
              alt="VIONEX"
              /*
               * Recolhida, mostra SÓ o símbolo. O arquivo é a marca horizontal
               * (338x122): com `object-contain` num quadrado ele encolheria para
               * ~36x13 e o "vionex" viraria um borrão. `object-cover` +
               * `object-left` recorta em vez de encolher, e como o símbolo ocupa
               * o terço esquerdo do arquivo, sobra exatamente ele.
               */
              className={collapsed
                ? "h-9 w-9 shrink-0 rounded-lg object-cover object-left"
                : "h-11 w-auto max-w-[176px] object-contain"}
            />
          </div>
        </SidebarHeader>

        <SidebarContent className={cn("gap-0 pt-2", collapsed ? "px-2" : "px-3")}>
          {grupos.map((grupo, indice) => {
            // O primeiro grupo é plano: ver o cabeçalho do arquivo.
            const plano = indice === 0;
            const aberta = plano || !fechadas.has(grupo.label);

            return (
              <div key={grupo.label} className={cn(!plano && "mt-3")}>
                {!plano && !collapsed && (
                  <button
                    type="button"
                    onClick={() => alternar(grupo.label)}
                    className="flex w-full items-center gap-1 rounded-md px-2.5 py-1.5 text-label font-semibold text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground"
                    aria-expanded={aberta}
                  >
                    <ChevronDown
                      className={cn("h-3.5 w-3.5 shrink-0 transition-transform", !aberta && "-rotate-90")}
                    />
                    <span className="truncate">{grupo.label}</span>
                  </button>
                )}

                {/* Recolhida, o separador entre grupos é uma linha -- não há
                    rótulo para separar, e sem nada os ícones viram uma coluna
                    única de catorze. */}
                {!plano && collapsed && <div className="my-2 h-px bg-sidebar-border" />}

                {aberta && (
                  <ul className="space-y-0.5">
                    {grupo.items.map((i) => item(i.title, i.icon, i.title, undefined, i.url))}

                    {/* "Em Risco" abre um painel, não uma rota -- por isso não
                        está em NAV_GRUPOS. */}
                    {grupo.label === "Atenção" &&
                      item("em-risco", ICONE_RISCO, "Em Risco", () => setAtRiskOpen(true), undefined, "text-warning")}
                  </ul>
                )}
              </div>
            );
          })}
        </SidebarContent>

        {/* ---------- Rodapé: a pessoa ---------- */}
        <SidebarFooter className={cn("pb-3", collapsed ? "px-2" : "px-3")}>
          <div className="h-px bg-sidebar-border" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "vx-nav-item mt-2 flex items-center rounded-lg text-left",
                  collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2 py-2",
                )}
                aria-label="Conta e configurações"
              >
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={profile?.avatar_url || ""} />
                  <AvatarFallback className="bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
                    {nomeDaConta.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-sidebar-accent-foreground">
                        {nomeDaConta}
                      </p>
                      <p className="truncate text-label text-sidebar-foreground/70">
                        {profile?.email}
                      </p>
                    </div>
                    <MoreHorizontal className="h-4 w-4 shrink-0 text-sidebar-foreground/50" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-56">
              {MENU_DA_CONTA.filter((i) => isAdmin || !i.adminOnly).map((i) => (
                <DropdownMenuItem key={i.url} onClick={() => navigate(i.url)} className="gap-2">
                  <i.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {i.title}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut} className="gap-2 text-destructive focus:text-destructive">
                <LogOut className="h-4 w-4 shrink-0" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      <AtRiskPanel open={atRiskOpen} onOpenChange={setAtRiskOpen} />
    </>
  );
}
