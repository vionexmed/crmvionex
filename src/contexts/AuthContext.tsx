import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export type AppRole = "owner" | "admin" | "member";

/** Labels de exibição dos papéis (member = Comercial) */
export const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  member: "Comercial",
};

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  /** Papel do usuário na org atual (null enquanto carrega ou sem org) */
  role: AppRole | null;
  /** true para owner/admin — acesso total */
  isAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  role: null,
  isAdmin: false,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    // Auto-cura de convite: se este e-mail tem convite pendente e o usuário
    // caiu numa org própria vazia (fluxo de convite falhou), move para a org
    // do convite com o papel correto antes de carregar o profile.
    try {
      const { data: claim } = await supabase.rpc("claim_pending_invitation");
      if ((claim as { claimed?: boolean } | null)?.claimed) {
        console.info("[AuthContext] convite pendente aplicado", claim);
      }
    } catch {
      // RPC pode não existir ainda (migration não aplicada) — segue normal
    }

    // Retry loop: profile is created by a DB trigger on signup, so it may not
    // exist yet on the very first auth event. Retry with backoff to cover the gap.
    // Extended to 5 attempts to cover slow triggers post-remix.
    const delays = [0, 200, 500, 1000, 1500];
    let result: Profile | null = null;
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) {
        await new Promise((r) => setTimeout(r, delays[i]));
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        console.warn("[AuthContext] profile fetch error", error);
      }
      if (data) {
        result = data as Profile;
        break;
      }
    }

    // Antes havia um "auto-reparo" aqui que inseria um profile com
    // onboarding_completed: false e SEM org_id quando o trigger do banco
    // demorava. Isso era pior que o problema: o usuário caía no wizard de
    // empresa e o CompanyStep criava uma ORGANIZAÇÃO NOVA, tirando a pessoa da
    // empresa dela. Falha de trigger é rara e precisa ser visível, não
    // remendada com um perfil órfão.
    if (!result) {
      console.error(
        "[AuthContext] profile não encontrado após todas as tentativas para",
        userId,
        "— o trigger handle_new_user provavelmente falhou.",
      );
    }

    // Carregar o papel do usuário na org (member = Comercial, acesso restrito)
    let userRole: AppRole | null = null;
    if (result?.org_id) {
      const { data: roleRow, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("org_id", result.org_id)
        .maybeSingle();
      if (roleError) {
        console.warn("[AuthContext] role fetch error", roleError);
      }
      userRole = (roleRow?.role as AppRole) ?? null;
    }

    setRole(userRole);
    setProfile(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    // IMPORTANT: No async/await inside onAuthStateChange to prevent deadlocks
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          // Fetch profile in a separate non-blocking call
          setTimeout(() => {
            void loadProfile(session.user.id);
          }, 0);
        } else {
          setProfile(null);
          setRole(null);
          setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        void loadProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  const refreshProfile = async () => {
    if (!user) return;
    await loadProfile(user.id);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRole(null);
  };

  const isAdmin = role === "owner" || role === "admin";

  return (
    <AuthContext.Provider value={{ user, session, profile, role, isAdmin, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
