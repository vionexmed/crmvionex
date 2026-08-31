import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { Button } from "@/components/ui/button";
import { Instagram, ExternalLink, AlertTriangle } from "lucide-react";
import { CartaoDeIntegracao, type EstadoIntegracao } from "@/components/integrations/CartaoDeIntegracao";
import { useToast } from "@/hooks/use-toast";
import { mensagemErro } from "@/lib/erro-supabase";
import { formatarData } from "@/lib/formato";

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
};

export function InstagramCard() {
  const { orgId } = useOrg();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [conexao, setConexao] = useState<Conexao | null>(null);
  const [vencimento, setVencimento] = useState<string | null>(null);
  const [conectando, setConectando] = useState(false);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (!orgId) return;
    setCarregando(true);
    try {
      const { data } = await supabase
        .from("instagram_connections")
        .select("id, username, display_name, is_active, connected_at")
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
      const { data, error } = await supabase.functions.invoke("instagram-oauth-start");
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || "O servidor não devolveu a URL de autorização");
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

  const ligado = !!conexao;
  const estado: EstadoIntegracao = ligado ? "ativo" : "disponivel";

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
            : "Receba e responda Direct do perfil da empresa"
      }
      estado={estado}
      acoes={
        ligado ? (
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-8 text-label" onClick={conectar}
              disabled={conectando}>
              Reconectar
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-label text-muted-foreground"
              onClick={desconectar}>
              Desconectar
            </Button>
          </div>
        ) : (
          <Button size="sm" className="h-8 text-label" onClick={conectar} disabled={conectando}>
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
