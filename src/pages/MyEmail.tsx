/**
 * "Meu e-mail" — cada pessoa conecta a PRÓPRIA conta do Gmail.
 *
 * Antes só existia o card da organização, dentro de rota de admin: um vendedor
 * não tinha como conectar a conta dele, e o índice único do banco fazia a
 * segunda pessoa a conectar derrubar a conexão da primeira.
 *
 * Esta tela é acessível a qualquer membro — é o ponto do Plano 2.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/hooks/useOrg";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Mail, Plug, Loader2, Unplug, ShieldCheck, TriangleAlert } from "lucide-react";

type MinhaConexao = {
  id: string;
  email_address: string;
  is_active: boolean | null;
  last_synced_at: string | null;
  connected_at: string | null;
  daily_send_limit: number;
  sent_today: number;
  sent_today_date: string | null;
};

export default function MyEmail() {
  const { user } = useAuth();
  const { orgId } = useOrg();
  const { toast } = useToast();

  const [conexao, setConexao] = useState<MinhaConexao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [conectando, setConectando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);

  const carregar = useCallback(async () => {
    if (!orgId || !user?.id) return;
    setCarregando(true);
    // A RLS já restringe ao próprio usuário; o filtro é para deixar explícito.
    const { data } = await supabase
      .from("email_connections")
      .select("id, email_address, is_active, last_synced_at, connected_at, daily_send_limit, sent_today, sent_today_date")
      .eq("org_id", orgId)
      .eq("user_id", user.id)
      .eq("scope_type", "user")
      .eq("is_active", true)
      .maybeSingle();
    setConexao((data as MinhaConexao) ?? null);
    setCarregando(false);
  }, [orgId, user?.id]);

  useEffect(() => { carregar(); }, [carregar]);

  async function conectar() {
    setConectando(true);
    try {
      const { data, error } = await supabase.functions.invoke("gmail-oauth-start", {
        body: {
          scope_type: "user",
          label: "Minha conta",
          return_to: `${window.location.origin}/settings/email`,
        },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("O servidor não devolveu a URL de autorização.");
      window.location.href = data.url as string;
    } catch (e) {
      toast({
        title: "Não foi possível iniciar a conexão",
        description: (e as Error).message,
        variant: "destructive",
      });
      setConectando(false);
    }
  }

  async function desconectar() {
    if (!conexao) return;
    setDesconectando(true);
    try {
      const { error } = await supabase.functions.invoke("gmail-disconnect", {
        body: { email: conexao.email_address },
      });
      if (error) throw error;
      toast({ title: "Conta desconectada" });
      await carregar();
    } catch (e) {
      toast({
        title: "Erro ao desconectar",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setDesconectando(false);
    }
  }

  // O contador só vale para hoje; em outro dia o teto já reiniciou.
  const enviadosHoje =
    conexao && conexao.sent_today_date === new Date().toISOString().slice(0, 10)
      ? conexao.sent_today
      : 0;
  const teto = conexao?.daily_send_limit ?? 0;
  const percentual = teto > 0 ? Math.min(100, Math.round((enviadosHoje / teto) * 100)) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Mail}
        kicker="Minha conta"
        title="Meu e-mail"
        description="Conecte sua conta para enviar e receber pelo seu próprio endereço"
      />

      {carregando ? (
        <Skeleton className="h-[168px] rounded-lg" />
      ) : conexao ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-sm">{conexao.email_address}</CardTitle>
                <CardDescription className="text-[11px]">
                  {conexao.last_synced_at
                    ? `Última sincronização ${new Date(conexao.last_synced_at).toLocaleString("pt-BR")}`
                    : "Ainda não sincronizada"}
                </CardDescription>
              </div>
              <Badge className="shrink-0 text-[9px]">Conectada</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="font-medium">Envios hoje</span>
                <span className="text-muted-foreground tabular-nums">
                  {enviadosHoje} de {teto}
                </span>
              </div>
              <Progress value={percentual} className="h-1.5" />
              <p className="text-[10px] text-muted-foreground">
                O limite diário protege a reputação do domínio e a cota do Gmail. Reinicia todo dia.
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive/5 hover:text-destructive"
              onClick={desconectar}
              disabled={desconectando}
            >
              {desconectando
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                : <Unplug className="mr-1.5 h-3.5 w-3.5" />}
              Desconectar
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Plug className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-heading text-base font-semibold">Nenhuma conta conectada</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Ao conectar, os e-mails trocados com seus contatos aparecem na ficha deles, e o que
                você enviar pelo CRM sai do seu próprio endereço.
              </p>
            </div>
            <Button onClick={conectar} disabled={conectando}>
              {conectando
                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                : <Mail className="mr-1.5 h-4 w-4" />}
              Conectar meu Gmail
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span>
          Sua caixa é sua: ninguém da equipe vê seus e-mails nem suas conversas. Só os números
          agregados aparecem no painel, sem identificar de quem é cada um.
        </span>
      </div>

      {!conexao && !carregando && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>
            Enquanto sua conta não estiver conectada, o CRM não consegue enviar e-mail em seu nome —
            inclusive os passos de automação e sequência dos leads sob sua responsabilidade.
          </span>
        </div>
      )}
    </div>
  );
}
