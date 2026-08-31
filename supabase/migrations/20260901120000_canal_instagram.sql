-- Canal de Instagram Direct.
--
-- Espelha o canal de WhatsApp (20260819120000_whatsapp_por_usuario) porque a
-- forma é a mesma: webhook da Meta entra, mensagem sai por Graph API, contato
-- nasce de quem escreveu. Três diferenças, e as três mudam o modelo:
--
-- 1. NÃO HÁ TELEFONE. A identidade é o IGSID (Instagram-scoped ID), um id opaco
--    que a Meta emite POR APP. O casamento de contato do WhatsApp -- últimos 8
--    dígitos do telefone -- não tem equivalente: ou já se conhece o IGSID, ou é
--    a primeira mensagem daquela pessoa.
--
-- 2. A CONTA É DA EMPRESA, NÃO DA PESSOA. No WhatsApp cada um tem o seu número
--    dentro do WABA, e o `scope_type` nasce 'user'. Um Instagram é uma presença
--    da empresa: um perfil, várias pessoas respondendo. Aqui o padrão é 'org',
--    e é o mesmo idioma da caixa de e-mail compartilhada.
--
-- 3. O TOKEN É DA CONEXÃO, NÃO DA ORGANIZAÇÃO. `whatsapp_secrets` é único por
--    org porque existe um WABA. Cada conta de Instagram tem o próprio token de
--    longa duração, então o segredo pende da conexão.
--
-- Não renomeei `whatsapp_messages` para uma tabela única de mensagens. As quatro
-- funções do painel (`sdr_metrics`, `sdr_series`, `sdr_by_owner`,
-- `sdr_metric_leads`) leem essa tabela pelo nome, e o CLAUDE.md registra que
-- mexer numa exige mexer nas outras -- com testes travando os critérios. O custo
-- de renomear é alto e o ganho é zero: quem precisa das duas juntas é UMA tela.
-- Então as duas tabelas ficam separadas e a tela lê uma VIEW (parte 5).

-- ---------- 1. A conta de Instagram ----------
CREATE TABLE IF NOT EXISTS public.instagram_connections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Quem conectou. Serve para auditoria mesmo quando o escopo é 'org': é a
  -- pessoa que autorizou o app na conta do Instagram.
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'org' é o PADRÃO aqui, ao contrário do WhatsApp. Ver o cabeçalho.
  scope_type   text NOT NULL DEFAULT 'org' CHECK (scope_type IN ('user', 'org')),

  -- O id da conta profissional na Graph API. É ele que vai no caminho do envio
  -- (`POST /<ig_user_id>/messages`) e o que o webhook devolve para dizer qual
  -- conta recebeu.
  ig_user_id   text NOT NULL,
  username     text,
  -- Nome de exibição do perfil, para a interface não mostrar só o @.
  display_name text,
  profile_pic_url text,

  -- Segredo compartilhado do handshake do webhook. Mesma coluna e mesmo papel
  -- de whatsapp_business_accounts.webhook_verify_token.
  webhook_verify_token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),

  is_active    boolean NOT NULL DEFAULT true,
  connected_at timestamptz NOT NULL DEFAULT now(),

  -- Teto diário, igual ao do WhatsApp e pelo mesmo motivo: protege a conta de
  -- automação descontrolada. No Instagram não há tier de conversas iniciadas
  -- (não se pode iniciar conversa), mas há limite de chamadas por hora, e uma
  -- automação em laço queima a cota da conta inteira.
  daily_send_limit int NOT NULL DEFAULT 1000,
  sent_today       int NOT NULL DEFAULT 0,
  sent_today_date  date
);

-- Uma conta de Instagram pertence a uma organização só. Global e não por org,
-- igual ao índice do WhatsApp: o webhook resolve por `ig_user_id` sem saber de
-- qual organização se trata, então a busca tem de ser inequívoca.
CREATE UNIQUE INDEX IF NOT EXISTS instagram_connections_conta_key
  ON public.instagram_connections (ig_user_id) WHERE is_active;

CREATE UNIQUE INDEX IF NOT EXISTS instagram_connections_token_key
  ON public.instagram_connections (webhook_verify_token);

CREATE INDEX IF NOT EXISTS idx_instagram_connections_org
  ON public.instagram_connections (org_id) WHERE is_active;

ALTER TABLE public.instagram_connections ENABLE ROW LEVEL SECURITY;

