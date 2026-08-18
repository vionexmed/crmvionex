-- ============================================================================
-- PLANO 3 — Onboarding herdado pelo funcionário + camada analítica do Power BI
-- ============================================================================
-- A configuração da empresa é feita UMA vez, pelo dono. Funcionário herda e
-- nunca configura. O front já foi ajustado; aqui fica o que depende do banco.
-- ============================================================================

-- ---------- 1. Backfill: ninguém mais cai no wizard de empresa ----------
-- Perfis anteriores a 2026-07-02 nasceram com onboarding_completed = false e
-- nenhuma migração os corrigiu. Se um deles for member, o wizard bloqueante
-- abriria e o passo Empresa renomearia a organização do dono.
--
-- Regra: quem está numa org que JÁ tem dados não precisa configurar nada.
UPDATE public.profiles p
SET onboarding_completed = true
WHERE p.onboarding_completed IS NOT TRUE
  AND p.org_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.contacts c WHERE c.org_id = p.org_id
    UNION ALL
    SELECT 1 FROM public.pipelines pl WHERE pl.org_id = p.org_id
  );

-- Quem não é owner/admin nunca deve ver configuração de empresa, mesmo em org
-- vazia — não é ele quem vai configurar.
UPDATE public.profiles p
SET onboarding_completed = true
WHERE p.onboarding_completed IS NOT TRUE
  AND p.org_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p.id AND ur.org_id = p.org_id
      AND ur.role IN ('owner', 'admin')
  );

-- ---------- 2. Convite: fechar o furo do claim ----------
-- O trigger mark_invitation_accepted marca accepted_at no insert do profile, e
-- claim_pending_invitation só procurava convite com accepted_at IS NULL. No
-- fluxo normal ela retornava 'no_pending_invitation' e nunca garantia o
-- onboarding_completed. Passa a aceitar convite recém-aceito.
CREATE OR REPLACE FUNCTION public.claim_pending_invitation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_email text;
  v_inv   RECORD;
  v_org   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_authenticated');
  END IF;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  IF v_email = '' THEN
    SELECT lower(email) INTO v_email FROM public.profiles WHERE id = v_uid;
  END IF;
  IF v_email IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'no_email');
  END IF;

  SELECT org_id INTO v_org FROM public.profiles WHERE id = v_uid;

  -- Convite pendente OU aceito nas últimas 24h (o trigger marca no insert).
  SELECT * INTO v_inv
  FROM public.invitations
  WHERE lower(email) = v_email
    AND (accepted_at IS NULL OR accepted_at > now() - interval '24 hours')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_inv.id IS NULL THEN
    -- Sem convite: garante que quem já está numa org não veja wizard.
    IF v_org IS NOT NULL THEN
      UPDATE public.profiles SET onboarding_completed = true
      WHERE id = v_uid
        AND onboarding_completed IS NOT TRUE
        AND NOT EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = v_uid AND ur.org_id = v_org
            AND ur.role IN ('owner', 'admin')
        );
    END IF;
    RETURN jsonb_build_object('claimed', false, 'reason', 'no_pending_invitation');
  END IF;

  -- Já está na org do convite: garante papel, marca aceito e pula onboarding.
  IF v_org = v_inv.org_id THEN
    INSERT INTO public.user_roles (user_id, org_id, role)
    VALUES (v_uid, v_inv.org_id, coalesce(v_inv.role, 'member'))
    ON CONFLICT (user_id, org_id) DO UPDATE SET role = EXCLUDED.role;

    UPDATE public.profiles SET onboarding_completed = true WHERE id = v_uid;
    UPDATE public.invitations SET accepted_at = coalesce(accepted_at, now()) WHERE id = v_inv.id;

    RETURN jsonb_build_object('claimed', true, 'org_id', v_inv.org_id, 'role', v_inv.role);
  END IF;

  -- Não move quem já está numa org "de verdade" — admin resolve à mão.
  IF v_org IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.contacts WHERE org_id = v_org)
       OR (SELECT count(*) FROM public.user_roles WHERE org_id = v_org) > 1 THEN
      RETURN jsonb_build_object('claimed', false, 'reason', 'user_already_in_active_org');
    END IF;
  END IF;

  -- Move para a org do convite e limpa a org órfã.
  UPDATE public.profiles
  SET org_id = v_inv.org_id, onboarding_completed = true
  WHERE id = v_uid;

  DELETE FROM public.user_roles WHERE user_id = v_uid AND org_id IS DISTINCT FROM v_inv.org_id;

  INSERT INTO public.user_roles (user_id, org_id, role)
  VALUES (v_uid, v_inv.org_id, coalesce(v_inv.role, 'member'))
  ON CONFLICT (user_id, org_id) DO UPDATE SET role = EXCLUDED.role;

  UPDATE public.invitations SET accepted_at = coalesce(accepted_at, now()) WHERE id = v_inv.id;

  IF v_org IS NOT NULL AND v_org <> v_inv.org_id THEN
    DELETE FROM public.organizations o
    WHERE o.id = v_org
      AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE org_id = o.id)
      AND NOT EXISTS (SELECT 1 FROM public.contacts  WHERE org_id = o.id);
  END IF;

  RETURN jsonb_build_object('claimed', true, 'org_id', v_inv.org_id, 'role', v_inv.role, 'moved', true);
