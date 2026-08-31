-- ============================================================================
-- Google Ads: as tabelas e o compartimento dos segredos
-- ============================================================================
--
-- O painel de Marketing tinha metade: `useMarketingData` lê `meta_campaigns` e
-- `meta_insights` de verdade, e para o Google devolvia `campaigns: []` com
-- `source: "nao-integrado"`. Honesto, mas não existia integração nenhuma --
-- zero funções, zero tabelas.
--
-- A FORMA ESPELHA A DO META, de propósito: o painel soma os dois lado a lado, e
-- duas formas diferentes obrigariam a tela a saber de qual plataforma cada
-- número veio para poder lê-lo.
--
-- ---------------------------------------------------------------------------
-- MICROS: a armadilha da API do Google
-- ---------------------------------------------------------------------------
--
-- R$ 1,00 chega como 1000000. Gravar o número cru faria o painel anunciar um
-- investimento um milhão de vezes maior, e o pior: pareceria plausível numa
-- primeira olhada, porque o gráfico continuaria com a forma certa.
--
-- A divisão acontece na edge function, e as colunas aqui guardam REAIS, iguais
-- às do Meta. É o que permite `spend_meta + spend_google` sem conversão na tela.
--
-- ---------------------------------------------------------------------------
-- O QUE O USUÁRIO PRECISA TER, E QUE NÃO DEPENDE DESTE CÓDIGO
-- ---------------------------------------------------------------------------
--
-- Um DEVELOPER TOKEN, solicitado ao Google numa conta gerenciadora (MCC) e
-- sujeito a revisão. Sem ele toda chamada à API falha com
-- DEVELOPER_TOKEN_NOT_APPROVED. Não há contorno em código.
-- ============================================================================

-- ---------- 1. Os segredos ----------
--
-- Reaproveita `google_oauth_secrets`, que já é o compartimento certo: RLS ligada
-- SEM policy, então só service_role lê. Criar outra tabela dividiria a
-- credencial do Google em dois lugares sem motivo.

ALTER TABLE public.google_oauth_secrets
  -- O developer token é da EMPRESA, não da conta de anúncio: um só serve para
  -- todas as contas que o MCC alcança.
  ADD COLUMN IF NOT EXISTS ads_developer_token text,
  -- O refresh token que a autorização devolve. É com ele que a função obtém
  -- access_token novo a cada sync -- access_token vive uma hora e guardá-lo
  -- seria guardar algo que expira antes do próximo uso.
  ADD COLUMN IF NOT EXISTS ads_refresh_token text;

COMMENT ON COLUMN public.google_oauth_secrets.ads_developer_token IS
  'Developer token do Google Ads API, obtido no API Center de uma conta MCC. Sujeito a aprovação do Google.';
COMMENT ON COLUMN public.google_oauth_secrets.ads_refresh_token IS
  'Refresh token da autorização do escopo adwords. O access_token é obtido a cada sync e não é guardado.';

-- ---------- 2. A conta de anúncio ----------

CREATE TABLE IF NOT EXISTS public.google_ads_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Só dígitos, sem os hífens que o painel do Google mostra: a API os recusa.
  customer_id   text NOT NULL,
  -- A conta gerenciadora, quando a de anúncio está sob um MCC. Vai no cabeçalho
  -- `login-customer-id`; sem ele o Google recusa acesso a conta gerenciada.
  login_customer_id text,
  name          text NOT NULL DEFAULT 'Conta Google Ads',
  currency      text,
  timezone      text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Uma conta de anúncio pertence a uma organização só.
CREATE UNIQUE INDEX IF NOT EXISTS google_ads_accounts_customer_key
  ON public.google_ads_accounts (customer_id) WHERE is_active;

-- ---------- 3. Campanhas ----------

CREATE TABLE IF NOT EXISTS public.google_ads_campaigns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES public.google_ads_accounts(id) ON DELETE CASCADE,
  google_campaign_id text NOT NULL,
  name           text NOT NULL,
  status         text,
  -- SEARCH | DISPLAY | VIDEO | PERFORMANCE_MAX | SHOPPING…
  channel_type   text,
  -- Em REAIS, já dividido por 1.000.000. Ver o cabeçalho.
  daily_budget   numeric,
  start_date     date,
  end_date       date,
  raw            jsonb,
  synced_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS google_ads_campaigns_key
  ON public.google_ads_campaigns (org_id, google_campaign_id);

-- ---------- 4. Métricas por dia ----------

CREATE TABLE IF NOT EXISTS public.google_ads_insights (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id    text NOT NULL,
  dia            date NOT NULL,
  -- Em REAIS. `cost_micros / 1e6` na função.
  spend          numeric DEFAULT 0,
  impressions    bigint  DEFAULT 0,
  clicks         bigint  DEFAULT 0,
  -- `conversions` vem FRACIONÁRIO na API: uma conversão com peso 0,5 existe.
  -- Arredondar aqui perderia a soma correta de um mês inteiro.
  conversions    numeric DEFAULT 0,
  conversion_value numeric DEFAULT 0,
  ctr            numeric,
  cpc            numeric,
  raw            jsonb,
  synced_at      timestamptz NOT NULL DEFAULT now()
);

-- Uma linha por campanha por dia. É o que faz o sync ser idempotente: rodar
-- duas vezes no mesmo dia atualiza em vez de duplicar o investimento.
CREATE UNIQUE INDEX IF NOT EXISTS google_ads_insights_key
  ON public.google_ads_insights (org_id, campaign_id, dia);

CREATE INDEX IF NOT EXISTS idx_google_ads_insights_periodo
  ON public.google_ads_insights (org_id, dia DESC);

-- ---------- 5. Registro de sincronização ----------

CREATE TABLE IF NOT EXISTS public.google_ads_sync_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ok          boolean NOT NULL,
  mensagem    text,
  campanhas   int,
  dias        int,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- 6. RLS ----------
--
-- Dado de campanha NÃO é por dono: é da empresa, e o painel de Marketing soma
-- tudo. Mesmo recorte das tabelas do Meta -- membro da org lê, ninguém escreve
-- pelo navegador (o sync usa service_role).

ALTER TABLE public.google_ads_accounts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_ads_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_ads_insights  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_ads_sync_log  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_ads_accounts_select  ON public.google_ads_accounts;
DROP POLICY IF EXISTS google_ads_campaigns_select ON public.google_ads_campaigns;
DROP POLICY IF EXISTS google_ads_insights_select  ON public.google_ads_insights;
DROP POLICY IF EXISTS google_ads_sync_log_select  ON public.google_ads_sync_log;

CREATE POLICY google_ads_accounts_select ON public.google_ads_accounts FOR SELECT
  USING (public.user_belongs_to_org(auth.uid(), org_id));
CREATE POLICY google_ads_campaigns_select ON public.google_ads_campaigns FOR SELECT
  USING (public.user_belongs_to_org(auth.uid(), org_id));
CREATE POLICY google_ads_insights_select ON public.google_ads_insights FOR SELECT
  USING (public.user_belongs_to_org(auth.uid(), org_id));
CREATE POLICY google_ads_sync_log_select ON public.google_ads_sync_log FOR SELECT
  USING (public.user_belongs_to_org(auth.uid(), org_id));

-- Sem policy de INSERT/UPDATE/DELETE em nenhuma delas, de propósito: quem
-- escreve é a edge function com service_role. O navegador não inventa métrica.

COMMENT ON TABLE public.google_ads_insights IS
  'Métricas diárias por campanha do Google Ads. Valores em REAIS -- a API entrega micros e a divisão acontece na edge function.';
