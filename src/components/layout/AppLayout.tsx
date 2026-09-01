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
 *   AICopilot        react-markdown, 117 KB   é um botão flutuante
 *   OnboardingModal  canvas-confetti, 11 KB   roda uma vez na vida da conta
 *
 * `lazy` adia o download até a primeira renderização de verdade. O
 * CommandPalette e o OnboardingModal só renderizam quando abertos, então nem
 * baixam antes disso.
 */
const CommandPalette = lazy(() =>
  import("@/components/CommandPalette").then((m) => ({ default: m.CommandPalette })),
);
const AICopilot = lazy(() =>
  import("@/components/crm/AICopilot").then((m) => ({ default: m.AICopilot })),
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
      <div className="flex min-h-screen w-full">
        <AppSidebar onOpenSearch={() => setSearchOpen(true)} />
        <div className="flex flex-1 flex-col min-w-0">
          <AppHeader onOpenSearch={() => setSearchOpen(true)} />
          <main className="flex-1 p-3 sm:p-6 pb-20 md:pb-6 vx-page">
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
        <AICopilot />
        {/* Configuração de empresa é do dono. Funcionário herda e nunca configura. */}
        {isAdmin && <OnboardingModal />}
      </Suspense>
    </SidebarProvider>
  );
}