-- O token do webhook NÃO sai por aqui: ver a view da parte 6, que é o que a
-- interface lê. Esta policy existe para o restante das colunas.
CREATE POLICY "instagram_connections_select" ON public.instagram_connections FOR SELECT
  USING (
    public.user_belongs_to_org(auth.uid(), org_id)
    AND (
      public.is_org_admin(auth.uid(), org_id)
      OR scope_type = 'org'
      OR user_id = auth.uid()
    )
  );

-- Conectar e desconectar é de admin. Diferente do WhatsApp, onde cada um
-- reivindica o próprio número: aqui a conta é da empresa, e quem a liga decide
-- por todos.
CREATE POLICY "instagram_connections_write" ON public.instagram_connections FOR ALL
  USING (public.is_org_admin(auth.uid(), org_id))
  WITH CHECK (public.is_org_admin(auth.uid(), org_id));

COMMENT ON TABLE public.instagram_connections IS
  'Conta profissional de Instagram da organização. scope_type nasce ''org'' porque um perfil é presença da empresa, não linha de uma pessoa.';
COMMENT ON COLUMN public.instagram_connections.ig_user_id IS
  'Id da conta na Graph API. Vai no caminho do envio e é como o webhook diz qual conta recebeu.';

-- ---------- 2. O token, fora do alcance do navegador ----------
-- Mesmo padrão de whatsapp_secrets e google_oauth_secrets: RLS ligada e ZERO
-- policy. Só o service_role lê, ou seja só edge function. Um token de longa
-- duração do Instagram dá acesso de leitura e ESCRITA às mensagens da conta --
-- em integration_configs, que o navegador do admin lê, seria o mesmo que
-- publicá-lo.
CREATE TABLE IF NOT EXISTS public.instagram_secrets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL UNIQUE REFERENCES public.instagram_connections(id) ON DELETE CASCADE,
  access_token  text NOT NULL,
  -- O token de longa duração vale 60 dias e é RENOVÁVEL. Sem esta data não há
  -- como saber que ele está perto de vencer, e a integração morre em silêncio
  -- dois meses depois de conectar -- que é o pior modo de falhar, porque
  -- ninguém liga a causa ao efeito.
  expires_at    timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.instagram_secrets ENABLE ROW LEVEL SECURITY;
-- Propositalmente sem CREATE POLICY. Ver comentário acima.

COMMENT ON TABLE public.instagram_secrets IS
  'Token de longa duração da conta de Instagram. RLS ligada SEM policy: só service_role lê. Não criar policy aqui.';

-- ---------- 3. A identidade do Instagram no contato ----------
-- `linkedin_url` já é identidade social de primeira classe em contacts, então há
-- precedente para o @. O IGSID é outra natureza -- id de API, não perfil -- mas
-- mora aqui pelo mesmo motivo que `phone`: é por ele que o webhook reencontra a
-- pessoa na segunda mensagem.
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS instagram_username text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS instagram_igsid text;

-- Por org e não global: o IGSID é escopado ao APP, então é o mesmo id em todas
-- as organizações deste CRM. Duas empresas atendendo a mesma pessoa têm cada uma
-- o seu contato, e um índice global impediria a segunda.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_instagram_igsid_key
  ON public.contacts (org_id, instagram_igsid) WHERE instagram_igsid IS NOT NULL;

COMMENT ON COLUMN public.contacts.instagram_igsid IS
  'Instagram-scoped ID: id opaco emitido POR APP. É a chave que reencontra a pessoa nas mensagens seguintes. Uma pessoa que escreva de duas contas gera dois contatos -- mesma limitação de contacts.phone.';

