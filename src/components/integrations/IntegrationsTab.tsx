import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Search, Settings2 } from "lucide-react";
import {
  LogoGmail, LogoGoogleAds, LogoMeta, LogoSlack, LogoZapier,
} from "@/components/integrations/logos-de-integracao";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { WhatsAppCard } from "@/components/crm/WhatsAppCard";
import { InstagramCard } from "@/components/crm/InstagramCard";
import { CartaoDeIntegracao, type EstadoIntegracao } from "@/components/integrations/CartaoDeIntegracao";
import { PainelDeIntegracao, CamposDeIntegracao, ProvedorDoPainel } from "@/components/integrations/PainelDeIntegracao";
import { useContextoDoPainel } from "@/components/integrations/contexto-do-painel";
import { formatarData } from "@/lib/formato";

type IntegrationConfig = {
  id: string; org_id: string; provider: string; config: any; is_active: boolean;
  connected_at: string | null; connected_by: string | null;
};

type EmailConnection = {
  id: string; user_id: string; provider: string; email_address: string | null;
  label: string; purpose: string; is_active: boolean; created_at: string | null;
  connected_at: string | null;
  // Nulo = saudável. Preenchidos quando a renovação do token falha, ou quando a
  // credencial da empresa é trocada. Ver migração 20260824130000.
  invalid_since: string | null; invalid_reason: string | null;
};

/**
 * A CASCA. Ela existe só para abrir o contexto do painel.
 *
 * O conteúdo precisa CHAMAR `useContextoDoPainel()` -- é dali que vem o `abrir`
 * dos seis botões --, e um componente não enxerga o contexto que ele mesmo
 * fornece. Daí a divisão em dois: a casca fornece, o conteúdo consome.
 */
export function IntegrationsTab(props: { orgId: string | null; userId?: string }) {
  return (
    <ProvedorDoPainel>
      <ConteudoDeIntegracoes {...props} />
    </ProvedorDoPainel>
  );
}

