import { useNavigate } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { ABAS_CELULAR, gruposDoMenuMais } from "./navegacao";

/**
 * Barra inferior do celular.
 *
 * Tinha lista PRÓPRIA de destinos, separada da barra lateral, e as duas
 * divergiram: 13 telas eram inalcançáveis no celular, e a primeira aba --
 * rotulada "Home" -- apontava para `/`, que é o LOGIN. A navegação principal do
 * celular levava para a tela de entrada.
 *
 * Agora as duas leem `NAV_GRUPOS`. Um destino novo aparece nos dois lugares
 * sozinho.
 */
export function MobileBottomNav() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const grupos = gruposDoMenuMais(isAdmin);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex h-14 items-center justify-around border-t border-border bg-background/95 backdrop-blur-sm md:hidden"
      role="navigation"
      aria-label="Navegação principal"
    >
      {ABAS_CELULAR.map((item) => (
        <NavLink
          key={item.url}
          to={item.url}
          // O `isActive` local duplicava o que o NavLink já resolve, e a regra
          // `startsWith` marcava /deals como ativo estando em /deals/:id --
          // certo -- mas marcava /settings estando em /settings/email também.
          className="flex flex-col items-center gap-0.5 px-3 py-1.5 text-muted-foreground transition-colors"
          activeClassName="text-primary"
          aria-label={item.title}
        >
          <item.icon className="h-5 w-5" />
          <span className="text-label font-medium">{item.title}</span>
        </NavLink>
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex flex-col items-center gap-0.5 px-3 py-1.5 text-muted-foreground"
            aria-label="Mais opções de navegação"
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="text-label font-medium">Mais</span>
          </button>
        </DropdownMenuTrigger>
        {/* Rolável: com os 13 destinos de volta a lista passa da altura da tela
            do celular, e sem isso os últimos ficariam fora do alcance -- que é
            o problema que este menu existe para resolver. */}
        <DropdownMenuContent align="end" side="top" className="mb-2 max-h-[70vh] overflow-y-auto">
          {grupos.map((grupo, i) => (
            <div key={grupo.label}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-label uppercase tracking-[0.12em] text-muted-foreground/70">
                {grupo.label}
              </DropdownMenuLabel>
              {grupo.items.map((item) => (
                <DropdownMenuItem key={item.url} onClick={() => navigate(item.url)} className="gap-2">
                  <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {item.title}
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
