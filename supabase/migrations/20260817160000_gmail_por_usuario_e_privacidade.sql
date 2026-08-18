-- ============================================================================
-- PLANO 2 — Gmail por pessoa + privacidade entre pares + dashboard compartilhado
-- ============================================================================
-- 1. Cada pessoa conecta o próprio Gmail (hoje um índice limita a org inteira).
-- 2. Ninguém vê o atendimento nem o WhatsApp de outra pessoa.
-- 3. O dashboard continua compartilhado — via funções de agregação que devolvem
--    APENAS números, nunca linhas. É o único jeito de ter linha privada e
--    agregado público ao mesmo tempo.
--
-- Premissa: a conta principal (owner/admin) vê tudo. A privacidade é entre
-- pares, não contra o dono.
-- ============================================================================

-- ---------- 1. Gmail por pessoa ----------
ALTER TABLE public.email_connections
  ADD COLUMN IF NOT EXISTS scope_type text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS daily_send_limit int NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS sent_today int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_today_date date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_connections_scope_type_check'
  ) THEN
    ALTER TABLE public.email_connections
      ADD CONSTRAINT email_connections_scope_type_check
      CHECK (scope_type IN ('user', 'org'));
  END IF;
END $$;

COMMENT ON COLUMN public.email_connections.scope_type IS
  'user = caixa pessoal de um membro; org = caixa compartilhada da empresa (reservado, sem uso hoje).';
COMMENT ON COLUMN public.email_connections.daily_send_limit IS
  'Teto diário de envio por conexão. Existe porque enviar cadência pela caixa pessoal sem limite queima a cota do Gmail (2.000/dia no Workspace) e a reputação do domínio.';

-- Conexões que já existem pertencem a quem as conectou.
UPDATE public.email_connections ec
SET scope_type = 'user'
WHERE scope_type = 'user'  -- default; explícito para deixar a intenção clara
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = ec.user_id);

-- Este índice é o bloqueio: UNIQUE (org_id, purpose) WHERE is_active limitava a
-- org inteira a 4 conexões ativas, e a segunda pessoa a conectar derrubava a
-- primeira (gmail-oauth-callback desativa a anterior do slot antes de inserir).
DROP INDEX IF EXISTS public.email_connections_org_purpose_active_key;

-- Uma conta pessoal ativa por pessoa.
CREATE UNIQUE INDEX IF NOT EXISTS email_connections_user_active_key
  ON public.email_connections (org_id, user_id)
  WHERE is_active AND scope_type = 'user';

-- Uma caixa compartilhada ativa por finalidade (reservado para uso futuro).
CREATE UNIQUE INDEX IF NOT EXISTS email_connections_org_scope_purpose_key
  ON public.email_connections (org_id, purpose)
  WHERE is_active AND scope_type = 'org';

CREATE INDEX IF NOT EXISTS idx_email_connections_user
  ON public.email_connections (org_id, user_id) WHERE is_active;

-- ---------- 2. Distribuição de lead só para quem trabalha lead ----------
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS receives_leads boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.user_roles.receives_leads IS
  'Se falso, o membro fica fora do rodízio de distribuição. Serve para contas funcionais (marketing@, financeiro@) que têm login mas não trabalham lead.';

