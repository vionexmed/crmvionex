import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { Button } from "@/components/ui/button";
import { Instagram, ExternalLink, AlertTriangle, Copy, Check } from "lucide-react";
import { CartaoDeIntegracao, type EstadoIntegracao } from "@/components/integrations/CartaoDeIntegracao";
import { useToast } from "@/hooks/use-toast";
import { mensagemErro, erroDaFuncao } from "@/lib/erro-supabase";
import { formatarData } from "@/lib/formato";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/**
 * Cartão do Instagram Direct.
 *
 * Mais simples que o do WhatsApp de propósito: ali há duas rotas (API oficial e
 * QR code) e a escolha vive dentro do cartão. Aqui há uma só, então o cartão é
 * o estado e um botão.
 *
 * O QUE ELE PRECISA DIZER, porque o Instagram tem limites que surpreendem quem
 * vem do WhatsApp:
 *
 * - não se INICIA conversa. Só responde a quem escreveu;
 * - a janela é de 24h para resposta livre, 7 dias com atendimento humano;
 * - o token vence em 60 dias e é renovável.
 *
 * O terceiro é o que mata a integração em silêncio, e é por isso que o cartão
 * mostra a data de vencimento em vez de guardá-la só no banco.
 */

/** Tradução dos códigos que o callback devolve na URL. */
const MOTIVOS: Record<string, string> = {
  state_expirou: "A autorização demorou demais. Tente de novo.",
  state_invalido: "A resposta do Instagram não pôde ser validada. Tente de novo.",
  faltou_codigo: "O Instagram não devolveu o código de autorização.",
  app_nao_configurado:
    "Faltam INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET nos secrets do projeto.",
  troca_falhou: "O Instagram recusou a troca do código por token.",
  gravar_conexao: "A conta foi autorizada mas não foi possível salvar a conexão.",
  gravar_segredo: "A conta foi autorizada mas não foi possível salvar a credencial.",
  webhook_nao_assinado:
    "A conta conectou, mas o CRM não conseguiu assinar o recebimento de mensagens. " +
    "Dá para enviar; não dá para receber. Reconecte para tentar de novo.",
  instagram_recusou: "O Instagram recusou a autorização.",
  erro_inesperado: "Algo falhou no meio do caminho.",
};

type Conexao = {
  id: string;
  username: string | null;
  display_name: string | null;
  is_active: boolean;
  connected_at: string;
  webhook_verify_token: string;
};

