-- ============================================================================
-- PLANO 1 — Fundação: separar ciclo de vida de funil
-- ============================================================================
-- PROBLEMA: contacts.status faz três trabalhos ao mesmo tempo — estágio da
-- relação, roteamento de tela (/leads mostra status='lead', /contatos exclui
-- esse valor) e desfecho ('churned' reaproveitado como "lead recusado").
-- Enquanto isso o funil vive em deals.stage_id. Resultado: lead não tem funil
-- e negócio não tem ciclo de vida.
--
-- ESTRATÉGIA: migração ADITIVA. contacts.status continua existindo e é mantido
-- em sincronia por trigger, então o app continua funcionando ANTES de qualquer
-- mudança de código. A migração das telas acontece depois, uma por vez.
--
-- Também corrige aqui um problema grave e independente: leads criados via
-- service role (formulário, landing, webhook) nascem com owner_id NULL, e a
-- policy contacts_select exige owner_id = auth.uid() para quem não é admin.
-- Hoje NENHUM vendedor vê os leads que entram pelo formulário.
-- ============================================================================

-- ---------- 1. Enum de ciclo de vida ----------
-- Valores em inglês para não misturar idioma com os enums já existentes
-- (contact_status, deal_status, activity_type). Rótulos pt-BR ficam na UI.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lifecycle_stage') THEN
    CREATE TYPE public.lifecycle_stage AS ENUM (
      'lead',          -- entrou, ninguém tocou
      'contacted',     -- houve ao menos uma abordagem
      'qualified',     -- confirmado como oportunidade real
      'opportunity',   -- negócio em andamento
      'customer',      -- comprou
      'disqualified'   -- descartado (não é o mesmo que cliente perdido)
    );
  END IF;
END $$;

-- ---------- 2. Colunas de ciclo de vida e auditoria ----------
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS lifecycle_stage public.lifecycle_stage NOT NULL DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS lifecycle_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS qualified_at timestamptz,
  ADD COLUMN IF NOT EXISTS qualified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disqualified_at timestamptz;

COMMENT ON COLUMN public.contacts.lifecycle_stage IS
  'Estágio da RELAÇÃO com a pessoa. Só avança. Não confundir com deals.stage_id, que é o estágio de UM negócio e pode voltar.';
COMMENT ON COLUMN public.contacts.status IS
  'LEGADO — mantido em sincronia com lifecycle_stage por trigger durante a migração das telas. Não usar em código novo.';

-- ---------- 3. Backfill a partir do status atual ----------
-- Ressalva honesta: 'churned' era usado para DUAS coisas diferentes (cliente
-- perdido e lead recusado). Essa distinção já estava perdida antes desta
-- migração; ambos viram 'disqualified'. A partir daqui os dois casos passam a
-- ser distinguíveis, porque cliente perdido é deals.status='lost'.
--
-- O WHERE torna este bloco IDEMPOTENTE — rodar a migração duas vezes não
-- desfaz nada. Sem ele, um segundo run colapsaria 'contacted' de volta para
-- 'lead' (porque contacted deriva de status='lead') e sobrescreveria as datas
-- reais de transição.
UPDATE public.contacts
SET lifecycle_stage = CASE status
      WHEN 'prospect' THEN 'qualified'
      WHEN 'customer' THEN 'customer'
      WHEN 'churned'  THEN 'disqualified'
      ELSE 'lead'
    END::public.lifecycle_stage,
    lifecycle_changed_at = COALESCE(updated_at, created_at, now())
WHERE lifecycle_stage = 'lead'
  AND status IS DISTINCT FROM 'lead';

-- ---------- 4. Sincronia bidirecional durante a transição ----------
-- Código antigo escreve em status; código novo escreve em lifecycle_stage.
-- Este trigger mantém os dois coerentes até a última tela ser migrada, para
-- que a migração possa ser aplicada sem deploy simultâneo.
CREATE OR REPLACE FUNCTION public.sync_contact_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_from_lifecycle public.contact_status;
  v_from_status    public.lifecycle_stage;
