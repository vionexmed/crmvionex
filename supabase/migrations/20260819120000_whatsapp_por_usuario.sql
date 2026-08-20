-- ============================================================================
-- WhatsApp por usuário — um número por pessoa, sob um WABA da empresa
-- ============================================================================
--
-- HOJE: `whatsapp_config.org_id` é UNIQUE, então a empresa tem UM número. Pior,
-- o token é um secret global do projeto (META_WHATSAPP_TOKEN) — nem por
-- organização é, é por deploy. Duas empresas não conseguem trazer o próprio
-- WABA, e duas pessoas não conseguem ter números diferentes.
--
-- A HIERARQUIA DA META define o desenho, e ela tem TRÊS escopos:
--
--   Business Manager (a empresa)
--   └── WABA                                  ← cadastrado e verificado uma vez
--       ├── número principal → phone_number_id
--       ├── número da Ana    → phone_number_id
--       └── número do Carlos → phone_number_id
--
-- O token de sistema pertence ao WABA, não ao número: um token envia por
-- qualquer número da conta. Logo o token é da ORG e o que varia por pessoa é só
-- o phone_number_id. Daí três tabelas em vez de uma.
--
-- O webhook também é um só. A Meta manda tudo para a mesma URL e diz a origem
-- em metadata.phone_number_id — o código já lê esse campo, só passa a resolver
-- CONEXÃO em vez de organização.
--
-- Espelha o modelo por pessoa que o e-mail já usa
-- (20260817160000_gmail_por_usuario_e_privacidade), inclusive os índices
-- parciais e a RPC de cota. O que NÃO se espelha está anotado onde aparece.

-- ---------- 1. O WABA: um por organização ----------
-- Sem o token. Esta tabela é legível por admin no cliente, e token em texto
-- claro alcançável pelo navegador é vazamento. O token vai para whatsapp_secrets.
CREATE TABLE IF NOT EXISTS public.whatsapp_business_accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- 'evolution' já entra no CHECK para o provedor futuro não exigir migração de
  -- schema. A implementação dele ainda não existe.
  provider     text NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta', 'evolution')),
  waba_id      text,
  -- Do WABA, não do número: a Meta valida o webhook uma vez por conta.
  webhook_verify_token text NOT NULL,
  -- Reservado para a Evolution API, que é auto-hospedada.
  server_url   text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_business_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_business_accounts_select" ON public.whatsapp_business_accounts FOR SELECT
  USING (public.user_belongs_to_org(auth.uid(), org_id) AND public.is_org_admin(auth.uid(), org_id));

CREATE POLICY "whatsapp_business_accounts_write" ON public.whatsapp_business_accounts FOR ALL
  USING (public.user_belongs_to_org(auth.uid(), org_id) AND public.is_org_admin(auth.uid(), org_id))
  WITH CHECK (public.user_belongs_to_org(auth.uid(), org_id) AND public.is_org_admin(auth.uid(), org_id));

COMMENT ON TABLE public.whatsapp_business_accounts IS
  'A conta WhatsApp Business (WABA) da organização. Um WABA por org; os números dele ficam em whatsapp_connections.';
COMMENT ON COLUMN public.whatsapp_business_accounts.webhook_verify_token IS
  'Pertence ao WABA, não ao número: a Meta faz o handshake uma vez por conta, não por telefone.';

-- ---------- 2. O token: RLS ligada e NENHUMA policy ----------
-- Mesmo tratamento de gmail_oauth_tokens: só service_role alcança. Sem policy,
-- nenhum cliente lê — nem admin. Se algum dia aparecer uma policy aqui, o token
-- da empresa vaza para o navegador.
CREATE TABLE IF NOT EXISTS public.whatsapp_secrets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_secrets ENABLE ROW LEVEL SECURITY;
-- Propositalmente sem CREATE POLICY. Ver comentário acima.

COMMENT ON TABLE public.whatsapp_secrets IS
  'Token de sistema do WABA. RLS ligada SEM policy: só service_role lê. Não criar policy aqui.';

