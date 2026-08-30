import { useLocation, useNavigate } from "react-router-dom";
import { Search, Plus, Users, Building2, Handshake, ClipboardList } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NotificationBell } from "@/components/crm/NotificationBell";
import { AIInsightsPanel } from "@/components/crm/AIInsightsPanel";
import { Button } from "@/components/ui/button";
import { NAV_GRUPOS, MENU_DA_CONTA } from "@/components/layout/navegacao";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

/**
 * O rótulo de cada rota, derivado da navegação.
 *
 * Havia um `ROTULO_DA_ROTA` escrito à mão aqui -- uma TERCEIRA lista de destinos,
 * depois da lateral e da barra do celular. E já tinha divergido: continha
 * `/tasks`, que virou redirecionamento, e "Templates de Email" e "Sequências de
 * Email", renomeados para "de e-mail" há dois commits.
 *
 * É a mesma divergência que existia entre lateral e celular, e que `NAV_GRUPOS`
 * resolveu. O cabeçalho estava de fora.
 */
const ROTULO_DA_ROTA: Record<string, string> = Object.fromEntries(
  [...NAV_GRUPOS.flatMap((g) => g.items), ...MENU_DA_CONTA].map((i) => [
    // A query string não faz parte do caminho.
    i.url.split("?")[0],
    i.title,
  ]),
);

interface AppHeaderProps {
  onOpenSearch: () => void;
  actions?: React.ReactNode;
}

export function AppHeader({ onOpenSearch, actions }: AppHeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const quickActions = [
    { label: "Novo Contato", icon: Users, path: "/contacts?action=new" },
    { label: "Nova Empresa", icon: Building2, path: "/companies?action=new" },
    { label: "Novo Negócio", icon: Handshake, path: "/deals?action=new" },
    { label: "Nova Atividade", icon: ClipboardList, path: "/activities?action=new" },
  ];

    // `/` é o LOGIN. O primeiro elo do caminho mandava quem já estava autenticado
  // para a tela de entrada -- o mesmo defeito que NotFound e Setup tinham.
  const parts: { label: string; href?: string }[] = [{ label: "VIONEX", href: "/dashboard" }];

  if (location.pathname.startsWith("/deals/") && location.pathname !== "/deals") {
    parts.push({ label: "Negócios", href: "/deals" });
    parts.push({ label: "Detalhe" });
  } else if (location.pathname.startsWith("/settings/")) {
    parts.push({ label: "Configurações", href: "/settings" });
    parts.push({ label: ROTULO_DA_ROTA[location.pathname] || "Página" });
  } else {
    const label = ROTULO_DA_ROTA[location.pathname] || "Página";
    parts.push({ label });
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 sm:gap-4 border-b border-border bg-background/80 px-3 sm:px-4 backdrop-blur-sm" role="banner">
      <SidebarTrigger className="-ml-1" aria-label="Alternar sidebar" />

      <Breadcrumb className="flex-1 hidden sm:flex">
        <BreadcrumbList>
          {parts.map((part, i) => (
            <span key={i} className="contents">
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {i < parts.length - 1 && part.href ? (
                  <BreadcrumbLink href={part.href}>{part.label}</BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{part.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </span>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      {/* Mobile: just show current page title */}
      <span className="flex-1 text-sm font-medium sm:hidden truncate">
        {parts[parts.length - 1].label}
      </span>

      <div className="flex items-center gap-1.5 sm:gap-2">
        {actions}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="default" className="h-8 w-8 rounded-full" aria-label="Ações rápidas">
              <Plus className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {quickActions.map((action) => (
              <DropdownMenuItem key={action.path} onClick={() => navigate(action.path)}>
                <action.icon className="mr-2 h-4 w-4" />
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <AIInsightsPanel />
        <NotificationBell />
        <button
          onClick={onOpenSearch}
          aria-label="Buscar (⌘K)"
          className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent sm:w-64"
        >
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline flex-1 text-left">Buscar...</span>
          <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-label font-medium text-muted-foreground sm:flex">
            ⌘K
          </kbd>
        </button>
      </div>
    </header>
  );
}
