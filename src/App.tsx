import { lazy, Suspense } from "react";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { RequireAdmin } from "@/components/layout/RequireAdmin";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineDetector } from "@/components/OfflineDetector";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import AcceptInvite from "./pages/AcceptInvite";
import NotFound from "./pages/NotFound";
import { mensagemErro } from "@/lib/erro-supabase";

const TRAVA_RECARGA = "chunk_reload";

/**
 * Marca que já recarregamos, e devolve se ESTA chamada pode recarregar.
 *
 * Sem storage (navegação privada, cookies bloqueados) não há como impedir laço
 * de recarga — aí é melhor mostrar o erro do que recarregar para sempre.
 */
function podeRecarregar(): boolean {
  try {
    if (sessionStorage.getItem(TRAVA_RECARGA)) return false;
    sessionStorage.setItem(TRAVA_RECARGA, "1");
    return true;
  } catch {
    return false;
  }
}

/** Storage indisponível não pode transformar carregamento bom em falha. */
function liberaRecarga(): void {
  try {
    sessionStorage.removeItem(TRAVA_RECARGA);
  } catch {
    /* nada a limpar */
  }
}

/**
 * Wrapper para lazy() que detecta falha de chunk (erro de MIME type após novo
 * deploy) e força reload automático para buscar os novos arquivos.
 *
 * O chunk some porque o nome carrega hash do conteúdo: a aba aberta pede o
 * arquivo do deploy anterior, que não existe mais. E o rewrite do vercel.json
 * manda TUDO para o index.html, então o pedido volta 200 com HTML em vez de
 * 404 — daí a mensagem "'text/html' is not a valid JavaScript MIME type".
 *
 * A trava só serve para não recarregar em laço quando o chunk realmente não
 * existe. Ela PRECISA ser liberada quando um chunk carrega: antes ficava
 * ligada para o resto da sessão, então a recuperação valia uma vez só e o
 * deploy seguinte caía no ErrorBoundary.
 */
function lazyChunk<T extends React.ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(() =>
    factory()
      .then((mod) => {
        liberaRecarga();
        return mod;
      })
      .catch((err: unknown) => {
        const msg = mensagemErro(err);
        if (
          msg.includes("mime") ||
          msg.includes("MIME") ||
          msg.includes("Failed to fetch") ||
          msg.includes("Loading chunk") ||
          msg.includes("dynamically imported module")
        ) {
          if (podeRecarregar()) window.location.reload();
        }
        throw err;
      })
  );
}

// Route-based code splitting (lazyChunk auto-reloads on MIME type errors after deploy)
const Dashboard        = lazyChunk(() => import("./pages/Dashboard"));
const Contacts         = lazyChunk(() => import("./pages/Contacts"));
const Companies        = lazyChunk(() => import("./pages/Companies"));
const Produtos         = lazyChunk(() => import("./pages/Produtos"));
const Deals            = lazyChunk(() => import("./pages/Deals"));
const DealDetail       = lazyChunk(() => import("./pages/DealDetail"));
const Activities       = lazyChunk(() => import("./pages/Activities"));
const Inbox            = lazyChunk(() => import("./pages/Inbox"));
const MyEmail          = lazyChunk(() => import("./pages/MyEmail"));
const Conversations    = lazyChunk(() => import("./pages/Conversations"));
const EmailTemplates   = lazyChunk(() => import("./pages/EmailTemplates"));
const EmailSequences   = lazyChunk(() => import("./pages/EmailSequences"));
const LeadScoring      = lazyChunk(() => import("./pages/LeadScoring"));
const Reports          = lazyChunk(() => import("./pages/Reports"));
const Automations      = lazyChunk(() => import("./pages/Automations"));
const Settings         = lazyChunk(() => import("./pages/Settings"));
const Integrations     = lazyChunk(() => import("./pages/Integrations"));
const SecuritySettings = lazyChunk(() => import("./pages/SecuritySettings"));
const SalesGoals       = lazyChunk(() => import("./pages/SalesGoals"));
const Team             = lazyChunk(() => import("./pages/Team"));
const Marketing        = lazyChunk(() => import("./pages/Marketing"));
const MarketingOverview = lazyChunk(() => import("./pages/marketing/Overview"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
  // Rede de segurança: nenhuma mutation falha em silêncio.
  // Telas que já tratam o erro exibem seu próprio toast; este cobre o resto.
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.options.onError) return; // já tratado localmente
      toast({
        title: "Erro ao salvar",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    },
  }),
});

function RouteLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function SuspenseRoute({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteLoader />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <OfflineDetector />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/accept-invite" element={<AcceptInvite />} />
              {/* `/setup` era uma SEGUNDA implementação do wizard de
                  onboarding: os mesmos passos, chamando as mesmas edge
                  functions, mas sem ler o que já está configurado e sem gravar
                  progresso -- estritamente mais fraca. E nada no produto
                  apontava para ela: só se chegava digitando a URL.

                  Vira redirecionamento para o wizard de verdade. O caminho
                  continua atendendo quem o tenha salvo. */}
              <Route path="/setup" element={<Navigate to="/dashboard?configurar=1" replace />} />
              
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<SuspenseRoute><Dashboard /></SuspenseRoute>} />
                {/* A tela saiu; o link salvo não quebra. Vira o filtro por
                    estágio em Contatos, que é o que ela mostrava. */}
                <Route path="/leads" element={<Navigate to="/contacts?estagio=lead" replace />} />
                <Route path="/contacts" element={<SuspenseRoute><Contacts /></SuspenseRoute>} />
                <Route path="/companies" element={<SuspenseRoute><Companies /></SuspenseRoute>} />
                <Route path="/produtos" element={<SuspenseRoute><Produtos /></SuspenseRoute>} />
                <Route path="/deals" element={<SuspenseRoute><Deals /></SuspenseRoute>} />
                <Route path="/deals/:id" element={<SuspenseRoute><DealDetail /></SuspenseRoute>} />
                <Route path="/activities" element={<SuspenseRoute><Activities /></SuspenseRoute>} />
                {/* `/tasks` era uma tela inteira que fazia `useActivities("task")`
                    -- a mesma consulta de Atividades com o tipo fixo, e 500
                    linhas próprias para exibi-la. Vira redirecionamento, e não
                    some: link salvo e favorito continuam chegando ao mesmo
                    lugar. `replace` para o botão Voltar não cair de novo aqui. */}
                <Route path="/tasks" element={<Navigate to="/activities?tipo=task" replace />} />
                <Route path="/reports" element={<SuspenseRoute><Reports /></SuspenseRoute>} />
                <Route path="/sales-goals" element={<SuspenseRoute><SalesGoals /></SuspenseRoute>} />

                {/* Cada pessoa tem a própria conta de e-mail e a própria caixa.
                    A RLS garante que ninguém vê o e-mail nem a conversa do outro. */}
                <Route path="/settings/email" element={<SuspenseRoute><MyEmail /></SuspenseRoute>} />
                <Route path="/inbox" element={<SuspenseRoute><Inbox /></SuspenseRoute>} />
                {/* Um canal por rota. O componente é o mesmo; o que muda é o
                    canal, que vem daqui e não de query string -- ver o comentário
                    em `navegacao.ts` sobre o `isActive`. */}
                <Route path="/conversations" element={<SuspenseRoute><Conversations canal="whatsapp" /></SuspenseRoute>} />
                <Route path="/instagram" element={<SuspenseRoute><Conversations canal="instagram" /></SuspenseRoute>} />

                {/* Todo mundo vê quem é da equipe. As ações (trocar papel, remover,
                    convidar) já são protegidas por isAdmin dentro da própria página. */}
                <Route path="/team" element={<SuspenseRoute><Team /></SuspenseRoute>} />

                {/* A própria página mostra só as abas pessoais para quem não é admin. */}
                <Route path="/settings" element={<SuspenseRoute><Settings /></SuspenseRoute>} />

                {/* Rotas restritas a owner/admin — Comercial é redirecionado */}
                <Route element={<RequireAdmin />}>
                  <Route path="/email-templates" element={<SuspenseRoute><EmailTemplates /></SuspenseRoute>} />
                  <Route path="/email-sequences" element={<SuspenseRoute><EmailSequences /></SuspenseRoute>} />
                  <Route path="/lead-scoring" element={<SuspenseRoute><LeadScoring /></SuspenseRoute>} />
                  <Route path="/automations" element={<SuspenseRoute><Automations /></SuspenseRoute>} />
                  {/* Marketing continua ACESSÍVEL, só saiu da navegação: seis
                      cartões dela não têm fonte de dado e o painel do Google
                      está zerado no código. Uma tela que mostra zeros sem
                      explicar por quê ensina a desconfiar dos números do
                      resto. Volta ao menu quando as integrações existirem. */}
                  <Route path="/marketing" element={<SuspenseRoute><Marketing /></SuspenseRoute>}>
                    <Route path="visao-geral" element={<SuspenseRoute><MarketingOverview /></SuspenseRoute>} />
                  </Route>
                  <Route path="/settings/integrations" element={<SuspenseRoute><Integrations /></SuspenseRoute>} />
                  <Route path="/settings/security" element={<SuspenseRoute><SecuritySettings /></SuspenseRoute>} />
                </Route>
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