BEGIN
  -- status derivado do ciclo de vida
  v_from_lifecycle := CASE NEW.lifecycle_stage
    WHEN 'lead'         THEN 'lead'
    WHEN 'contacted'    THEN 'lead'
    WHEN 'qualified'    THEN 'prospect'
    WHEN 'opportunity'  THEN 'prospect'
    WHEN 'customer'     THEN 'customer'
    WHEN 'disqualified' THEN 'churned'
  END::public.contact_status;

  -- ciclo de vida derivado do status
  v_from_status := CASE NEW.status
    WHEN 'lead'     THEN 'lead'
    WHEN 'prospect' THEN 'qualified'
    WHEN 'customer' THEN 'customer'
    WHEN 'churned'  THEN 'disqualified'
    ELSE 'lead'
  END::public.lifecycle_stage;

  IF TG_OP = 'INSERT' THEN
    -- Quem informou explicitamente manda; na dúvida, deriva do status.
    IF NEW.lifecycle_stage = 'lead' AND NEW.status IS DISTINCT FROM 'lead' THEN
      NEW.lifecycle_stage := v_from_status;
    ELSE
      NEW.status := v_from_lifecycle;
    END IF;
    NEW.lifecycle_changed_at := now();
    RETURN NEW;
  END IF;

  -- UPDATE: quem mudou é a fonte da verdade
  IF NEW.lifecycle_stage IS DISTINCT FROM OLD.lifecycle_stage THEN
    NEW.status := v_from_lifecycle;
    NEW.lifecycle_changed_at := now();
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.lifecycle_stage := v_from_status;
    NEW.lifecycle_changed_at := now();
  END IF;

  -- Marcas de auditoria que antes não existiam
  IF NEW.lifecycle_stage IN ('qualified', 'opportunity')
     AND OLD.lifecycle_stage IN ('lead', 'contacted')
     AND NEW.qualified_at IS NULL THEN
    NEW.qualified_at := now();
    NEW.qualified_by := COALESCE(NEW.qualified_by, auth.uid());
  END IF;

  IF NEW.lifecycle_stage = 'disqualified' AND OLD.lifecycle_stage <> 'disqualified' THEN
    NEW.disqualified_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_contact_lifecycle ON public.contacts;
CREATE TRIGGER sync_contact_lifecycle
  BEFORE INSERT OR UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.sync_contact_lifecycle();

-- ---------- 5. Distribuição automática de responsável ----------
-- Menor carga primeiro, com desempate determinístico. Determinístico de
-- propósito: a ação assign_owner de process-automation usa Math.random(),
-- o que torna impossível auditar ou reproduzir a distribuição.
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
  GROUP BY ur.user_id
  ORDER BY count(c.id) ASC, ur.user_id ASC
  LIMIT 1;
$$;

-- Inserção por service role (lead-capture, webhooks, sync) passa a receber
-- dono em vez de ficar NULL e invisível para todo mundo que não é admin.
CREATE OR REPLACE FUNCTION public.set_default_owner_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.owner_id := COALESCE(
    NEW.owner_id,
    auth.uid(),
    public.next_round_robin_owner(NEW.org_id)
  );
  RETURN NEW;
END;
$$;

-- ---------- 6. Backfill dos registros órfãos ----------
-- Distribui em rodízio determinístico por ordem de criação. Feito com window
-- function porque next_round_robin_owner() dentro de um único UPDATE não veria
-- as próprias atribuições e jogaria todos para a mesma pessoa.
WITH membros AS (
  SELECT org_id,
         user_id,
         row_number() OVER (PARTITION BY org_id ORDER BY user_id) - 1 AS idx,
         count(*)     OVER (PARTITION BY org_id)                     AS total
  FROM public.user_roles
),
orfaos AS (
  SELECT id,
         org_id,
         row_number() OVER (PARTITION BY org_id ORDER BY created_at, id) - 1 AS rn
  FROM public.contacts
  WHERE owner_id IS NULL
)
UPDATE public.contacts c
SET owner_id = m.user_id
FROM orfaos o
JOIN membros m ON m.org_id = o.org_id AND m.idx = (o.rn % m.total)
WHERE c.id = o.id;