function ConteudoDeIntegracoes({ orgId, userId }: {
  orgId: string | null;
  userId?: string;
}) {
  const { abrir, aberto, fechar } = useContextoDoPainel();
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [configs, setConfigs] = useState<IntegrationConfig[]>([]);
  const [editConfig, setEditConfig] = useState<any>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [emailConnections, setEmailConnections] = useState<EmailConnection[]>([]);
  /**
   * Credencial do Google que vive nos secrets do Supabase.
   *
   * Existe porque a origem recomendada NÃO é a tabela: o secret do projeto só é
   * lido pelas edge functions, enquanto integration_configs volta para o
   * navegador do admin. Sem consultar isto, o card acusava "sem credencial" com
   * tudo configurado corretamente — falso alarme que manda o admin preencher o
   * formulário e criar uma segunda fonte da mesma chave.
   *
   * `client_secret_configured` é booleano de propósito: gmail-get-defaults nunca
   * devolve o segredo, só se ele existe.
   */
  const [servidor, setServidor] = useState<{ client_id: string; client_secret_configured: boolean; origem?: string } | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [formId, setFormId] = useState("");
  const [formSecret, setFormSecret] = useState("");
  const [salvandoCred, setSalvandoCred] = useState(false);

  const fetchConfigs = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase.from("integration_configs").select("*").eq("org_id", orgId) as any;
    setConfigs(data || []);
  }, [orgId]);

  const fetchDefaultsServidor = useCallback(async () => {
    try {
      const { data } = await supabase.functions.invoke("gmail-get-defaults");
      if (data && !data.error) setServidor(data as typeof servidor);
    } catch {
      // Falha aqui só faz o card cair no que a tabela diz. Não vale toast.
    }
  }, []);

  const fetchEmailConnections = useCallback(async () => {
    if (!orgId) return;
    // Contas da EMPRESA: visíveis para toda a org, independente de quem conectou
    const { data } = await supabase
      .from("email_connections")
      .select("*")
      .eq("org_id", orgId)
      .eq("is_active", true) as any;
    setEmailConnections(data || []);
  }, [orgId]);

  useEffect(() => { fetchConfigs(); fetchEmailConnections(); fetchDefaultsServidor(); }, [fetchConfigs, fetchEmailConnections, fetchDefaultsServidor]);

  const getConfig = (provider: string) => configs.find((c) => c.provider === provider);

  /**
   * A credencial NÃO passa por integration_configs: vai para google_oauth_secrets
   * por edge function, que valida contra o Google antes de gravar e marca as
   * conexões existentes com o motivo da invalidação.
   */
  async function salvarCredencialGoogle() {
    setSalvandoCred(true);
    try {
      const { data, error } = await supabase.functions.invoke("gmail-credentials-save", {
        body: { client_id: formId.trim(), client_secret: formSecret.trim() },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Não foi possível salvar.");

      const invalidadas = Number(data.conexoes_invalidadas ?? 0);
      toast({
        title: "Credencial validada e salva",
        description: invalidadas > 0
          ? `${invalidadas} ${invalidadas === 1 ? "conta precisa" : "contas precisam"} reconectar — cada pessoa verá o motivo em Conectar e-mail.`
          : "Nenhuma conta conectada foi afetada.",
      });

      setFormAberto(false);
      setFormId("");
      setFormSecret("");
      await Promise.all([fetchDefaultsServidor(), fetchEmailConnections()]);
    } catch (e) {
      toast({
        title: "Credencial recusada",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSalvandoCred(false);
    }
  }

  const saveConfig = async (provider: string) => {
    // Slack não grava direto: a URL do webhook é credencial e vai para
    // `org_secrets`, tabela com RLS e nenhuma política — inalcançável pelo
    // cliente. A edge function TESTA o webhook antes de guardar, para o erro
    // aparecer aqui e não às 20h de um dia qualquer.
    if (provider === "slack") {
      const url = String(editConfig.webhook_url || "").trim();
      if (!url) {
        toast({ title: "Cole a URL do webhook", variant: "destructive" });
        return;
      }
      const { data, error } = await supabase.functions.invoke("validate-slack-webhook", {
        body: {
          webhook_url: url,
          channel: editConfig.channel || "",
          stale_days: editConfig.stale_days || 7,
        },
      });
      const msg = (data as { error?: string } | null)?.error || error?.message;
      if (msg) {
        toast({ title: "Não foi possível salvar", description: msg, variant: "destructive" });
        return;
      }
      toast({
        title: "Slack conectado",
        description: "Mandei uma mensagem de teste agora. Se chegou, o resumo das 20h também chega.",
      });
      fechar();
      fetchConfigs();
      return;
    }

    if (!orgId) return;
    if (provider === "meta") {
      const existing = getConfig("meta");
      if (existing) {
        await supabase.from("integration_configs").update({ config: editConfig, is_active: true } as any).eq("id", existing.id);
      } else {
        await supabase.from("integration_configs").insert({ org_id: orgId, provider: "meta", config: editConfig, is_active: true, connected_by: userId } as any);
      }
      toast({ title: "Meta Ads configurado — clique em Sincronizar para importar campanhas" });
      fechar();
      fetchConfigs();
      return;
    }
    const existing = getConfig(provider);
    if (existing) {
      await supabase.from("integration_configs").update({ config: editConfig, is_active: true } as any).eq("id", existing.id);
    } else {
      await supabase.from("integration_configs").insert({ org_id: orgId, provider, config: editConfig, connected_by: userId } as any);
    }
    toast({ title: `${provider} configurado` });
    fechar();
    fetchConfigs();
  };

  const toggleActive = async (id: string, active: boolean) => {
    await supabase.from("integration_configs").update({ is_active: active } as any).eq("id", id);
    fetchConfigs();
  };

  const [slackConnecting, setSlackConnecting] = useState(false);
  const [, setSlackChannels] = useState<{ id: string; name: string }[]>([]);
  const [, setSlackWorkspace] = useState<string | null>(null);
  const [slackSetupGuide, setSlackSetupGuide] = useState(false);

  const handleSlackConnect = async () => {
    if (!orgId) return;
    setSlackConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("slack-connect", {
        body: { org_id: orgId },
      });
      if (error) throw error;
      if (data?.error?.includes("API_KEY")) {
        setSlackSetupGuide(true);
        abrir("slack");
        setSlackConnecting(false);
        return;
      }
      if (data?.workspace_name) {
        setSlackWorkspace(data.workspace_name);
        setSlackChannels(data.channels || []);
        toast({ title: `Conectado ao workspace ${data.workspace_name}` });
        fetchConfigs();
      } else {
        setSlackSetupGuide(true);
        abrir("slack");
      }
    } catch {
      setSlackSetupGuide(true);
      abrir("slack");
    }
    setSlackConnecting(false);
  };

  const [metaConnecting, setMetaConnecting] = useState(false);
  const handleMetaConnect = async () => {
    if (!orgId) return;
    const cfg = getConfig("meta");
    // `waba_token` saiu junto com a seção de WhatsApp: aquele campo nunca teve
    // relação com o sync de anúncios, e mantê-lo aqui faria uma empresa com
    // WhatsApp configurado e Ads não parecer pronta para sincronizar.
    if (!cfg?.config?.access_token) {
      abrir("meta");
      setEditConfig(cfg?.config || {});
      return;
    }
    setMetaConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-ads-sync", {
        body: { org_id: orgId },
      });
      if (error) throw error;
      toast({ title: data?.synced ? `Sincronizado — ${data.synced} campanhas importadas` : "Meta Ads conectado" });
      fetchConfigs();
    } catch (e: any) {
      toast({ title: "Erro ao conectar Meta Ads", description: e.message, variant: "destructive" });
    }
    setMetaConnecting(false);
  };



  /**
   * Tipo explícito, não inferido. Os provedores têm conjuntos de campos
   * diferentes, e deixar o TypeScript inferir a união fazia `field` colapsar
   * para `never` no diálogo — `field.key` deixava de existir.
   */
  type CampoIntegracao = {
    key: string;
    label: string;
    placeholder?: string;
    type?: "secret" | "switch" | "section" | "logo" | "textarea";
    helpText?: string;
    helpUrl?: string;
    helpLabel?: string;
  };

  type Integracao = {
    provider: string;
    name: string;
    /** Aceita ícone do lucide E o MetaIcon local, que é um componente próprio. */
    icon: React.ComponentType<{ className?: string }>;
    description: string;
    connectAction?: () => void | Promise<void>;
    connectLoading?: boolean;
    fields: CampoIntegracao[];
    /**
     * Fora do grid, mas ainda na lista. O diálogo de configuração acha os
     * campos por `integrations.find(...)`, então a entrada precisa existir
     * mesmo quando o card próprio dela não deve aparecer.
     */
    hidden?: boolean;
  };

  const integrations: Integracao[] = [
    {
      provider: "meta", name: "Meta Ads", icon: LogoMeta,
      description: "Campanhas, conjuntos e métricas de anúncio",
      connectAction: handleMetaConnect,
      connectLoading: metaConnecting,
      fields: [
        { key: "_sec_ads", label: "Meta Ads", type: "section" as const },
        {
          key: "access_token", label: "Token de acesso", placeholder: "EAAxxxxxx...", type: "secret" as const,
          helpText: "Gere em",
          helpUrl: "https://developers.facebook.com/tools/explorer/",
          helpLabel: "Meta Graph API Explorer",
        },
        {
          key: "ad_account_id", label: "ID da conta de anúncio", placeholder: "act_123456789",
          helpText: "Business Manager → Contas de Anúncio → copie o ID (ex: act_123…)",
        },
        // A SEÇÃO DE WHATSAPP SAIU DAQUI.
        //
        // Era o terceiro lugar para configurar o mesmo canal, e gravava em
        // `integration_configs` -- tabela que o navegador LÊ, com policy
        // `FOR ALL USING (user_belongs_to_org)`. Qualquer membro da organização
        // lia o token. Agora o WhatsApp tem um cartão só, e a credencial vai
        // para `whatsapp_secrets`, que não tem policy de leitura.
      ],
    },
    {
      provider: "slack", name: "Slack", icon: LogoSlack,
      description: "Resumo do dia no canal, todo dia às 20h",
      connectAction: handleSlackConnect,
      connectLoading: slackConnecting,
      // Os campos `notify_won` e `notify_lost` saíram: eram switches que NENHUM
      // arquivo lia. Ligar não fazia nada. `daily_summary` também não fazia —
      // agora faz, porque existe a function slack-daily-summary e o cron.
      fields: [
        {
          key: "webhook_url", label: "URL do Incoming Webhook", type: "secret" as const,
          placeholder: "https://hooks.slack.com/services/T00/B00/xxxx",
          helpText: "No Slack: Apps → Incoming Webhooks → Add to Slack. Escolha o canal ali; é ele que vai receber.",
          helpUrl: "https://api.slack.com/messaging/webhooks",
          helpLabel: "Como criar",
        },
        {
          key: "channel", label: "Canal (só para você lembrar)", placeholder: "#comercial-lideranca",
          helpText: "O canal de verdade é definido no Slack ao criar o webhook. Este campo é anotação.",
        },
        { key: "stale_days", label: "Considerar negócio parado após (dias)", placeholder: "7" },
        { key: "daily_summary", label: "Enviar resumo às 20h", type: "switch" as const },
      ],
    },
    {
      provider: "zapier", name: "Zapier / Make", icon: LogoZapier,
      description: "Webhooks de saída e entrada para automação",
      fields: [
        { key: "outbound_url", label: "Webhook URL de saída", placeholder: "https://hooks.zapier.com/..." },
        { key: "events", label: "Eventos", placeholder: "deal.won, deal.lost, contact.created" },
      ],
    },
  ];

  // Uma fonte de verdade: gmail-get-defaults chama o MESMO resolvedor que o
  // envio usa, então o que a tela mostra é o que vai ser usado de verdade.
  // Antes esta checagem lia integration_configs pelo navegador e acusava falta
  // de credencial quando ela estava corretamente configurada no servidor.
  const hasGmailCredentials = !!(servidor?.client_id && servidor?.client_secret_configured);

  /**
   * Os cartões genéricos (Meta Ads, Slack, Zapier), agora reusáveis por grupo.
   *
   * Era um `.map` inline sobre a lista inteira, o que obrigava todos a
   * aparecerem juntos, na mesma pilha. Virou função para que cada grupo peça os
   * seus.
   */
  /**
   * Os genéricos, no MESMO cartão dos dedicados.
   *
   * Eram um `<Card>` cru com `CardHeader`, então Meta Ads e Slack tinham outra
   * forma que WhatsApp e Instagram -- ícone em lugar diferente, estado em lugar
   * diferente. Numa grade, dois desenhos leem como duas categorias de coisa.
   */
  const cartaoGenerico = (intg: Integracao) => {
    const cfg = getConfig(intg.provider);
    return (
      <CartaoDeIntegracao
        key={intg.provider}
        icone={intg.icon}
        nome={intg.name}
        descricao={intg.description}
        estado={cfg?.is_active ? "ativo" : "disponivel"}
        // O interruptor só existe onde há o que desligar: quando a integração
        // JÁ está configurada. Sem `cfg` não há nada para alternar, e um
        // interruptor ali seria controle morto.
        aoAlternar={cfg ? (v) => toggleActive(cfg.id, v) : undefined}
        // Sem `cfg` não há o que ativar: ligar abre a configuração.
        aoConfigurar={() => { abrir(intg.provider); setEditConfig(cfg?.config || {}); }}
        selecionado={aberto === intg.provider}
        acoes={
          cfg ? (
            <>
              {/* Engrenagem + rótulo, como o "Settings" da referência. O ícone
                  sozinho não diria o quê, e o rótulo sozinho some numa grade de
                  seis cartões com um botão cada. */}
              <Button variant="outline" size="sm" className="h-8 text-label"
                onClick={() => { abrir(intg.provider); setEditConfig(cfg.config || {}); }}>
                <Settings2 className="mr-1 h-3.5 w-3.5" />Configurar
              </Button>
              {intg.provider === "meta" && cfg.is_active && (
                <Button variant="ghost" size="sm" className="h-8 text-label"
                  disabled={metaConnecting} onClick={handleMetaConnect}>
                  {metaConnecting
                    ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Sincronizando…</>
                    : <><RefreshCw className="mr-1 h-3 w-3" />Sincronizar</>}
                </Button>
              )}
            </>
          ) : (
            <Button variant="outline" size="sm" className="h-8 text-label"
              disabled={intg.connectLoading}
              onClick={() => {
                if (intg.connectAction) return intg.connectAction();
                abrir(intg.provider);
                setEditConfig({});
              }}>
              {intg.connectLoading
                ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Conectando…</>
                : <><Settings2 className="mr-1 h-3.5 w-3.5" />Conectar</>}
            </Button>
          )
        }
      />
    );
  };

  /** Onde cada integração genérica aparece. */
  const grupoDo: Record<string, "atendimento" | "anuncios" | "automacao"> = {
    meta: "anuncios",
    slack: "automacao",
    zapier: "automacao",
  };


  /**
   * BUSCA E FILTRO POR ESTADO -- é o que a referência faz.
   *
   * O filtro era por TIPO (atendimento / anúncios / automação). A referência
   * filtra por estado, e os quatro botões dela têm correspondente exato aqui,
   * incluindo o terceiro estado que este CRM inventou: "não integrado" é o
   * "Archived" da referência, e é o único dos quatro que responde uma pergunta
   * que ninguém mais responde -- "isto existe no CRM?".
   *
   * Procurar pelo assunto continua possível pela busca, que os três títulos de
   * grupo nunca deram.
   */
  const [buscaIntg, setBuscaIntg] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<"todos" | EstadoIntegracao>("todos");

  /**
   * O ESTADO DE WHATSAPP E INSTAGRAM VEM DE DENTRO DELES.
   *
   * Os dois descobrem sozinhos se há conta conectada -- o WhatsApp consulta três
   * tabelas para isso. Sem eles reportarem para cima, filtrar por "Ativas"
   * esconderia um WhatsApp ativo, e um filtro que mente é pior que filtro
   * nenhum.
   *
   * O `m[chave] === e ? m : {...}` devolve o MESMO objeto quando nada mudou.
   * Sem essa guarda, o cartão reporta a cada render, o estado troca de
   * identidade, o pai re-renderiza e o cartão reporta de novo -- laço infinito.
   */
  const [estadosCanais, setEstadosCanais] = useState<Record<string, EstadoIntegracao>>({});
  const estadoDoWhatsApp = useCallback(
    (e: EstadoIntegracao) => setEstadosCanais((m) => (m.whatsapp === e ? m : { ...m, whatsapp: e })), []);
  const estadoDoInstagram = useCallback(
    (e: EstadoIntegracao) => setEstadosCanais((m) => (m.instagram === e ? m : { ...m, instagram: e })), []);

  const cartaoGoogleOAuth = (
        <CartaoDeIntegracao
          icone={LogoGmail}
          nome="Google — credenciais OAuth"
          descricao={
            hasGmailCredentials
              ? servidor?.origem === "legado"
                ? "Configuradas, mas numa tabela que o navegador lê"
                : "Configuradas · a equipe já pode conectar as contas"
              : "Cada pessoa conecta o próprio Gmail depois de você cadastrar aqui"
          }
          estado={hasGmailCredentials ? "ativo" : "disponivel"}
          aoConfigurar={() => abrir("google-oauth")}
          acoes={
            <Button variant="outline" size="sm" className="h-8 text-label"
              onClick={() => abrir("google-oauth")}>
              {hasGmailCredentials ? "Gerenciar" : "Cadastrar credenciais"}
            </Button>
          }
        />
  );

  const cartaoGoogleAds = (
        <CartaoDeIntegracao
          icone={LogoGoogleAds}
          nome="Google Ads"
          descricao="Ainda não construído no CRM"
          estado="nao-integrado"
          nota="Requer developer token do Google, tabelas e função de sincronização. Nada a configurar por enquanto."
        />
  );

  /**
   * Um cartão por entrada, com o texto que a busca procura.
   *
   * `busca` é escrito à mão e inclui SINÔNIMO: quem procura "gmail" quer o
   * cartão do Google, e quem procura "dm" quer o do Instagram. Buscar só no
   * nome visível deixaria os dois de fora.
   */
  const entradasIntg: { chave: string; estado: EstadoIntegracao; busca: string; no: React.ReactNode }[] = [
    { chave: "whatsapp", estado: estadosCanais.whatsapp ?? "disponivel",
      busca: "whatsapp wpp meta evolution qr code mensagem",
      no: <WhatsAppCard aoMudarEstado={estadoDoWhatsApp} /> },
    { chave: "instagram", estado: estadosCanais.instagram ?? "disponivel",
      busca: "instagram direct dm mensagem",
      no: <InstagramCard aoMudarEstado={estadoDoInstagram} /> },
    { chave: "google-oauth", estado: hasGmailCredentials ? "ativo" : "disponivel",
      busca: "google gmail oauth credencial e-mail email", no: cartaoGoogleOAuth },
    ...integrations.filter((i) => !i.hidden && grupoDo[i.provider] === "anuncios")
      .map((i) => ({
        chave: i.provider,
        estado: (getConfig(i.provider)?.is_active ? "ativo" : "disponivel") as EstadoIntegracao,
        busca: `${i.name} ${i.description} anuncio campanha`,
        no: cartaoGenerico(i),
      })),
    { chave: "google-ads", estado: "nao-integrado" as EstadoIntegracao,
      busca: "google ads anuncio campanha", no: cartaoGoogleAds },
    ...integrations.filter((i) => !i.hidden && grupoDo[i.provider] === "automacao")
      .map((i) => ({
        chave: i.provider,
        estado: (getConfig(i.provider)?.is_active ? "ativo" : "disponivel") as EstadoIntegracao,
        busca: `${i.name} ${i.description} automacao aviso webhook`,
        no: cartaoGenerico(i),
      })),
  ];

  /*
   * A SEÇÃO DE RECOMENDADAS SAIU, e com ela a lista fixa de duas chaves.
   *
   * WhatsApp e Google ficavam numa faixa própria acima da lista, e o efeito era
   * o contrário do pretendido: as duas integrações mais usadas eram justamente
   * as que NÃO apareciam onde se procura integração. Quem filtrava por "Ativas"
   * não as via, e quem buscava pelo nome também não -- elas estavam fora do
   * filtro por construção.
   *
   * Uma lista só, com todas dentro do mesmo filtro e da mesma busca.
   */
  const termoIntg = buscaIntg.trim().toLowerCase();
  const visiveisIntg = entradasIntg.filter(
    (e) =>
      (filtroEstado === "todos" || e.estado === filtroEstado) &&
      (!termoIntg || e.busca.toLowerCase().includes(termoIntg)),
  );

  const FILTROS_ESTADO = [
    { valor: "todos", rotulo: "Todas" },
    { valor: "ativo", rotulo: "Ativas" },
    { valor: "disponivel", rotulo: "Inativas" },
    { valor: "nao-integrado", rotulo: "Não integradas" },
  ] as const;

  /**
   * O PAINEL DA DIREITA, no lugar do diálogo de configuração.
   *
   * Só os genéricos (Meta Ads, Slack, Zapier) abrem aqui: são os que têm lista
   * de campos declarada. WhatsApp, Instagram e Google têm formulário próprio,
   * com validação própria contra o provedor -- o do Google, em particular, grava
   * por edge function porque a credencial não pode passar por
   * `integration_configs`, que o navegador lê.
   */
  const intgEmEdicao = integrations.find((i) => i.provider === aberto);
  const cfgEmEdicao = aberto ? getConfig(aberto) : null;

  return (
    /*
      UMA COLUNA. A configuração entra por uma GAVETA, não por uma coluna fixa.

      Chegou a ser duas colunas, com o painel encaixado à direita. Ele comia
      ~340px permanentes, então a grade caía para dois cartões por linha o tempo
      todo -- inclusive com nenhuma integração aberta, que é o estado normal da
      tela. A gaveta cobre só enquanto está aberta, e é o mesmo gesto do perfil
      de contato.
    */
    <div className="space-y-6">
        {/* LISTA DE INTEGRAÇÕES */}
        <section>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="vx-titulo-secao">Todas as integrações</h3>
            <div className="relative sm:w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={buscaIntg}
                onChange={(e) => setBuscaIntg(e.target.value)}
                placeholder="Buscar integração"
                className="h-9 pl-8 text-xs"
              />
            </div>
          </div>

          {/* As pílulas de estado. `overflow-x-auto` porque em telas estreitas
              os quatro rótulos não cabem, e quebrar a linha faria a faixa virar
              dois blocos empilhados que não leem mais como um controle só. */}
          <div className="mt-2.5 overflow-x-auto">
            <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5">
              {FILTROS_ESTADO.map((f) => (
                <button
                  key={f.valor}
                  type="button"
                  onClick={() => setFiltroEstado(f.valor)}
                  className={cn(
                    "whitespace-nowrap rounded-md px-2.5 py-1.5 text-label font-medium transition-colors",
                    filtroEstado === f.valor
                      ? "bg-card text-foreground shadow-[var(--shadow-xs)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.rotulo}
                </button>
              ))}
            </div>
          </div>

          {visiveisIntg.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-border py-12 text-center text-xs text-muted-foreground">
              {termoIntg
                ? `Nenhuma integração para “${buscaIntg.trim()}”.`
                : "Nenhuma integração neste estado."}
            </p>
          ) : (
            /* TRÊS colunas, e isso serve à forma do cartão: a mesma altura
               mínima numa coluna mais estreita dá uma proporção mais próxima do
               quadrado, que é o que a referência mostra. */
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visiveisIntg.map((e) => (
                <div key={e.chave} className="contents">{e.no}</div>
              ))}
            </div>
          )}
        </section>

      {/* O diálogo das credenciais do Google fica FORA da grade: é sobreposição,
          não cartão, e dentro do grid ocupava uma célula invisível. */}
        {/* As credenciais do Google, no MESMO painel dos outros cinco.
            O formulário continua sendo o daqui -- ele grava por edge function,
            que valida contra o Google antes e marca as contas que precisarão
            reconectar. Um "Salvar" na moldura não saberia fazer nada disso, por
            isso o painel vai sem rodapé. */}
        <PainelDeIntegracao
          chave="google-oauth"
          nome="Google — credenciais OAuth"
          icone={LogoGmail}
          descricao="Configuradas uma vez pela empresa. Cada pessoa conecta o próprio Gmail depois."
          estado={hasGmailCredentials ? "ativo" : "disponivel"}
        >
          <div className="space-y-3">

        {hasGmailCredentials ? (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 rounded-md border border-success/30 bg-success/5 p-3">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-success">
                  Credenciais configuradas — a equipe já pode conectar as contas
                </p>
                <p className="mt-0.5 text-label text-success/80">
                  {servidor?.origem === "crm"
                    ? "Origem: cadastrada aqui no CRM, guardada fora do alcance do navegador."
                    : servidor?.origem === "legado"
                      ? "Origem: configuração antiga do banco. Recadastre aqui para movê-la para o compartimento protegido."
                      : "Origem: secrets do servidor. O segredo nunca chega ao navegador."}
                </p>
              </div>
            </div>
            {/* Credencial em integration_configs é herança: aquela tabela é
                lida pelo navegador do admin. A migração 20260824130000 tirou
                as chaves de lá, mas alguém pode reintroduzir por SQL. */}
            {servidor?.origem === "legado" && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-label leading-relaxed text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Esta credencial está numa <strong>tabela que o navegador lê</strong>, herança da
                  configuração antiga. Clique em <strong>Trocar credencial</strong> e recadastre o
                  mesmo par para movê-la ao compartimento protegido. As contas conectadas não são
                  afetadas se o valor for o mesmo.
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Sem o <strong>Client ID</strong> e o <strong>Client Secret</strong> do Google,
              ninguém consegue conectar e-mail — nem você.
            </span>
          </div>
        )}

        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="text-label font-medium">Onde cada pessoa conecta a conta dela</p>
          <p className="mt-0.5 text-label leading-relaxed text-muted-foreground">
            Em <strong>Configurações → Conectar e-mail</strong>. A caixa de cada um é privada:
            ninguém vê o e-mail do outro, nem você.
          </p>
          {emailConnections.length > 0 && (
            <p className="mt-1.5 text-label tabular-nums text-muted-foreground">
              {emailConnections.length}{" "}
              {emailConnections.length === 1 ? "conta conectada" : "contas conectadas"} na equipe
            </p>
          )}
        </div>

        {/* Quem conectou e quem está com problema. Só admin: o RLS de
            email_connections mostra ao admin as conexões de todos e ao
            comercial apenas a dele — sem esta guarda, um não-admin veria a
            equipe inteira como "não conectada" e concluiria que está tudo
            quebrado. */}
        {isAdmin && emailConnections.length > 0 && (
          <div className="rounded-md border border-border">
            <p className="border-b border-border px-3 py-2 text-label font-medium">
              Contas conectadas
            </p>
            <div className="divide-y divide-border">
              {emailConnections.map((c) => (
                <div key={c.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-label">{c.email_address}</span>
                  {c.invalid_since ? (
                    <Badge variant="destructive" className="shrink-0 text-label">
                      {c.invalid_reason === "credenciais_trocadas"
                        ? "reconectar: credencial trocada"
                        : c.invalid_reason === "token_revogado"
                          ? "reconectar: acesso revogado"
                          : "reconectar"}
                    </Badge>
                  ) : (
                    <span className="shrink-0 text-label tabular-nums text-muted-foreground">
                      {c.connected_at
                        ? formatarData(c.connected_at)
                        : "—"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Formulário próprio, não o diálogo compartilhado. O diálogo
            gravava direto em integration_configs, tabela que o navegador LÊ
            — e junto arrastava dez campos de assinatura que duplicavam
            Configurações → Assinatura, sobrescrevendo sem merge. Aqui são
            dois campos, e eles vão para uma edge function. */}
        {!formAberto ? (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="h-8 text-label"
              onClick={() => { setFormAberto(true); setFormId(""); setFormSecret(""); }}>
              {hasGmailCredentials ? "Trocar credencial" : "Cadastrar credencial"}
            </Button>
          </div>
        ) : (
          <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
            <div className="space-y-1">
              <label className="text-label font-medium" htmlFor="g-cid">Client ID</label>
              <Input id="g-cid" autoComplete="off" className="h-8 font-mono text-xs"
                placeholder="000000000000-xxxx.apps.googleusercontent.com"
                value={formId} onChange={(e) => setFormId(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-label font-medium" htmlFor="g-csec">Client Secret</label>
              <Input id="g-csec" type="password" autoComplete="off" className="h-8 font-mono text-xs"
                placeholder="GOCSPX-..."
                value={formSecret} onChange={(e) => setFormSecret(e.target.value)} />
            </div>

            <p className="text-label leading-relaxed text-muted-foreground">
              Guardado em um compartimento que o navegador não lê — nem admin consegue
              recuperar depois. Por isso os campos vêm vazios em vez de fingir
              pré-preenchimento. Validamos com o Google antes de salvar.
            </p>

            {/* Avisar ANTES, não descobrir depois: trocar a credencial invalida
                todo token já emitido, porque o Google exige que a renovação use
                as mesmas credenciais da emissão. */}
            {hasGmailCredentials && emailConnections.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-label leading-relaxed text-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  {emailConnections.length === 1
                    ? "1 conta conectada precisará reconectar"
                    : `${emailConnections.length} contas conectadas precisarão reconectar`}
                  {" "}depois da troca. Cada pessoa verá o motivo em Conectar e-mail.
                </span>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-8 text-label"
                onClick={() => setFormAberto(false)} disabled={salvandoCred}>
                Cancelar
              </Button>
              <Button size="sm" className="h-8 text-label"
                onClick={salvarCredencialGoogle}
                disabled={salvandoCred || !formId.trim() || !formSecret.trim()}>
                {salvandoCred && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Validar e salvar
              </Button>
            </div>
          </div>
        )}
          </div>
        </PainelDeIntegracao>

      {/* O DIÁLOGO DE CONFIGURAÇÃO SAIU DAQUI.
          Virou `PainelDeIntegracao`, a coluna da direita -- ver o comentário
          lá. O guia do Slack abaixo continua diálogo de propósito: é leitura de
          quatro passos, não formulário, e não há lista para consultar ao lado. */}


      {intgEmEdicao && (
        <PainelDeIntegracao
          chave={intgEmEdicao.provider}
          nome={intgEmEdicao.name}
          icone={intgEmEdicao.icon}
          descricao={intgEmEdicao.description}
          estado={cfgEmEdicao?.is_active ? "ativo" : "disponivel"}
          aoAlternarAtivo={cfgEmEdicao ? (v) => toggleActive(cfgEmEdicao.id, v) : undefined}
          rodape={
            <>
              <Button variant="ghost" size="sm" className="h-8 text-label" onClick={fechar}>
                Cancelar
              </Button>
              <Button size="sm" className="h-8 text-label"
                onClick={() => intgEmEdicao && saveConfig(intgEmEdicao.provider)}>
                Salvar
              </Button>
            </>
          }
        >
          {/*
            O GUIA DO SLACK, aqui dentro — não mais num diálogo à parte.

            Ele era a última coisa da aba que abria centralizada, cobrindo a
            lista. Pior: cobria o próprio painel do Slack, então quem seguia os
            passos perdia de vista o formulário para o qual eles levam.

            Aparece quando a conexão falha (é quando a instrução importa) e
            some assim que o webhook é salvo.
          */}
          {intgEmEdicao.provider === "slack" && slackSetupGuide && (
            <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
              <p className="text-xs font-semibold text-warning">
                Não consegui conectar sozinho — siga os passos abaixo
              </p>
      <div className="space-y-3">
        <div className="flex gap-3 items-start">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">1</span>
          <div>
            <p className="text-sm font-medium">Acesse as configurações do projeto no Lovable</p>
            <p className="text-xs text-muted-foreground">Clique no nome do projeto (canto superior esquerdo) → "Settings"</p>
          </div>
        </div>

        <div className="flex gap-3 items-start">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">2</span>
          <div>
            <p className="text-sm font-medium">Vá em "Connectors"</p>
            <p className="text-xs text-muted-foreground">Na aba de conectores, procure por "Slack" e clique em "Connect"</p>
          </div>
        </div>

        <div className="flex gap-3 items-start">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">3</span>
          <div>
            <p className="text-sm font-medium">Autorize o acesso ao seu workspace</p>
            <p className="text-xs text-muted-foreground">Selecione o workspace do Slack e autorize as permissões necessárias (enviar mensagens, listar canais)</p>
          </div>
        </div>

        <div className="flex gap-3 items-start">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">4</span>
          <div>
            <p className="text-sm font-medium">Volte aqui e clique em "Conectar"</p>
            <p className="text-xs text-muted-foreground">Após vincular o conector, o VIONEX detectará automaticamente seus canais</p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/50 p-3">
        <p className="text-xs text-muted-foreground">
          <strong>Permissões necessárias:</strong> <code className="text-label bg-muted px-1 rounded">chat:write</code> <code className="text-label bg-muted px-1 rounded">channels:read</code> <code className="text-label bg-muted px-1 rounded">channels:history</code>
        </p>
      </div>

              <Button size="sm" className="h-8 w-full text-label"
                onClick={() => { setSlackSetupGuide(false); handleSlackConnect(); }}>
                <RefreshCw className="mr-1 h-3 w-3" /> Tentar novamente
              </Button>
            </div>
          )}

          {intgEmEdicao.provider === "meta" && (
            <div className="rounded-md border border-[#1877F2]/30 bg-[#EEF4FF] p-3 text-label leading-relaxed text-[#1877F2]">
              Preencha só a seção que você usa — <strong>Meta Ads</strong> para campanhas.
              O token é gerado no{" "}
              <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="font-medium underline">
                Meta Graph API Explorer
              </a>.
            </div>
          )}
          <CamposDeIntegracao
            campos={intgEmEdicao.fields}
            valores={editConfig}
            aoMudarValor={(chave, valor) => setEditConfig((c: any) => ({ ...c, [chave]: valor }))}
            revelados={revealed}
            aoAlternarRevelado={(chave) => setRevealed((r) => ({ ...r, [chave]: !r[chave] }))}
          />
        </PainelDeIntegracao>
      )}

    </div>
  );
}