-- ---------- 4. As mensagens ----------
CREATE TABLE IF NOT EXISTS public.instagram_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.instagram_connections(id) ON DELETE SET NULL,
  -- Quem respondeu, quando saiu do CRM. Nulo no que entra.
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- SET NULL e não NO ACTION: as quatro FKs que bloqueiam exclusão de contato
  -- estão listadas no CLAUDE.md, e mensagem não entra nessa lista -- apagar um
  -- contato não deve depender de apagar o histórico primeiro.
  contact_id    uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  deal_id       uuid REFERENCES public.deals(id) ON DELETE SET NULL,

  direction     text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  -- `mid` da Meta. UNIQUE porque é a chave do upsert idempotente: a Meta
  -- reentrega o webhook quando não recebe 200, e sem isto a reentrega
  -- duplicaria a mensagem na tela.
  ig_message_id text,
  from_igsid    text NOT NULL,
  to_igsid      text NOT NULL,
  body          text,
  -- 'text' | 'image' | 'video' | 'audio' | 'share' | 'story_mention' |
  -- 'story_reply' | 'unsupported'. Sem CHECK: a Meta acrescenta tipo sem avisar,
  -- e um CHECK aqui transformaria "tipo novo" em mensagem PERDIDA -- o webhook
  -- falharia no insert e a Meta desativaria o webhook depois de algumas
  -- tentativas. O desconhecido entra como 'unsupported' e o `raw` guarda tudo.
  message_type  text NOT NULL DEFAULT 'text',
  status        text NOT NULL DEFAULT 'sent',
  error_message text,
  raw           jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS instagram_messages_mid_key
  ON public.instagram_messages (ig_message_id) WHERE ig_message_id IS NOT NULL;

-- A consulta da tela: as mensagens de um contato, em ordem.
CREATE INDEX IF NOT EXISTS idx_instagram_messages_contato
  ON public.instagram_messages (org_id, contact_id, created_at DESC);

-- A consulta da janela de 24h: a última que ENTROU de um contato.
CREATE INDEX IF NOT EXISTS idx_instagram_messages_entrada
  ON public.instagram_messages (contact_id, created_at DESC)
  WHERE direction = 'inbound';

ALTER TABLE public.instagram_messages ENABLE ROW LEVEL SECURITY;

-- Conexão de escopo 'org' é visível a toda a organização -- é o ponto: um perfil
-- de empresa com várias pessoas atendendo. A cláusula `user_id = auth.uid()`
-- cobre o caso 'user', que existe para conta pessoal de quem faz prospecção.
CREATE POLICY "instagram_messages_select" ON public.instagram_messages FOR SELECT
  USING (
    public.user_belongs_to_org(auth.uid(), org_id)
    AND (
      public.is_org_admin(auth.uid(), org_id)
      OR EXISTS (
        SELECT 1 FROM public.instagram_connections ic
        WHERE ic.id = instagram_messages.connection_id
          AND (ic.scope_type = 'org' OR ic.user_id = auth.uid())
      )
    )
  );

-- Escrever é da edge function, com service role. Não há policy de INSERT de
-- propósito: mensagem que o navegador insere direto seria histórico inventado,
-- sem nada correspondente no Instagram.
COMMENT ON TABLE public.instagram_messages IS
  'Direct do Instagram. Sem policy de escrita: quem grava é edge function com service role, depois de a Meta confirmar.';
COMMENT ON COLUMN public.instagram_messages.message_type IS
  'Sem CHECK de propósito: tipo novo da Meta não pode virar mensagem perdida. O desconhecido entra como unsupported e raw guarda o original.';

