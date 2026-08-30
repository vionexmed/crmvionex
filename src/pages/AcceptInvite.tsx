import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock, User, Handshake } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { mensagemErro } from "@/lib/erro-supabase";

/**
 * Página de aceite de convite. O convidado chega aqui autenticado pelo
 * magic link do convite (redirectTo do invite-member) e define nome + senha
 * antes de entrar no CRM. A org e o papel já foram atribuídos pelo trigger
 * handle_new_user a partir do convite.
 */
export default function AcceptInvite() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  const [erro, setErro] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    let tentativas = 0;
    // 15 × 400ms = 6s. Antes o laço era infinito: quando a sessão não vinha
    // (link expirado, já usado, domínio fora da lista do Supabase), a pessoa
    // ficava olhando um spinner para sempre, sem nenhuma explicação. Era o que
    // fazia o convite "não funcionar" sem deixar pista.
    const MAX = 15;

    const check = async () => {
      if (cancelado) return;

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        // O Supabase entrega a credencial de duas formas, dependendo do fluxo:
        // no HASH (#access_token=..., fluxo implícito) ou na QUERY (?code=...,
        // fluxo PKCE). Antes só o hash era reconhecido, então um link com
        // ?code= mandava a pessoa direto para o login — clicava no convite e
        // caía na tela de entrada.
        const hash = window.location.hash;
        const code = new URLSearchParams(window.location.search).get("code");
        const erroUrl =
          new URLSearchParams(window.location.search).get("error_description") ||
          new URLSearchParams(hash.replace(/^#/, "")).get("error_description");

        if (erroUrl) {
          setErro(decodeURIComponent(erroUrl.replace(/\+/g, " ")));
          setChecking(false);
          return;
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            setErro(`Este link não é mais válido: ${error.message}`);
            setChecking(false);
            return;
          }
          // Sessão criada; recomeça para seguir o fluxo normal.
          setTimeout(check, 50);
          return;
        }

        if (!hash.includes("access_token")) {
          setErro(
            "O link do convite não trouxe credencial nenhuma. Links de convite " +
            "valem uma vez só e expiram — peça um novo para quem te convidou.",
          );
          setChecking(false);
          return;
        }

        if (++tentativas >= MAX) {
          setErro(
            "Não conseguimos validar o link. Ele pode ter expirado ou já ter " +
            "sido usado. Peça um novo convite.",
          );
          setChecking(false);
          return;
        }

        setTimeout(check, 400);
        return;
      }

      setEmail(session.user.email ?? null);

      // Garante organização e papel do convite. Cobre o caso de quem JÁ tinha
      // conta: aí o trigger handle_new_user não roda, porque ele só dispara na
      // criação do usuário.
      let motivo: string | null = null;
      try {
        const r = await supabase.rpc("claim_pending_invitation");
        const d = r.data as { claimed?: boolean; reason?: string } | null;
        if (d && d.claimed === false) motivo = d.reason ?? null;
      } catch {
        // Função ausente no banco: segue, porque quem não tinha conta já foi
        // colocado na organização pelo trigger.
      }

      if (motivo === "user_already_in_active_org") {
        setErro(
          "Esta conta já pertence a outra empresa no CRM. Um administrador " +
          "precisa transferi-la — não dá para entrar em duas ao mesmo tempo.",
        );
        setChecking(false);
        return;
      }

      // Sem organização, o CRM não tem o que mostrar. Melhor dizer aqui.
      const { data: perfil } = await supabase
        .from("profiles").select("org_id").eq("id", session.user.id).maybeSingle();

      if (!perfil?.org_id) {
        setErro(
          "Você entrou, mas a conta não ficou ligada a nenhuma empresa. " +
          "Provavelmente o convite expirou antes do clique. Peça um novo.",
        );
        setChecking(false);
        return;
      }

      const metaName = (session.user.user_metadata as Record<string, string> | null)?.full_name;
      if (metaName) setName(metaName);
      setChecking(false);
    };

    check();
    return () => { cancelado = true; };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data: { user }, error } = await supabase.auth.updateUser({
        password,
        data: { full_name: name },
      });
      if (error) throw error;
      if (user) {
        await supabase.from("profiles").update({ name }).eq("id", user.id);
      }
      toast({ title: "Bem-vindo(a)!", description: "Sua conta está pronta." });
      navigate("/dashboard");
    } catch (err: unknown) {
      toast({
        title: "Erro ao concluir cadastro",
        description: mensagemErro(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (erro) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="font-heading text-xl">Não foi possível abrir o convite</CardTitle>
            <CardDescription className="pt-1 leading-relaxed">{erro}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={() => navigate("/")}>
              Ir para a tela de entrada
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Handshake className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="vx-titulo-tela">Você foi convidado(a)!</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-xl">Concluir cadastro</CardTitle>
            <CardDescription className="text-corpo">
              Defina seu nome e uma senha para acessar o CRM
              {email && <> — entrando como <span className="font-medium">{email}</span></>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-name">Nome completo</Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="invite-name"
                    placeholder="Seu nome"
                    className="pl-9"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-password">Senha</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="invite-password"
                    type="password"
                    placeholder="Mínimo 6 caracteres"
                    className="pl-9"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Salvando..." : "Entrar no CRM"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