END;
$$;

-- ---------- 3. Unificar moeda e fuso ----------
-- settings.default_currency (escrita pelo onboarding) e settings.currency
-- (escrita por Settings) eram chaves diferentes do MESMO json: editar num lugar
-- não atualizava o outro. Passam a existir as duas com o mesmo valor.
UPDATE public.organizations
SET settings = settings
  || jsonb_build_object('currency', coalesce(settings ->> 'currency', settings ->> 'default_currency', 'BRL'))
  || jsonb_build_object('default_currency', coalesce(settings ->> 'currency', settings ->> 'default_currency', 'BRL'))
WHERE settings ? 'currency' OR settings ? 'default_currency' OR settings IS NOT NULL;

-- Fuso do perfil vazio herda o da organização.
UPDATE public.profiles p
SET timezone = o.settings ->> 'timezone'
FROM public.organizations o
WHERE p.org_id = o.id
  AND (p.timezone IS NULL OR p.timezone = '')
  AND o.settings ->> 'timezone' IS NOT NULL;

-- ---------- 4. Camada analítica para o Power BI ----------
-- Power BI Desktop é gratuito e tem conector nativo de PostgreSQL. Em vez de
-- entregar a credencial do banco, expomos um schema com views de leitura e um
-- papel que só alcança esse schema.
--
-- ATENÇÃO: papel de banco NÃO passa pela RLS. As views veem todos os dados da
-- instância. Hoje há uma organização só; com mais de uma, filtre por org_id
-- aqui ou crie um papel por organização.
CREATE SCHEMA IF NOT EXISTS analytics;

COMMENT ON SCHEMA analytics IS
  'Views de leitura para BI externo (Power BI). Sem RLS — ver ressalva na migração 20260817180000.';

CREATE OR REPLACE VIEW analytics.v_leads AS
SELECT c.id,
       c.org_id,
       c.created_at,
       c.lifecycle_stage,
       c.title                              AS especialidade,
       c.metadata ->> 'source'              AS origem,
       c.metadata ->> 'cidade'              AS cidade,
       c.metadata ->> 'pacientes_mes'       AS pacientes_mes,
       c.metadata ->> 'equipamento_atual'   AS equipamento_atual,
       c.metadata ->> 'interesse'           AS nivel_interesse,
       c.owner_id,
       p.name                               AS responsavel,
       c.qualified_at,
       c.disqualified_at,
       c.lead_score
FROM public.contacts c
LEFT JOIN public.profiles p ON p.id = c.owner_id;

CREATE OR REPLACE VIEW analytics.v_funil AS
SELECT d.id,
       d.org_id,
       d.created_at,
       d.close_date,
       d.status,
       d.value,
       d.currency,
       s.name                AS etapa,
       s."order"             AS etapa_ordem,
       pl.name               AS funil,
       d.owner_id,
       p.name                AS responsavel,
       d.loss_reason         AS motivo_perda,
       d.contact_id
FROM public.deals d
LEFT JOIN public.pipeline_stages s ON s.id = d.stage_id
LEFT JOIN public.pipelines pl      ON pl.id = s.pipeline_id
LEFT JOIN public.profiles p        ON p.id = d.owner_id;

CREATE OR REPLACE VIEW analytics.v_atividades AS
SELECT a.id,
       a.org_id,
       a.created_at,
       a.type          AS tipo,
       a.due_date,
       a.completed_at,
       a.user_id,
       p.name          AS responsavel,
       a.contact_id,
       a.deal_id
FROM public.activities a
LEFT JOIN public.profiles p ON p.id = a.user_id;

CREATE OR REPLACE VIEW analytics.v_mensagens_whatsapp AS
SELECT w.id,
       w.org_id,
       w.created_at,
       w.direction AS direcao,
       w.status,
       w.contact_id
FROM public.whatsapp_messages w;

CREATE OR REPLACE VIEW analytics.v_emails AS
SELECT e.id,
       e.org_id,
       e.created_at,
       e.direction AS direcao,
       e.status,
       e.open_count,
       e.click_count,
       e.contact_id,
       e.deal_id,
       e.user_id
FROM public.emails e;

-- Papel somente-leitura restrito ao schema analytics.
-- A SENHA precisa ser definida à mão depois (ver docs/powerbi.md); criar com
-- senha em migração deixaria o segredo versionado no repositório.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
    CREATE ROLE bi_readonly LOGIN NOINHERIT;
  END IF;
END $$;

REVOKE ALL ON SCHEMA public FROM bi_readonly;
GRANT USAGE ON SCHEMA analytics TO bi_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO bi_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics GRANT SELECT ON TABLES TO bi_readonly;

-- As views são SECURITY INVOKER por padrão no Postgres 15+, o que faria a RLS
-- do bi_readonly bloquear tudo. security_invoker = false faz a view rodar com os
-- privilégios do dono — é o comportamento desejado para BI.
ALTER VIEW analytics.v_leads              SET (security_invoker = false);
ALTER VIEW analytics.v_funil              SET (security_invoker = false);
ALTER VIEW analytics.v_atividades         SET (security_invoker = false);
ALTER VIEW analytics.v_mensagens_whatsapp SET (security_invoker = false);
ALTER VIEW analytics.v_emails             SET (security_invoker = false);