-- ---------- 3. O número: um por pessoa ----------
CREATE TABLE IF NOT EXISTS public.whatsapp_connections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'org' fica reservado para número compartilhado de atendimento, como o e-mail
  -- fez com a caixa da empresa. Sem uso na Fase 1.
  scope_type   text NOT NULL DEFAULT 'user' CHECK (scope_type IN ('user', 'org')),
  provider     text NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta', 'evolution')),
  -- WABA próprio, OPCIONAL. Nulo = usa o da organização, que é o caso normal.
  -- Existe para revenda ou parceiro com conta própria não exigir migração de
  -- dados depois. Uma coluna nullable hoje contra uma migração amanhã.
  waba_id      text,
  phone_number_id      text NOT NULL,
  display_phone_number text,
  verified_name        text,
  -- Reservado para a Evolution, onde a unidade é a instância, não o phone id.
  instance_name        text,
  label        text NOT NULL DEFAULT 'Meu número',
  is_active    boolean NOT NULL DEFAULT true,
  connected_at timestamptz NOT NULL DEFAULT now(),
  -- Teto por conexão. ATENÇÃO ao que a Meta divide e ao que ela não divide: o
  -- limite de conversas iniciadas em 24h e o quality rating são POR NÚMERO, não
  -- do WABA. Então isto não reparte uma cota compartilhada — protege o tier
  -- DESTE número de uma automação descontrolada. Quem estoura afeta só a si.
  --
  -- O que é de fato compartilhado no WABA: templates, verificação do Business,
  -- faturamento, e banimento em nível de conta. Ver o comentário da tabela.
  daily_send_limit int NOT NULL DEFAULT 1000,
  sent_today       int NOT NULL DEFAULT 0,
  sent_today_date  date
);

-- Um número pertence a uma pessoa só. É ESTE índice que torna a reivindicação
-- atômica: em dois cliques simultâneos, um insert perde e a interface explica.
-- Global e não por org de propósito: o webhook resolve por phone_number_id sem
-- saber de qual organização se trata, então a busca precisa ser inequívoca.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_connections_number_key
  ON public.whatsapp_connections (phone_number_id) WHERE is_active;

-- Uma conexão pessoal ativa por pessoa — igual a email_connections_user_active_key.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_connections_user_key
  ON public.whatsapp_connections (org_id, user_id) WHERE is_active AND scope_type = 'user';

CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_org
  ON public.whatsapp_connections (org_id) WHERE is_active;

ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;

-- Duas policies, o idioma do e-mail. O trio admin-only que sobrou em
-- email_connections de uma migração antiga NÃO é reproduzido aqui: é peso morto,
-- porque a policy FOR ALL abaixo já concede o acesso maior.
--
-- O SELECT restrito é deliberado: quem enxerga os números DOS OUTROS é a edge
-- function com service role, que devolve só "já reivindicado" sem dizer de quem.
CREATE POLICY "whatsapp_connections_select" ON public.whatsapp_connections FOR SELECT
  USING (
    public.user_belongs_to_org(auth.uid(), org_id)
    AND (public.is_org_admin(auth.uid(), org_id) OR user_id = auth.uid())
  );

CREATE POLICY "whatsapp_connections_write" ON public.whatsapp_connections FOR ALL
  USING (
    public.user_belongs_to_org(auth.uid(), org_id)
    AND (
      public.is_org_admin(auth.uid(), org_id)
      OR (scope_type = 'user' AND user_id = auth.uid())
    )
  )
  WITH CHECK (
    public.user_belongs_to_org(auth.uid(), org_id)
    AND (
      public.is_org_admin(auth.uid(), org_id)
      OR (scope_type = 'user' AND user_id = auth.uid())
    )
  );

-- POR QUE UM WABA SÓ, e não um por pessoa:
-- O risco que acontece no dia a dia (qualidade cai por bloqueio/denúncia) já é
-- isolado por número — cai o número de quem gerou, não os outros. O risco
-- compartilhado (Meta desativar a conta por política) NÃO se resolve separando
-- WABAs, porque vários WABAs sob o mesmo Business caem junto com o Business.
-- Isolar de verdade exigiria Business Managers distintos, ou seja verificação de
-- entidade legal separada — inviável para um time da mesma empresa.
-- Separar custaria: aprovar cada template N vezes, N tokens, N webhooks.
-- O que reduz risco de verdade é operacional, e é vigiar o quality_rating de
-- cada número — que a API devolve e a interface expõe.
COMMENT ON TABLE public.whatsapp_connections IS
  'O número de WhatsApp de cada pessoa, dentro do WABA da organização. Espelha email_connections.';