CREATE OR REPLACE FUNCTION public.next_round_robin_owner(_org_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT ur.user_id
  FROM public.user_roles ur
  LEFT JOIN public.contacts c
    ON c.owner_id = ur.user_id AND c.org_id = _org_id
  WHERE ur.org_id = _org_id
    AND ur.receives_leads
  GROUP BY ur.user_id
  ORDER BY count(c.id) ASC, ur.user_id ASC
  LIMIT 1;
$$;

-- ---------- 3. Vínculo do e-mail com a conexão que o trouxe ----------
ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS connection_id uuid
    REFERENCES public.email_connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_emails_connection ON public.emails(connection_id);

-- synced_from guarda o endereço da conta que sincronizou o e-mail.
UPDATE public.emails e
SET connection_id = ec.id
FROM public.email_connections ec
WHERE e.connection_id IS NULL
  AND e.org_id = ec.org_id
  AND lower(e.synced_from) = lower(ec.email_address);

-- Preenche o user_id que o gmail-sync nunca gravou — é por isso que e-mail
-- sincronizado hoje é invisível para quem não é admin.
UPDATE public.emails e
SET user_id = ec.user_id
FROM public.email_connections ec
WHERE e.user_id IS NULL
  AND e.connection_id = ec.id
  AND ec.user_id IS NOT NULL;

-- ---------- 3b. Corrigir o CHECK de emails.status ----------
-- O CHECK original permite draft|sent|received|failed|bounced, mas gmail-send e
-- gmail-sender inserem status 'sending' para obter o id de rastreio ANTES de
-- enviar — e nenhum dos dois conferia o erro do insert. Resultado: o e-mail
-- saía pelo Gmail e nunca era registrado na tabela. Como `emails` agora alimenta
-- a métrica de abordagens do painel, isso deixaria o número errado.
ALTER TABLE public.emails DROP CONSTRAINT IF EXISTS emails_status_check;
ALTER TABLE public.emails
  ADD CONSTRAINT emails_status_check
  CHECK (status IN ('draft', 'sending', 'sent', 'received', 'failed', 'bounced'));

-- ---------- 4. Privacidade entre pares ----------

-- WhatsApp: hoje QUALQUER membro da org vê a conversa de todo mundo.
--
-- O número do WhatsApp é UM só para a empresa, então a conversa é particionada
-- pelo dono do CONTATO: você vê a conversa de quem é seu.
--
-- Caso de borda, deixado explícito de propósito: mensagem que o webhook não
-- conseguiu casar com contato nenhum (contact_id nulo) fica visível apenas
-- para admin. Ninguém tem direito sobre ela, e o admin é quem tria e atribui.
-- Sem esta regra ela ficaria invisível para todos, e some sem aviso.
DROP POLICY IF EXISTS "Org members view whatsapp messages" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "whatsapp_messages_select" ON public.whatsapp_messages;
CREATE POLICY "whatsapp_messages_select" ON public.whatsapp_messages FOR SELECT
  USING (
    user_belongs_to_org(auth.uid(), org_id)
    AND (
      is_org_admin(auth.uid(), org_id)
      OR EXISTS (
        SELECT 1 FROM public.contacts c
        WHERE c.id = whatsapp_messages.contact_id
          AND c.owner_id = auth.uid()
      )
    )
  );

-- Contas de e-mail: cada um vê a própria; admin vê todas.
DROP POLICY IF EXISTS "Org members can view email connections" ON public.email_connections;
DROP POLICY IF EXISTS "email_connections_select" ON public.email_connections;
CREATE POLICY "email_connections_select" ON public.email_connections FOR SELECT
  USING (
    user_belongs_to_org(auth.uid(), org_id)
    AND (is_org_admin(auth.uid(), org_id) OR user_id = auth.uid())
  );

-- Cada um gerencia a PRÓPRIA conexão; caixa da empresa continua só para admin.
DROP POLICY IF EXISTS "Owners/admins manage email connections" ON public.email_connections;
DROP POLICY IF EXISTS "email_connections_write" ON public.email_connections;
CREATE POLICY "email_connections_write" ON public.email_connections FOR ALL
  USING (
    user_belongs_to_org(auth.uid(), org_id)
    AND (
      is_org_admin(auth.uid(), org_id)
      OR (scope_type = 'user' AND user_id = auth.uid())
    )
  )
  WITH CHECK (
    user_belongs_to_org(auth.uid(), org_id)
    AND (
      is_org_admin(auth.uid(), org_id)
      OR (scope_type = 'user' AND user_id = auth.uid())
    )
  );

-- E-mails: além do próprio, o que vem de caixa compartilhada é visível à org.
DROP POLICY IF EXISTS "emails_select" ON public.emails;
CREATE POLICY "emails_select" ON public.emails FOR SELECT
  USING (
    user_belongs_to_org(auth.uid(), org_id)
    AND (
      is_org_admin(auth.uid(), org_id)
      OR user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.email_connections ec
        WHERE ec.id = emails.connection_id AND ec.scope_type = 'org'
      )
    )
  );