-- ---------- 5. Cota de envio, atômica ----------
-- Cópia estrutural de reserve_whatsapp_send: um UPDATE que checa e incrementa de
-- uma vez, para envio concorrente não furar o teto.
CREATE OR REPLACE FUNCTION public.reserve_instagram_send(_connection_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok boolean;
BEGIN
  UPDATE public.instagram_connections
  SET
    sent_today = CASE WHEN sent_today_date = CURRENT_DATE THEN sent_today + 1 ELSE 1 END,
    sent_today_date = CURRENT_DATE
  WHERE id = _connection_id
    AND is_active
    AND (
      sent_today_date IS DISTINCT FROM CURRENT_DATE
      OR sent_today < daily_send_limit
    )
  RETURNING true INTO ok;

  RETURN COALESCE(ok, false);
END;
$$;

-- ---------- 6. A view que a tela de atendimento lê ----------
-- Um SELECT em vez de dois mais junção no cliente. `UNION ALL` e não `UNION`:
-- não há linha repetida entre as tabelas, e `UNION` pagaria um DISTINCT sobre
-- tudo.
--
-- `security_invoker = on` é o que faz a RLS das tabelas-base valer para QUEM
-- CHAMA. Sem isso a view roda com os direitos de quem a criou -- o postgres --
-- e viraria um vazamento: qualquer membro de qualquer organização leria as
-- mensagens de todas as outras. É o defeito clássico de view sobre tabela com
-- RLS, e é silencioso, porque a view funciona.
CREATE OR REPLACE VIEW public.mensagens_do_atendimento
WITH (security_invoker = on) AS
  SELECT
    'whatsapp'::text  AS canal,
    m.id,
    m.org_id,
    m.connection_id,
    m.user_id,
    m.contact_id,
    m.deal_id,
    m.direction,
    m.body,
    m.message_type,
    m.status,
    m.error_message,
    m.created_at,
    m.from_number    AS de,
    m.to_number      AS para,
    m.wa_message_id  AS id_externo
  FROM public.whatsapp_messages m
  UNION ALL
  SELECT
    'instagram'::text AS canal,
    m.id,
    m.org_id,
    m.connection_id,
    m.user_id,
    m.contact_id,
    m.deal_id,
    m.direction,
    m.body,
    m.message_type,
    m.status,
    m.error_message,
    m.created_at,
    m.from_igsid      AS de,
    m.to_igsid        AS para,
    m.ig_message_id   AS id_externo
  FROM public.instagram_messages m;

COMMENT ON VIEW public.mensagens_do_atendimento IS
  'WhatsApp e Instagram numa leitura só, para a tela de Atendimento. security_invoker=on: sem isso a RLS das tabelas-base seria ignorada e a view vazaria mensagem entre organizações.';

-- ---------- 7. A janela de 24 horas ----------
-- REGRA DA META, e vale para os dois canais: resposta livre só até 24h depois da
-- última mensagem da PESSOA. Depois disso o Instagram só aceita envio com a
-- etiqueta `human_agent`, que estende para 7 dias e exige que haja um humano
-- respondendo -- é o nosso caso, mas não é carta branca: passados os 7 dias não
-- há como escrever, ponto.
--
-- Função e não coluna calculada na tela porque quem precisa decidir é o ENVIO,
-- na edge function, antes de gastar a chamada. A tela usa a mesma função para
-- explicar por que o campo está bloqueado, e assim as duas não divergem.
CREATE OR REPLACE FUNCTION public.instagram_janela(_contact_id uuid)
RETURNS TABLE (
  ultima_entrada timestamptz,
  livre_ate      timestamptz,
  humano_ate     timestamptz,
  pode_responder boolean,
  precisa_etiqueta boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ultima AS (
    SELECT max(created_at) AS quando
    FROM public.instagram_messages
    WHERE contact_id = _contact_id
      AND direction = 'inbound'
  )
  SELECT
    u.quando,
    u.quando + interval '24 hours',
    u.quando + interval '7 days',
    u.quando IS NOT NULL AND now() < u.quando + interval '7 days',
    u.quando IS NOT NULL AND now() >= u.quando + interval '24 hours'
  FROM ultima u;
$$;

COMMENT ON FUNCTION public.instagram_janela(uuid) IS
  'Janela de resposta da Meta para um contato: livre até 24h, com etiqueta human_agent até 7 dias, depois nada. Uma função só para envio e tela não divergirem.';

-- ---------- 8. Quando a credencial vence, sem expor a credencial ----------
-- `instagram_secrets` tem RLS ligada e ZERO policy, então o navegador não lê
-- NADA de lá -- nem o `expires_at`, que é inofensivo. Sem esta função o cartão
-- de Integrações diria "sem vencimento" para uma conexão válida: um sintoma que
-- parece defeito da conexão e é defeito da consulta.
--
-- SECURITY DEFINER para atravessar a RLS, e a checagem de pertencimento
-- explícita no corpo -- que é o que impede a função de virar o vazamento que a
-- tabela evita. Devolve só a DATA, nunca o token.
CREATE OR REPLACE FUNCTION public.instagram_token_vence_em(_connection_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid;
  _quando timestamptz;
BEGIN
  SELECT org_id INTO _org_id
  FROM public.instagram_connections
  WHERE id = _connection_id;

  IF _org_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- A checagem que uma SECURITY DEFINER sem WHERE de organização esqueceria.
  IF NOT public.user_belongs_to_org(auth.uid(), _org_id) THEN
    RETURN NULL;
  END IF;

  SELECT expires_at INTO _quando
  FROM public.instagram_secrets
  WHERE connection_id = _connection_id;

  RETURN _quando;
END;
$$;

COMMENT ON FUNCTION public.instagram_token_vence_em(uuid) IS
  'Data de vencimento do token, para o cartão de Integrações avisar antes de a integração morrer. Devolve só a data -- nunca o token. Confere pertencimento no corpo porque é SECURITY DEFINER.';