COMMENT ON COLUMN public.whatsapp_connections.daily_send_limit IS
  'Teto diário por conexão. O limite de 24h e o quality rating da Meta são por NÚMERO, não do WABA: isto protege o tier deste número de automação descontrolada.';
COMMENT ON COLUMN public.whatsapp_connections.waba_id IS
  'WABA próprio da conexão. Nulo usa o da organização — o caso normal. Preenchido só em revenda/parceiro com conta própria.';

-- ---------- 4. Atribuir a mensagem ----------
-- Hoje whatsapp_messages não diz de qual número nem de quem saiu: só o texto
-- livre from_number, que fica VAZIO quando ninguém rodou o sync de templates.
-- Este é o par que 20260817160000 adicionou a `emails`, e sem ele não há como
-- reescrever a privacidade por número.
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS connection_id uuid REFERENCES public.whatsapp_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS user_id uuid;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_connection
  ON public.whatsapp_messages (connection_id, created_at DESC);

-- ---------- 5. Privacidade: segue o NÚMERO ----------
-- Antes: partição pelo dono do CONTATO, porque havia um número só para a empresa.
-- Agora que cada um tem o seu, a regra que se explica é "se saiu do meu
-- WhatsApp, é meu".
--
-- RESSALVA REGISTRADA: linha com connection_id nulo — mensagem anterior a esta
-- migração, ou recebida em número que ninguém reivindicou — fica visível só para
-- admin. É a mesma decisão que a policy antiga tomou para mensagem sem contato:
-- ninguém tem direito sobre ela, e o admin é quem tria. Seguro aqui porque o
-- WhatsApp nunca foi configurado em produção; conferir com
--   select count(*) from public.whatsapp_messages;
-- antes de aplicar.
DROP POLICY IF EXISTS "whatsapp_messages_select" ON public.whatsapp_messages;
CREATE POLICY "whatsapp_messages_select" ON public.whatsapp_messages FOR SELECT
  USING (
    public.user_belongs_to_org(auth.uid(), org_id)
    AND (
      public.is_org_admin(auth.uid(), org_id)
      OR EXISTS (
        SELECT 1 FROM public.whatsapp_connections wc
        WHERE wc.id = whatsapp_messages.connection_id
          AND wc.user_id = auth.uid()
      )
    )
  );

-- ---------- 6. Cota de envio, atômica ----------
-- Cópia estrutural de reserve_email_send (20260818120000_seguranca_rls). Um
-- UPDATE que checa e incrementa de uma vez, para envio concorrente não furar o
-- teto.
CREATE OR REPLACE FUNCTION public.reserve_whatsapp_send(_connection_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  -- A reserva só vale para a própria conexão, senão qualquer pessoa logada
  -- zeraria a cota de um colega em laço. `service_role` chega com auth.uid()
  -- nulo e passa, que é o que mantém automação e cron funcionando.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.whatsapp_connections
    WHERE id = _connection_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Esta conexão de WhatsApp não é sua';
  END IF;

  UPDATE public.whatsapp_connections
  SET sent_today = CASE WHEN sent_today_date = current_date THEN sent_today + 1 ELSE 1 END,
      sent_today_date = current_date
  WHERE id = _connection_id
    AND is_active
    AND (sent_today_date IS DISTINCT FROM current_date OR sent_today < daily_send_limit)
  RETURNING true INTO v_ok;

  RETURN coalesce(v_ok, false);
END;
$$;

REVOKE ALL     ON FUNCTION public.reserve_whatsapp_send(uuid) FROM public;
GRANT EXECUTE  ON FUNCTION public.reserve_whatsapp_send(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.reserve_whatsapp_send(uuid) IS
  'Reserva um envio contra o teto diário da conexão. Devolve false quando o teto foi atingido.';

-- ---------- 7. whatsapp_config segue de pé, por enquanto ----------
-- Esta migração é ADITIVA de propósito: o código atual continua lendo
-- whatsapp_config e funcionando. A tabela só é derrubada no último passo do
-- plano, depois de todo consumidor migrar — derrubar agora quebraria o envio
-- entre um deploy e o outro.
COMMENT ON TABLE public.whatsapp_config IS
  'OBSOLETA desde 2026-08-19. Substituída por whatsapp_business_accounts + whatsapp_connections. Mantida até os consumidores migrarem.';
