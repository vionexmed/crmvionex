import { useLocation } from "react-router-dom";
import { Search } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NotificationBell } from "@/components/crm/NotificationBell";
import { NAV_GRUPOS, MENU_DA_CONTA } from "@/components/layout/navegacao";
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
    // 48px e não 56: a barra não tem conteúdo próprio -- caminho, busca e
    // avisos --, e oito pixels de altura ali são oito pixels a menos de lista.
    //
    // A BARRA VOLTOU A SER DO CONTEÚDO, NÃO DA PAREDE.
    //
    // Ela era `bg-card/85`, branco -- a mesma superfície da lateral. Como as
    // duas se encontram no canto superior esquerdo, a tela abria com um bloco
    // branco em L e uma emenda de 1px cortando-o no meio: o olho não tinha como
    // dizer onde termina a navegação e onde começa a página.
    //
    // Com a cor do PAPEL, a divisão passa a ser vertical e única: parede clara à
    // esquerda, coluna de conteúdo à direita -- e a barra é o topo dessa coluna,
    // que é o que ela de fato é. O `backdrop-blur` fica porque o conteúdo rola
    // por baixo dela.
    <header
      className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md sm:gap-3 sm:px-4"
      role="banner"
    >
      <SidebarTrigger className="-ml-1 text-muted-foreground" aria-label="Alternar sidebar" />
      {/* O fio separa o controle da parede do caminho da página: são duas
          funções diferentes encostadas, e sem ele o botão lê como o primeiro
          elo do caminho. */}
      <div className="hidden h-4 w-px shrink-0 bg-border sm:block" />

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
        {/* O "+" DE AÇÕES RÁPIDAS E A LÂMPADA DE INSIGHTS SAÍRAM.

            As quatro ações do "+" levavam para `?action=new` das mesmas quatro
            telas que a barra lateral já abre -- um atalho para onde já se
            chegava, ocupando o canto mais valioso do cabeçalho. E cada tela tem
            o próprio botão de criar, no contexto certo.

            Sobram o sino, que avisa de coisa que a pessoa não foi buscar, e a
            busca. */}
        <NotificationBell />
        <button
          onClick={onOpenSearch}
          aria-label="Buscar (⌘K)"
          // `bg-card` e não `bg-background`: agora que a barra tem a cor do
          // papel, um campo com a mesma cor do fundo não existiria. O campo é
          // um objeto sobre o papel, como todo controle deste sistema.
          //
          // `h-8` e não `h-9`: numa barra de 48px, um controle de 36px deixa
          // 6px em cima e embaixo e a busca encosta nas duas linhas. Com 32px o
          // ar em volta dobra, e a barra deixa de parecer cheia.
          className="flex h-8 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-xs text-muted-foreground transition-colors hover:border-input hover:text-foreground sm:w-56"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline flex-1 text-left">Buscar...</span>
          <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-label font-medium text-muted-foreground sm:flex">
            ⌘K
          </kbd>
        </button>
      </div>
    </header>
  );
}