-- ---------- 5. Dashboard compartilhado sem abrir as linhas ----------
-- SECURITY DEFINER: passa por cima da RLS e devolve SÓ números. Nenhuma linha,
-- nenhum identificador. É o que permite linha privada com agregado público.
CREATE OR REPLACE FUNCTION public.sdr_metrics(
  _org_id uuid,
  _from   timestamptz DEFAULT NULL,
  _to     timestamptz DEFAULT NULL
)
RETURNS TABLE (
  leads_recebidos     int,
  abordagens          int,
  taxa_entrega        int,
  taxa_resposta       int,
  conversas_iniciadas int,
  reunioes            int,
  oportunidades       int,
  vendas_sdr          int,
  tempo_resposta_min  int,
  aguardando_humano   int,
  leads_whatsapp      int
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  -- Sem esta checagem, SECURITY DEFINER vazaria números de outra empresa.
  IF NOT public.user_belongs_to_org(auth.uid(), _org_id) THEN
    RAISE EXCEPTION 'Sem permissão nesta organização';
  END IF;

  RETURN QUERY
  WITH wa AS (
    SELECT w.contact_id, w.direction, w.status, w.created_at
    FROM public.whatsapp_messages w
    WHERE w.org_id = _org_id
      AND (_from IS NULL OR w.created_at >= _from)
      AND (_to   IS NULL OR w.created_at <  _to)
  ),
  wa_contato AS (
    SELECT contact_id,
           min(created_at) FILTER (WHERE direction = 'outbound') AS primeiro_envio,
           min(created_at) FILTER (WHERE direction = 'inbound')  AS primeiro_recebido
    FROM wa
    WHERE contact_id IS NOT NULL
    GROUP BY contact_id
  ),
  wa_pares AS (
    SELECT k.contact_id,
           k.primeiro_envio,
           k.primeiro_recebido,
           (SELECT min(w.created_at) FROM wa w
             WHERE w.contact_id = k.contact_id
               AND w.direction = 'inbound'
               AND w.created_at > k.primeiro_envio)     AS lead_respondeu,
           (SELECT min(w.created_at) FROM wa w
             WHERE w.contact_id = k.contact_id
               AND w.direction = 'outbound'
               AND w.created_at > k.primeiro_recebido)  AS nos_respondemos
    FROM wa_contato k
  ),
  envio AS (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE status IN ('delivered', 'read')) AS entregue
    FROM wa WHERE direction = 'outbound'
  ),
  resposta AS (
    SELECT count(*) FILTER (WHERE primeiro_envio IS NOT NULL)  AS abordados,
           count(*) FILTER (WHERE lead_respondeu IS NOT NULL)  AS responderam,
           avg(EXTRACT(EPOCH FROM (nos_respondemos - primeiro_recebido)) / 60.0)
             FILTER (WHERE nos_respondemos IS NOT NULL)        AS minutos
    FROM wa_pares
  )
  SELECT
    -- Leads recebidos: por created_at. lifecycle_stage não serve como filtro
    -- histórico porque avança com o tempo.
    (SELECT count(*)::int FROM public.contacts c
      WHERE c.org_id = _org_id
        AND (_from IS NULL OR c.created_at >= _from)
        AND (_to   IS NULL OR c.created_at <  _to)),

    -- Abordagens: atividade de contato + e-mail enviado + WhatsApp enviado.
    (
      (SELECT count(*) FROM public.activities a
        WHERE a.org_id = _org_id AND a.type IN ('call', 'email', 'meeting')
          AND (_from IS NULL OR a.created_at >= _from)
          AND (_to   IS NULL OR a.created_at <  _to))
      + (SELECT count(*) FROM public.emails e
          WHERE e.org_id = _org_id AND e.direction = 'outbound'
            AND (_from IS NULL OR e.created_at >= _from)
            AND (_to   IS NULL OR e.created_at <  _to))
      + (SELECT total FROM envio)
    )::int,

    (SELECT CASE WHEN total > 0 THEN round(entregue * 100.0 / total)::int END FROM envio),
    (SELECT CASE WHEN abordados > 0 THEN round(responderam * 100.0 / abordados)::int END FROM resposta),
    (SELECT count(*)::int FROM wa_contato),

    (SELECT count(*)::int FROM public.activities a
      WHERE a.org_id = _org_id AND a.type = 'meeting'
        AND (_from IS NULL OR a.created_at >= _from)
        AND (_to   IS NULL OR a.created_at <  _to)),

    (SELECT count(*)::int FROM public.deals d
      WHERE d.org_id = _org_id
        AND (_from IS NULL OR d.created_at >= _from)
        AND (_to   IS NULL OR d.created_at <  _to)),

    -- Venda originada pelo SDR = ganho com contato vinculado, por close_date.
    -- Aproximação: o negócio não guarda quem o originou.
    (SELECT count(*)::int FROM public.deals d
      WHERE d.org_id = _org_id AND d.status = 'won' AND d.contact_id IS NOT NULL
        AND (_from IS NULL OR d.close_date >= _from::date)
        AND (_to   IS NULL OR d.close_date <  _to::date)),

    (SELECT round(minutos)::int FROM resposta),

    -- Fila do momento, não recorte de período: lead sem nenhuma abordagem.
    (SELECT count(*)::int FROM public.contacts c
      WHERE c.org_id = _org_id
        AND c.lifecycle_stage IN ('lead', 'contacted')
        AND NOT EXISTS (SELECT 1 FROM public.activities a WHERE a.contact_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM public.emails e
                         WHERE e.contact_id = c.id AND e.direction = 'outbound')
        AND NOT EXISTS (SELECT 1 FROM public.whatsapp_messages w
                         WHERE w.contact_id = c.id AND w.direction = 'outbound')),

    (SELECT count(*)::int FROM public.contacts c
      WHERE c.org_id = _org_id
        AND (_from IS NULL OR c.created_at >= _from)
        AND (_to   IS NULL OR c.created_at <  _to)
        AND EXISTS (SELECT 1 FROM public.whatsapp_messages w
                     WHERE w.contact_id = c.id AND w.direction = 'inbound'));
