import { useState, useEffect} from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { MobileBottomNav } from "./MobileBottomNav";
import { CommandPalette } from "@/components/CommandPalette";
import { AICopilot } from "@/components/crm/AICopilot";
import { OnboardingModal } from "@/components/onboarding/OnboardingModal";
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
        <AppSidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <AppHeader onOpenSearch={() => setSearchOpen(true)} />
          <main className="flex-1 p-3 sm:p-6 pb-20 md:pb-6 vx-page">
            <Outlet />
          </main>
        </div>
      </div>
      {isMobile && <MobileBottomNav />}
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <AICopilot />
      {/* Configuração de empresa é do dono. Funcionário herda e nunca configura. */}
      {isAdmin && <OnboardingModal />}
    </SidebarProvider>
  );
}