-- Mesmo tratamento para negócios órfãos (qualify_lead e lead-capture criavam
-- deal sem dono, tornando-o invisível para o vendedor que o gerou).
WITH membros AS (
  SELECT org_id,
         user_id,
         row_number() OVER (PARTITION BY org_id ORDER BY user_id) - 1 AS idx,
         count(*)     OVER (PARTITION BY org_id)                     AS total
  FROM public.user_roles
),
orfaos AS (
  SELECT d.id,
         d.org_id,
         row_number() OVER (PARTITION BY d.org_id ORDER BY d.created_at, d.id) - 1 AS rn
  FROM public.deals d
  WHERE d.owner_id IS NULL
)
UPDATE public.deals d
SET owner_id = m.user_id
FROM orfaos o
JOIN membros m ON m.org_id = o.org_id AND m.idx = (o.rn % m.total)
WHERE d.id = o.id;

-- ---------- 7. qualify_lead: registrar quem, quando e com que dono ----------
-- Antes: só trocava status para 'prospect' e criava deal com value 0 e sem
-- owner_id — o que fazia a policy deals_insert BLOQUEAR um usuário 'member'
-- que tentasse qualificar. Também não validava a existência de estágio, então
-- o negócio podia nascer com stage_id NULL e desaparecer do kanban.
CREATE OR REPLACE FUNCTION public.qualify_lead(p_contact_id uuid, p_pipeline_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_org_id   uuid;
  v_name     text;
  v_stage_id uuid;
  v_deal_id  uuid;
  v_owner_id uuid;
BEGIN
  SELECT org_id,
         trim(concat(first_name, ' ', coalesce(last_name, ''))),
         coalesce(owner_id, auth.uid())
    INTO v_org_id, v_name, v_owner_id
  FROM contacts
  WHERE id = p_contact_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Lead não encontrado ou sem permissão';
  END IF;

  SELECT id INTO v_stage_id
  FROM pipeline_stages
  WHERE pipeline_id = p_pipeline_id AND org_id = v_org_id
  ORDER BY "order" ASC
  LIMIT 1;

  IF v_stage_id IS NULL THEN
    RAISE EXCEPTION 'O pipeline selecionado não tem estágios. Crie ao menos um estágio antes de qualificar.';
  END IF;

  UPDATE contacts
  SET lifecycle_stage = 'opportunity',
      qualified_at    = coalesce(qualified_at, now()),
      qualified_by    = coalesce(qualified_by, auth.uid()),
      owner_id        = coalesce(owner_id, auth.uid())
  WHERE id = p_contact_id;

  -- owner_id explícito: sem ele a policy deals_insert bloqueia quem é 'member'.
  INSERT INTO deals (org_id, title, contact_id, stage_id, value, status, owner_id)
  VALUES (v_org_id, 'Lead: ' || v_name, p_contact_id, v_stage_id, 0, 'open', v_owner_id)
  RETURNING id INTO v_deal_id;

  RETURN v_deal_id;
END;
$$;

-- ---------- 8. Índices ----------
-- Os três de created_at não existiam: toda métrica por período do painel e dos
-- relatórios varria a tabela inteira.
CREATE INDEX IF NOT EXISTS idx_contacts_lifecycle
  ON public.contacts(org_id, lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_contacts_created_at
  ON public.contacts(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_email_lower
  ON public.contacts(org_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_created_at
  ON public.deals(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_contact_id
  ON public.deals(contact_id);
CREATE INDEX IF NOT EXISTS idx_activities_type_created
  ON public.activities(org_id, type, created_at DESC);