END;
$$;

REVOKE ALL ON FUNCTION public.sdr_metrics(uuid, timestamptz, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.sdr_metrics(uuid, timestamptz, timestamptz) TO authenticated;

-- ---------- 6. Teto diário de envio ----------
-- Reserva uma vaga de envio de forma atômica. Devolve false se o teto estourou.
CREATE OR REPLACE FUNCTION public.reserve_email_send(_connection_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  UPDATE public.email_connections
  SET sent_today = CASE WHEN sent_today_date = current_date THEN sent_today + 1 ELSE 1 END,
      sent_today_date = current_date
  WHERE id = _connection_id
    AND (sent_today_date IS DISTINCT FROM current_date OR sent_today < daily_send_limit)
  RETURNING true INTO v_ok;

  RETURN coalesce(v_ok, false);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_email_send(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reserve_email_send(uuid) TO authenticated, service_role;

-- ---------- 7. Sincronização automática ----------
-- Antes, gmail-sync só rodava quando alguém clicava o botão na Inbox. Com uma
-- conta por pessoa isso não escala, e o histórico do lead fica com buracos.
-- Segue o padrão de 20260702140000_automation_engine.sql:131-182 — depende do
-- segredo 'service_role_key' existir no Vault, senão o job roda como no-op.
DO $$
DECLARE
  v_url text := 'https://kschuwekbrrwmhzinsrv.supabase.co/functions/v1';
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gmail-sync-all';

  PERFORM cron.schedule(
    'gmail-sync-all',
    '*/2 * * * *',
    format($job$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{"scheduled": true, "all_orgs": true, "max": 50}'::jsonb
      )
      WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key');
    $job$, v_url || '/gmail-sync')
  );
END $$;
