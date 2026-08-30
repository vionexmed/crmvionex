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
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/hooks/useOrg";
import { useToast } from "@/hooks/use-toast";
import { emailsKeys } from "@/hooks/queries/useEmails";
import { MinhaAssinatura } from "@/components/settings/MinhaAssinatura";
import { PageShell } from "@/components/layout/PageShell";
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
  invalid_since: string | null;
  invalid_reason: string | null;
};

/**
 * O banco guarda CÓDIGO em invalid_reason, não frase — texto em português dentro
 * de migração fica congelado. A tradução mora aqui.
 */
const MOTIVO: Record<string, { titulo: string; explicacao: string }> = {
  credenciais_trocadas: {
    titulo: "Sua conexão precisa ser renovada",
    explicacao:
      "A credencial do Google da empresa foi trocada. Por segurança, o Google invalida os acessos "
      + "emitidos com a credencial anterior — nada de errado aconteceu com a sua conta.",
  },
  token_revogado: {
    titulo: "O acesso da sua conta foi revogado",
    explicacao:
      "Isso acontece quando a permissão é retirada na conta Google, a senha muda, ou o acesso "
      + "fica muito tempo sem uso.",
  },
  refresh_invalido: {
    titulo: "Não conseguimos renovar o acesso",
    explicacao: "O Google recusou a renovação por um motivo que não soubemos classificar.",
  },
};

/**
 * Motivos que o callback do OAuth devolve na URL.
 *
 * O callback NÃO renderiza página: a plataforma de Edge Functions rebaixa
 * text/html para text/plain, então o HTML aparecia como código-fonte. Ele
 * redireciona para cá com o código do motivo, e a tradução mora aqui — mesmo
 * princípio do invalid_reason.
 */
const MOTIVO_CALLBACK: Record<string, string> = {
  state_expirado:
    "A autorização demorou mais que a janela permitida. Clique em Conectar de novo — você tem 30 minutos.",
  state_assinatura:
    "O link de autorização não confere. Isso costuma ser link reaproveitado de uma tentativa antiga. Comece de novo.",
  state_formato: "O link de autorização veio incompleto. Comece de novo.",
  state_erro: "Não foi possível ler o link de autorização. Comece de novo.",
  google_recusou: "O Google recusou a autorização.",
  parametros_invalidos: "O retorno do Google veio incompleto. Tente de novo.",
  sem_credencial:
    "A credencial do Google da empresa não está cadastrada. Peça a um administrador.",
  codigo_usado_ou_expirado:
    "O Google recusou o código de autorização (invalid_grant). Quase sempre é código já usado — acontece ao recarregar a página de retorno, voltar no navegador ou reaproveitar um link antigo. Comece de novo pelo botão Conectar, numa aba só.",
  uri_divergente:
    "O endereço de retorno cadastrado no Google Cloud não é o mesmo que o CRM usa. Um administrador precisa conferir a URI de redirecionamento autorizada.",
  credencial_recusada:
    "O Google não reconheceu a credencial da empresa. Um administrador precisa recadastrá-la em Integrações.",
  troca_de_token:
    "O Google recusou a troca do código de autorização. Se persistir, a credencial da empresa pode estar desatualizada.",
  sem_email: "Não foi possível ler o endereço da conta Google autorizada.",
  falha_ao_salvar: "A autorização funcionou, mas não conseguimos guardar o acesso. Tente de novo.",
  erro_inesperado: "Algo deu errado ao concluir a conexão.",
};

const motivoDe = (codigo: string | null) =>
  (codigo && MOTIVO[codigo]) || {
    titulo: "Sua conexão precisa ser renovada",
    explicacao: "O acesso ao Gmail deixou de funcionar.",
  };

/** A API de Edge Functions devolve o JSON da falha em `context`; sem ler esse
 * corpo, a tela mostrava apenas "Edge Function returned a non-2xx status code".
 */
async function mensagemDaFalha(e: unknown): Promise<string> {
  const resposta = (e as { context?: unknown })?.context;
  if (resposta instanceof Response) {
    const corpo = await resposta.clone().json().catch((): null => null) as { message?: unknown; error?: unknown } | null;
    if (typeof corpo?.message === "string") return corpo.message;
    if (typeof corpo?.error === "string") return corpo.error;
  }
  return e instanceof Error ? e.message : "Não foi possível iniciar a conexão.";
}

