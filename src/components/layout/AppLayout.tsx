import { useState, useEffect, lazy, Suspense } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { MobileBottomNav } from "./MobileBottomNav";
/**
 * Os três pesam no PRIMEIRO acesso e quase nunca são usados nele.
 *
 * Montados estaticamente aqui, entravam no pacote inicial mesmo na tela de
 * login -- e traziam junto o que cada um importa:
 *
 *   CommandPalette   cmdk, 44 KB   abre só no ⌘K
 *   OnboardingModal  canvas-confetti, 11 KB   roda uma vez na vida da conta
 *
 * `lazy` adia o download até a primeira renderização de verdade. O
 * CommandPalette e o OnboardingModal só renderizam quando abertos, então nem
 * baixam antes disso.
 */
const CommandPalette = lazy(() =>
  import("@/components/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
const OnboardingModal = lazy(() =>
  import("@/components/onboarding/OnboardingModal").then((m) => ({ default: m.OnboardingModal })),
);
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";

export function AppLayout() {
  const [searchOpen, setSearchOpen] = useState(false);
  const { user, profile, loading, isAdmin } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/");
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  // Perfil ausente significa que o trigger que cria o perfil falhou. Antes o
  // app "consertava" inserindo um perfil sem organização, o que jogava a pessoa
  // no wizard de empresa. Melhor parar e mostrar o que houve.
  if (!profile) {
    return (
      <div className="flex h-screen items-center justify-center bg-background p-6">
        <div className="max-w-sm space-y-2 text-center">
          <p className="font-heading text-base font-semibold">Não foi possível carregar seu perfil</p>
          <p className="text-sm text-muted-foreground">
            Sua conta existe, mas o cadastro dentro da empresa não foi concluído. Peça a um
            administrador para reenviar seu convite.
          </p>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      {/*
        A CASCA É FIXA; quem rola é o CONTEÚDO.

        Era `min-h-screen`: a página inteira crescia com o conteúdo e rolava por
        baixo de tudo -- lateral e cabeçalho subiam junto. Pior no kanban, onde a
        coluna também rola: dois contêineres de rolagem aninhados, e a roda do
        mouse escolhia um deles conforme a posição do cursor. É o "a página
        inteira sobe" que você viu.

        `h-screen` + `overflow-hidden` na casca prende o quadro; `overflow-y-auto`
        no `<main>` faz a rolagem acontecer DENTRO da área de conteúdo, com a
        lateral e o cabeçalho parados. `min-h-0` no meio não é decorativo: filho
        de flex nasce com `min-height: auto`, e sem isso o `<main>` cresce com o
        conteúdo em vez de rolar -- a correção não vale nada sem ele.
      */}
      <div className="flex h-screen w-full overflow-hidden">
        <AppSidebar />
        <div className="flex min-h-0 flex-1 flex-col min-w-0">
          <AppHeader onOpenSearch={() => setSearchOpen(true)} />
          <main className="vx-page min-h-0 flex-1 overflow-y-auto p-3 pb-20 sm:p-6 md:pb-6">
            <Outlet />
          </main>
        </div>
      </div>
      {isMobile && <MobileBottomNav />}
      {/* Sem `fallback` visível: são sobreposições, e um esqueleto piscando no
          canto da tela seria pior que o atraso de alguns milissegundos. */}
      <Suspense fallback={null}>
        {/* Só monta depois de aberto -- assim o cmdk nem é baixado antes do
            primeiro ⌘K. */}
        {searchOpen && <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />}
        {/* Configuração de empresa é do dono. Funcionário herda e nunca configura. */}
        {isAdmin && <OnboardingModal />}
      </Suspense>
    </SidebarProvider>
  );
}
