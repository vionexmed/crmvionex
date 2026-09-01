import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExternalLink, AlertTriangle, Copy, Check, Settings2 } from "lucide-react";
import { LogoInstagram } from "@/components/integrations/logos-de-integracao";
import { CartaoDeIntegracao, type EstadoIntegracao } from "@/components/integrations/CartaoDeIntegracao";
import { useToast } from "@/hooks/use-toast";
import { mensagemErro, erroDaFuncao } from "@/lib/erro-supabase";
import { formatarData } from "@/lib/formato";
import { PainelDeIntegracao } from "@/components/integrations/PainelDeIntegracao";
import { useContextoDoPainel } from "@/components/integrations/contexto-do-painel";

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

/**
 * Valor para copiar: a URL, o token, o nome do secret.
 *
 * DUAS COISAS QUE PARECEM DETALHE E NÃO SÃO:
 *
 * 1. `min-w-0` NO ITEM DE GRID. O `DialogContent` deste projeto é
 *    `grid w-full max-w-lg`, e item de grid nasce com `min-width: auto` -- então
 *    a trilha cresce até a largura do conteúdo, e o conteúdo escapa dos 512px do
 *    diálogo. Foi o que fez a URL e o botão de copiar aparecerem FORA da caixa
 *    branca. `min-w-0` no que está dentro do flex não resolve: o estouro
 *    acontece um nível acima, na trilha do grid.
 *
 * 2. QUEBRA, e não `truncate`. Cortar com "…" uma URL que a pessoa precisa
 *    CONFERIR antes de colar no painel da Meta é hostil -- ela vê metade e não
 *    tem como saber se é a certa. `break-all` deixa a URL inteira legível em
 *    duas linhas, e como nada mais exige largura, nada estoura.
 */