export default function MyEmail() {
  const { user } = useAuth();
  const { orgId } = useOrg();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

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
      .select("id, email_address, is_active, last_synced_at, connected_at, daily_send_limit, sent_today, sent_today_date, invalid_since, invalid_reason")
      .eq("org_id", orgId)
      .eq("user_id", user.id)
      .eq("scope_type", "user")
      .eq("is_active", true)
      .maybeSingle();
    setConexao((data as MinhaConexao) ?? null);
    setCarregando(false);

    // A Inbox e o compositor decidem se há conta conectada por uma consulta de
    // react-query com staleTime de 60s. Esta tela usa estado local, então sem
    // invalidar a chave a pessoa conectava aqui e a Inbox continuava dizendo
    // "nenhuma conta conectada" por até um minuto — parecia que não funcionou.
    if (orgId) queryClient.invalidateQueries({ queryKey: emailsKeys.connections(orgId) });
  }, [orgId, user?.id, queryClient]);

  useEffect(() => { carregar(); }, [carregar]);

  // Ler → agir → limpar: sem remover os parâmetros, recarregar a página
  // repetiria o aviso como se tivesse acontecido de novo.
  useEffect(() => {
    const resultado = searchParams.get("gmail");
    if (!resultado) return;

    if (resultado === "conectado") {
      toast({
        title: "Gmail conectado",
        description: searchParams.get("conta") ?? undefined,
      });
    } else {
      const codigo = searchParams.get("motivo") ?? "";
      const detalhe = searchParams.get("detalhe");
      toast({
        title: "Não foi possível conectar",
        description:
          (MOTIVO_CALLBACK[codigo] ?? "A conexão com o Gmail não foi concluída.")
          + (detalhe ? ` (${detalhe})` : ""),
        variant: "destructive",
      });
    }

    searchParams.delete("gmail");
    searchParams.delete("motivo");
    searchParams.delete("conta");
    searchParams.delete("detalhe");
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, toast]);

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
        description: await mensagemDaFalha(e),
        variant: "destructive",
      });
      setConectando(false);
    }
  }

  async function desconectar() {
    if (!conexao) return;
    setDesconectando(true);
    try {
      // connection_id, não email: é o que a função exige. Mandando `email` ela
      // respondia 400 "connection_id required" — o botão nunca funcionou.
      const { error } = await supabase.functions.invoke("gmail-disconnect", {
        body: { connection_id: conexao.id },
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
    <PageShell
      icon={Mail}
      kicker="Minha conta"
      title="Meu e-mail"
      description="Conecte sua conta para enviar e receber pelo seu próprio endereço"
    >


      {carregando ? (
        <Skeleton className="h-[168px] rounded-lg" />
      ) : conexao ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>{conexao.email_address}</CardTitle>
                <CardDescription>
                  {conexao.last_synced_at
                    ? `Última sincronização ${new Date(conexao.last_synced_at).toLocaleString("pt-BR")}`
                    : "Ainda não sincronizada"}
                </CardDescription>
              </div>
              {conexao.invalid_since ? (
                <Badge variant="destructive" className="shrink-0 text-micro">Precisa reconectar</Badge>
              ) : (
                <Badge className="shrink-0 text-micro">Conectada</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Sem isto, conexão morta aparecia como conectada e o e-mail
                simplesmente não saía — a pessoa não tinha como saber por quê. */}
            {conexao.invalid_since && (
              <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-medium text-destructive">
                      {motivoDe(conexao.invalid_reason).titulo}
                    </p>
                    <p className="text-meta leading-relaxed text-muted-foreground">
                      {motivoDe(conexao.invalid_reason).explicacao}
                    </p>
                    <p className="text-label text-muted-foreground">
                      Desde {new Date(conexao.invalid_since).toLocaleString("pt-BR")}. Enquanto
                      isso, e-mail enviado por você e pelas automações dos seus leads não sai.
                    </p>
                  </div>
                </div>
                <Button size="sm" className="h-7 text-meta" onClick={conectar} disabled={conectando}>
                  {conectando
                    ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    : <Plug className="mr-1.5 h-3 w-3" />}
                  Reconectar agora
                </Button>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between text-meta">
                <span className="font-medium">Envios hoje</span>
                <span className="text-muted-foreground tabular-nums">
                  {enviadosHoje} de {teto}
                </span>
              </div>
              <Progress value={percentual} className="h-1.5" />
              <p className="text-label text-muted-foreground">
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

      {/* A assinatura só faz sentido com conta conectada: ela é gravada na
          conexão, e sem conta não há onde guardar nem de onde sair. */}
      {conexao && !carregando && (
        <MinhaAssinatura connectionId={conexao.id} emailDaConta={conexao.email_address} />
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
    </PageShell>
  );
}