export function InstagramCard() {
  const { orgId } = useOrg();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [conexao, setConexao] = useState<Conexao | null>(null);
  const [vencimento, setVencimento] = useState<string | null>(null);
  const [conectando, setConectando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [copiado, setCopiado] = useState<string | null>(null);
  /*
   * O SERVIDOR TEM AS CREDENCIAIS DO APP?
   *
   * `null` = ainda perguntando. Sem esta pergunta o cartão dizia "Disponível" e
   * oferecia "Conectar" mesmo quando o fluxo não tinha como terminar -- e o erro
   * de configuração aparecia só depois do clique, parecendo defeito da
   * integração quando é etapa que ninguém fez ainda.
   *
   * Vem do servidor porque é lá que os secrets moram. O navegador não tem como
   * saber, e não deve: a resposta é um BOOLEANO, nunca os valores.
   */
  const [appConfigurado, setAppConfigurado] = useState<boolean | null>(null);

  const carregar = useCallback(async () => {
    if (!orgId) return;
    setCarregando(true);
    try {
      const { data } = await supabase
        .from("instagram_connections")
        .select("id, username, display_name, is_active, connected_at, webhook_verify_token")
        .eq("org_id", orgId)
        .eq("is_active", true)
        .order("connected_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      setConexao((data as Conexao | null) ?? null);

      /*
       * O VENCIMENTO VEM DE UMA FUNÇÃO, não de um SELECT em
       * `instagram_secrets`.
       *
       * Aquela tabela tem RLS ligada e ZERO policy — de propósito, é onde o
       * token mora. Ler dali pelo navegador devolveria vazio, e o cartão diria
       * "sem vencimento" para uma conexão perfeitamente válida: um sintoma que
       * parece defeito da conexão e é defeito da consulta.
       */
      if (data?.id) {
        const { data: v } = await supabase
          .rpc("instagram_token_vence_em", { _connection_id: data.id as string });
        setVencimento((v as string | null) ?? null);
      } else {
        setVencimento(null);
      }
    } finally {
      setCarregando(false);
    }
  }, [orgId]);

  useEffect(() => { void carregar(); }, [carregar]);

  useEffect(() => {
    void (async () => {
      const res = await supabase.functions.invoke("instagram-oauth-start", {
        body: { verificar: true },
      });
      // Falha na pergunta não vira alarme: cai em "não sei" e o cartão continua
      // oferecendo o botão, que aí explica o motivo real se falhar.
      setAppConfigurado((res.data as { configurado?: boolean } | null)?.configurado ?? null);
    })();
  }, []);

  /**
   * Lê o resultado do OAuth da URL e o limpa.
   *
   * Limpar importa: sem isso um F5 na página repete o aviso, e a pessoa acha que
   * conectou duas vezes.
   */
  useEffect(() => {
    const resultado = params.get("instagram");
    if (!resultado) return;

    const motivo = params.get("motivo");
    const detalhe = params.get("detalhe");
    const conta = params.get("conta");

    if (resultado === "ok") {
      toast({
        title: "Instagram conectado",
        description: conta ? `@${conta} já recebe e responde Direct pelo CRM.` : undefined,
      });
      void carregar();
    } else if (resultado === "parcial") {
      toast({
        title: "Conectado pela metade",
        description: MOTIVOS[motivo ?? ""] ?? detalhe ?? "Envio funciona, recebimento não.",
        variant: "destructive",
      });
      void carregar();
    } else if (resultado === "cancelado") {
      toast({ title: "Autorização cancelada", description: "Nada foi alterado." });
    } else {
      toast({
        title: "Não foi possível conectar",
        description: MOTIVOS[motivo ?? ""] ?? detalhe ?? "Tente de novo.",
        variant: "destructive",
      });
    }

    const limpo = new URLSearchParams(params);
    for (const k of ["instagram", "motivo", "detalhe", "conta"]) limpo.delete(k);
    setParams(limpo, { replace: true });
  }, [params, setParams, toast, carregar]);

  const conectar = async () => {
    setConectando(true);
    try {
      const res = await supabase.functions.invoke("instagram-oauth-start");
      /*
       * `erroDaFuncao` e não `res.error` direto: o `invoke` não lê o corpo em
       * status não-2xx, então "Falta configurar INSTAGRAM_APP_ID" chegaria aqui
       * como "Edge Function returned a non-2xx status code" -- uma frase que não
       * diz o que fazer e faz a pessoa clicar de novo.
       */
      const motivo = await erroDaFuncao(res);
      if (motivo) throw new Error(motivo);
      const data = res.data as { url?: string } | null;
      if (!data?.url) throw new Error("O servidor não devolveu a URL de autorização");
      // `assign` e não `open`: bloqueador de pop-up mataria a janela nova, e o
      // fluxo volta para cá pelo redirecionamento do callback.
      window.location.assign(data.url as string);
    } catch (e) {
      toast({ title: "Erro ao iniciar conexão", description: mensagemErro(e), variant: "destructive" });
      setConectando(false);
    }
  };

  const desconectar = async () => {
    if (!conexao) return;
    try {
      /*
       * `is_active = false` em vez de DELETE.
       *
       * Apagar a conexão levaria as mensagens com ela — `instagram_messages`
       * aponta para cá — e o histórico de atendimento não deve depender de a
       * conta continuar ligada. O segredo, porém, sai: token guardado de conta
       * desconectada é credencial viva sem dono.
       */
      const { error } = await supabase
        .from("instagram_connections")
        .update({ is_active: false })
        .eq("id", conexao.id);
      if (error) throw error;

      toast({
        title: "Instagram desconectado",
        description: "O histórico das conversas continua no CRM.",
      });
      void carregar();
    } catch (e) {
      toast({ title: "Erro ao desconectar", description: mensagemErro(e), variant: "destructive" });
    }
  };

  const copiar = async (rotulo: string, valor: string) => {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(rotulo);
      setTimeout(() => setCopiado(null), 1800);
    } catch {
      // Área de transferência bloqueada (acontece em http, e em iframe sem
      // permissão). O valor está selecionável na tela, então não é impasse.
      toast({ title: "Não consegui copiar", description: "Selecione e copie à mão.", variant: "destructive" });
    }
  };

  const urlDoWebhook = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/instagram-webhook`;

  const ligado = !!conexao;
  const faltaCredencial = appConfigurado === false;
  const estado: EstadoIntegracao = ligado
    ? "ativo"
    // "não integrado" e não "disponível": é âmbar, e diz que falta uma etapa em
    // vez de convidar a clicar. Mesmo tratamento do cartão do Google Ads.
    : faltaCredencial ? "nao-integrado" : "disponivel";

  // Vencimento em menos de sete dias merece aviso: o token é renovável, mas se
  // ninguém renovar a integração morre sem sintoma até alguém tentar responder.
  const diasParaVencer = vencimento
    ? Math.ceil((new Date(vencimento).getTime() - Date.now()) / 86_400_000)
    : null;
  const vencendo = diasParaVencer !== null && diasParaVencer <= 7;

  return (
    <CartaoDeIntegracao
      icone={Instagram}
      nome="Instagram Direct"
      descricao={
        carregando
          ? "Verificando…"
          : ligado
            ? `@${conexao?.username ?? "conta conectada"} · responde Direct pelo CRM`
            : faltaCredencial
              ? "Faltam as credenciais do app da Meta"
              : "Receba e responda Direct do perfil da empresa"
      }
      estado={estado}
      acoes={
        ligado ? (
          <div className="flex items-center gap-1.5">
            {/*
              A ÚLTIMA ETAPA, e sem ela nada chega.
              Autorizar por OAuth assina a CONTA no app (`subscribed_apps`), mas
              a URL do webhook e o token de verificação são configuração do APP,
              no painel da Meta -- e o token é gerado aqui, por conexão. Sem
              entregá-lo na tela, a integração fica pela metade e o sintoma é o
              pior possível: envio funciona, recebimento não.
            */}
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-label">
                  Webhook
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Configurar o webhook no painel da Meta</DialogTitle>
                  <DialogDescription>
                    Em <strong>developers.facebook.com</strong> → seu app → Instagram →
                    Configuração de webhooks. Cole os dois valores abaixo e assine o
                    campo <strong>messages</strong>.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  {[
                    { rotulo: "URL de callback", valor: urlDoWebhook },
                    { rotulo: "Token de verificação", valor: conexao?.webhook_verify_token ?? "" },
                  ].map((campo) => (
                    <div key={campo.rotulo} className="space-y-1">
                      <p className="text-label font-medium text-muted-foreground">{campo.rotulo}</p>
                      <div className="flex items-center gap-1.5">
                        <code className="flex-1 truncate rounded-md border border-border bg-muted px-2 py-1.5 text-xs">
                          {campo.valor}
                        </code>
                        <Button variant="outline" size="sm" className="h-8 w-8 shrink-0 p-0"
                          onClick={() => void copiar(campo.rotulo, campo.valor)}
                          title={`Copiar ${campo.rotulo}`}>
                          {copiado === campo.rotulo
                            ? <Check className="h-3.5 w-3.5 text-success" />
                            : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>
                  ))}
                  <p className="text-meta leading-relaxed text-muted-foreground">
                    O token de verificação só serve para o aperto de mão inicial. Cada mensagem
                    que chega é conferida por assinatura, com um segredo que não sai do servidor —
                    então este valor não é credencial de acesso.
                  </p>
                </div>
              </DialogContent>
            </Dialog>
            <Button variant="outline" size="sm" className="h-8 text-label" onClick={conectar}
              disabled={conectando}>
              Reconectar
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-label text-muted-foreground"
              onClick={desconectar}>
              Desconectar
            </Button>
          </div>
        ) : faltaCredencial ? null : (
          <Button size="sm" className="h-8 text-label" onClick={conectar}
            disabled={conectando || appConfigurado === null}>
            {conectando ? "Abrindo…" : "Conectar"}
            <ExternalLink className="ml-1.5 h-3 w-3" />
          </Button>
        )
      }
      nota={
        ligado ? (
          <div className="space-y-1">
            {vencendo && (
              <p className="flex items-start gap-1.5 text-warning">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  A credencial vence em {diasParaVencer} dia{diasParaVencer === 1 ? "" : "s"}
                  {vencimento ? ` (${formatarData(vencimento)})` : ""}. Clique em Reconectar para renovar.
                </span>
              </p>
            )}
            <p>
              O Instagram não permite <strong>iniciar</strong> conversa: o CRM responde quem
              escreveu, em até 24h livremente e até 7 dias com atendimento humano.
            </p>
          </div>
        ) : faltaCredencial ? (
          <div className="space-y-1">
            <p className="flex items-start gap-1.5 text-warning">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Um administrador precisa criar o app no{" "}
                <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer"
                  className="underline">painel da Meta</a>{" "}
                e gravar <code className="text-meta">INSTAGRAM_APP_ID</code> e{" "}
                <code className="text-meta">INSTAGRAM_APP_SECRET</code> nos secrets do projeto.
              </span>
            </p>
            <p>
              No app, use <strong>API com login do Instagram</strong> — é a rota que dispensa
              Página do Facebook. As credenciais ficam em Instagram → Configuração básica da API,
              e <strong>não</strong> são as do app do Facebook.
            </p>
          </div>
        ) : (
          <p>
            Precisa de conta profissional do Instagram. <strong>Não</strong> precisa de Página do
            Facebook vinculada.
          </p>
        )
      }
    />
  );
}