function ValorParaCopiar({
  rotulo,
  valor,
  copiado,
  onCopiar,
}: {
  rotulo: string;
  valor: string;
  copiado: string | null;
  onCopiar: (rotulo: string, valor: string) => void;
}) {
  return (
    <div className="flex min-w-0 items-start gap-1.5">
      <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-muted px-2 py-1.5 text-xs leading-snug">
        {valor}
      </code>
      <Button variant="outline" size="sm" className="h-8 w-8 shrink-0 p-0"
        onClick={() => onCopiar(rotulo, valor)}
        title={`Copiar ${rotulo}`}>
        {copiado === rotulo
          ? <Check className="h-3.5 w-3.5 text-success" />
          : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

/** `aoMudarEstado`: ver o mesmo comentário em WhatsAppCard. */
export function InstagramCard({ aoMudarEstado }: { aoMudarEstado?: (e: EstadoIntegracao) => void } = {}) {
  const { orgId } = useOrg();
  const { abrir } = useContextoDoPainel();
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
  /** De onde vem a credencial: 'crm' dá para editar pela tela, 'ambiente' não. */
  const [origemCredencial, setOrigemCredencial] = useState<string | null>(null);
  const [formAppId, setFormAppId] = useState("");
  const [formSegredo, setFormSegredo] = useState("");
  const [salvando, setSalvando] = useState(false);

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
      const d = res.data as { configurado?: boolean; origem?: string } | null;
      setAppConfigurado(d?.configurado ?? null);
      setOrigemCredencial(d?.origem ?? null);
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

  /**
   * Cadastra a credencial do app PELA TELA.
   *
   * Vai para `instagram_app_secrets`, que tem RLS ligada e ZERO policies -- o
   * mesmo compartimento de `google_oauth_secrets`. É o que permite cadastrar
   * aqui sem o segredo voltar para o navegador: a função responde com o app_id,
   * que é público, e nunca com a chave.
   *
   * A alternativa era mandar a pessoa ao painel do Supabase, que é o que eu havia
   * feito -- e o projeto já tinha resolvido isso melhor para o Google.
   */
  const salvarCredencial = async () => {
    setSalvando(true);
    try {
      const res = await supabase.functions.invoke("instagram-credentials-save", {
        body: { app_id: formAppId.trim(), app_secret: formSegredo.trim() },
      });
      const motivo = await erroDaFuncao(res);
      if (motivo) throw new Error(motivo);

      // O campo do segredo é limpo SEMPRE. Deixá-lo preenchido sugere que dá
      // para relê-lo depois, e não dá — nem para quem acabou de salvá-lo.
      setFormSegredo("");
      setAppConfigurado(true);
      setOrigemCredencial("crm");
      toast({
        title: "Credencial salva",
        description: "Já dá para conectar a conta do Instagram.",
      });
    } catch (e) {
      toast({ title: "Não foi possível salvar", description: mensagemErro(e), variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  const removerCredencial = async () => {
    setSalvando(true);
    try {
      const res = await supabase.functions.invoke("instagram-credentials-save", {
        body: { remover: true },
      });
      const motivo = await erroDaFuncao(res);
      if (motivo) throw new Error(motivo);
      const d = res.data as { origem?: string; contas_afetadas?: number } | null;
      setAppConfigurado(d?.origem !== "nenhum");
      setOrigemCredencial(d?.origem ?? null);
      setFormAppId("");
      toast({
        title: "Credencial removida",
        description: (d?.contas_afetadas ?? 0) > 0
          ? `${d?.contas_afetadas} conta(s) conectada(s) param de receber até uma credencial nova.`
          : undefined,
      });
    } catch (e) {
      toast({ title: "Não foi possível remover", description: mensagemErro(e), variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

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
  const urlDoCallback = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/instagram-oauth-callback`;

  const ligado = !!conexao;
  const faltaCredencial = appConfigurado === false;
  const estado: EstadoIntegracao = ligado
    ? "ativo"
    // "não integrado" e não "disponível": é âmbar, e diz que falta uma etapa em
    // vez de convidar a clicar. Mesmo tratamento do cartão do Google Ads.
    : faltaCredencial ? "nao-integrado" : "disponivel";

  useEffect(() => { aoMudarEstado?.(estado); }, [estado, aoMudarEstado]);

  // Vencimento em menos de sete dias merece aviso: o token é renovável, mas se
  // ninguém renovar a integração morre sem sintoma até alguém tentar responder.
  const diasParaVencer = vencimento
    ? Math.ceil((new Date(vencimento).getTime() - Date.now()) / 86_400_000)
    : null;
  const vencendo = diasParaVencer !== null && diasParaVencer <= 7;

  return (
    <>
      <CartaoDeIntegracao
        icone={LogoInstagram}
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
        aoConfigurar={() => abrir("instagram")}
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
              <Button variant="outline" size="sm" className="h-8 text-label"
                onClick={() => abrir("instagram")}>
                <Settings2 className="mr-1 h-3.5 w-3.5" />Webhook
              </Button>
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
            <div className="flex items-center gap-1.5">
              {!faltaCredencial && (
                <Button size="sm" className="h-8 text-label" onClick={conectar}
                  disabled={conectando || appConfigurado === null}>
                  {conectando ? "Abrindo…" : "Conectar"}
                  <ExternalLink className="ml-1.5 h-3 w-3" />
                </Button>
              )}
              <Button variant={faltaCredencial ? "outline" : "ghost"} size="sm"
                className="h-8 text-label" onClick={() => abrir("instagram")}>
                <Settings2 className="mr-1 h-3.5 w-3.5" />
                {faltaCredencial ? "Como configurar" : "Credenciais"}
              </Button>
            </div>
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
            /* UMA linha. O passo a passo está no diálogo do botão "Como configurar":
               quatro linhas de instrução aqui faziam este cartão ocupar o dobro dos
               vizinhos, que é o problema que o cartão do Google já teve. */
            <p>Um administrador cria o app na Meta uma vez, e a equipe conecta depois.</p>
          ) : (
            <p>
              Precisa de conta profissional do Instagram. <strong>Não</strong> precisa de Página do
              Facebook vinculada.
            </p>
          )
        }
      />

      {/*
        UM PAINEL SÓ, e não dois diálogos.

        Eram dois `<Dialog>` sem estado, disparados por botões diferentes do
        rodapé -- "Webhook" quando ligado, "Credenciais" quando não. Duas portas
        para a mesma configuração, e nenhuma das duas se parecia com a das
        outras cinco integrações.

        O corpo troca conforme o estado porque as duas metades não convivem:
        antes de conectar não existe token de webhook para copiar, e depois de
        conectar os quatro passos do painel da Meta já foram dados.

        Sem rodapé: o formulário de credenciais tem o próprio botão de salvar,
        que valida contra a Meta antes de gravar.
      */}
      <PainelDeIntegracao
        chave="instagram"
        nome="Instagram Direct"
        icone={LogoInstagram}
        descricao={ligado ? `@${conexao?.username ?? "conta conectada"}` : "Direct do perfil da empresa"}
        estado={estado}
      >
        {ligado ? (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Em <strong>developers.facebook.com</strong> → seu app → Instagram →
              Configuração de webhooks. Cole os dois valores abaixo e assine o
              campo <strong>messages</strong>.
            </p>
          <div className="min-w-0 space-y-3">
            {[
              { rotulo: "URL de callback", valor: urlDoWebhook },
              { rotulo: "Token de verificação", valor: conexao?.webhook_verify_token ?? "" },
            ].map((campo) => (
              <div key={campo.rotulo} className="min-w-0 space-y-1">
                <p className="text-label font-medium text-muted-foreground">{campo.rotulo}</p>
                <ValorParaCopiar rotulo={campo.rotulo} valor={campo.valor}
                  copiado={copiado} onCopiar={copiar} />
              </div>
            ))}
            <p className="text-meta leading-relaxed text-muted-foreground">
              O token de verificação só serve para o aperto de mão inicial. Cada mensagem
              que chega é conferida por assinatura, com um segredo que não sai do servidor —
              então este valor não é credencial de acesso.
            </p>
          </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Quatro passos no painel da Meta, uma vez só — e as credenciais você cola
              aqui embaixo. Depois disso qualquer administrador conecta a conta.
            </p>
          <ol className="min-w-0 space-y-2.5 text-xs leading-relaxed">
            <li>
              <strong>1.</strong> Em{" "}
              <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer"
                className="text-primary underline">developers.facebook.com/apps</a>, crie um app:
              caso de uso <strong>Outro</strong>, tipo <strong>Empresa</strong>.
            </li>
            <li>
              <strong>2.</strong> Adicione o produto <strong>Instagram</strong> e escolha{" "}
              <strong>API com login do Instagram</strong> — é a rota que dispensa Página do
              Facebook.
            </li>
            <li>
              <strong>3.</strong> Em <strong>Instagram → Configuração básica da API</strong>,
              copie o ID e a chave secreta.
              <span className="mt-1 flex items-start gap-1.5 text-meta text-warning">
                {/* `<span>` aqui é correto: só há texto e ícone dentro. */}
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Não são as de Configurações → Básico, que são do app do Facebook. São
                credenciais diferentes, e as erradas falham na troca de token sem explicar.
              </span>
            </li>
            <li>
              <strong>4.</strong> Ainda ali, em URIs de redirecionamento OAuth, cole:
              <div className="mt-1">
                <ValorParaCopiar rotulo="Redirect URI" valor={urlDoCallback}
                  copiado={copiado} onCopiar={copiar} />
              </div>
            </li>
          </ol>

          {/*
            O PASSO 5 ERA "vá ao painel do Supabase e grave dois secrets".
            Virou este formulário, e a diferença não é conveniência: o projeto
            já tinha resolvido isso para o Google (`google_oauth_secrets`), e
            mandar a pessoa a outro painel quando a tela pode receber é
            inconsistência.
            O valor vai para `instagram_app_secrets` -- RLS ligada, ZERO
            policies -- então cola aqui e nunca volta ao navegador.
          */}
          <div className="min-w-0 space-y-2.5 rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold">5. Cole as credenciais aqui</p>
              {origemCredencial === "ambiente" && (
                <span className="text-meta text-muted-foreground">
                  hoje vindo do ambiente
                </span>
              )}
            </div>

            <div className="space-y-1">
              <label htmlFor="ig-app-id" className="text-label font-medium text-muted-foreground">
                ID do app do Instagram
              </label>
              <Input id="ig-app-id" value={formAppId} inputMode="numeric"
                onChange={(e) => setFormAppId(e.target.value)}
                placeholder="1234567890123456" className="h-8 text-xs" />
            </div>

            <div className="space-y-1">
              <label htmlFor="ig-app-secret" className="text-label font-medium text-muted-foreground">
                Chave secreta do app do Instagram
              </label>
              <Input id="ig-app-secret" type="password" value={formSegredo}
                onChange={(e) => setFormSegredo(e.target.value)}
                placeholder={appConfigurado ? "•••••••• (já cadastrada)" : "cole aqui"}
                className="h-8 text-xs" />
              <p className="text-meta leading-relaxed text-muted-foreground">
                Fica guardada num compartimento que o navegador não alcança, e não volta
                para a tela — nem para quem acabou de salvá-la.
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <Button size="sm" className="h-8 text-label"
                onClick={() => void salvarCredencial()}
                disabled={salvando || !formAppId.trim() || !formSegredo.trim()}>
                {salvando ? "Salvando…" : appConfigurado ? "Substituir" : "Salvar"}
              </Button>
              {origemCredencial === "crm" && (
                <Button variant="ghost" size="sm" className="h-8 text-label text-muted-foreground"
                  onClick={() => void removerCredencial()} disabled={salvando}>
                  Remover
                </Button>
              )}
            </div>
          </div>

          <p className="text-meta leading-relaxed text-muted-foreground">
            Enquanto a Análise do App não sair, o fluxo funciona só para contas adicionadas
            como testadoras no app — o bastante para validar antes de submeter.
          </p>
          </div>
        )}
      </PainelDeIntegracao>
    </>
  );
}
