-- ============================================================================
-- Todo contato entra no funil, na etapa inicial
-- ============================================================================
--
-- Decisão do usuário, e a razão é boa: para acompanhar o processo de alguém é
-- preciso que essa pessoa esteja no quadro desde a entrada. Com o funil
-- alimentado só por qualificação manual, a primeira coluna ficava
-- permanentemente vazia -- havia uma etapa chamada "Lead" e os leads moravam em
-- outra tela.
--
-- ---------------------------------------------------------------------------
-- O efeito colateral que isto obriga a corrigir junto
-- ---------------------------------------------------------------------------
--
-- "Oportunidades geradas" no painel é `count(*) FROM deals`. Se todo contato
-- vira negócio, esse número deixa de contar oportunidade e passa a contar
-- CADASTRO: importar 500 pessoas anunciaria 500 oportunidades geradas, sem
-- ninguém ter avaliado nenhuma. É o mesmo defeito que "Abordagens realizadas"
-- tinha, e seria estranho corrigir um e criar o outro no mesmo mês.
--
-- Então oportunidade passa a ser negócio que SAIU da etapa de entrada. Estar no
-- funil vira o padrão; ter avançado é que é o feito. As duas coisas que o
-- usuário quer -- ver todo mundo no quadro e ter um número honesto -- passam a
-- caber juntas.
--
-- A etapa de entrada é identificada pelo menor `order`, não pelo nome: o
-- usuário já avisou que vai renomear "Lead", e um número de painel não pode
-- depender de um rótulo que alguém edita numa tela de configuração.

-- ---------- 1. Etapa de entrada de um funil ----------

CREATE OR REPLACE FUNCTION public.etapa_de_entrada(_pipeline_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT id FROM public.pipeline_stages
   WHERE pipeline_id = _pipeline_id
   ORDER BY "order" ASC, created_at ASC
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.etapa_de_entrada(uuid) IS
  'Primeira etapa do funil, por ordem. Identificada pelo order e não pelo nome, que é editável pelo usuário.';

-- ---------- 2. Criar o negócio de entrada ----------

CREATE OR REPLACE FUNCTION public.criar_negocio_de_entrada(_contact_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   uuid;
  v_nome     text;
  v_owner_id uuid;
  v_pipeline uuid;
  v_stage_id uuid;
  v_deal_id  uuid;
BEGIN
  SELECT org_id,
         nullif(trim(concat_ws(' ', first_name, last_name)), ''),
         owner_id
    INTO v_org_id, v_nome, v_owner_id
  FROM public.contacts WHERE id = _contact_id;

  IF v_org_id IS NULL THEN RETURN NULL; END IF;

  -- Idempotente: contato que já tem negócio não ganha outro. Sem isto, uma
  -- reimportação ou um caminho que crie negócio por conta própria (lead-capture
  -- com deal_name explícito) produziria duplicata silenciosa -- e nada no banco
  -- impede N negócios por contato.
  IF EXISTS (SELECT 1 FROM public.deals WHERE contact_id = _contact_id) THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_pipeline
  FROM public.pipelines
  WHERE org_id = v_org_id
  ORDER BY is_default DESC NULLS LAST, created_at ASC
  LIMIT 1;

  IF v_pipeline IS NULL THEN RETURN NULL; END IF;

  v_stage_id := public.etapa_de_entrada(v_pipeline);

  -- Organização sem etapa nenhuma: não dá para criar negócio válido. Silêncio é
  -- proposital -- levantar exceção aqui faria o INSERT do CONTATO falhar, e
  -- perder o cadastro por causa do funil seria pior do que não ter o card.
  IF v_stage_id IS NULL THEN RETURN NULL; END IF;

  -- owner_id explícito: a policy deals_insert exige owner_id = auth.uid() para
  -- quem é 'member'. Aqui a função é SECURITY DEFINER e contorna a RLS, mas o
  -- dono ainda precisa estar certo, senão deals_select esconde o negócio de
  -- todo mundo que não é admin -- inclusive de quem acabou de cadastrar.
  INSERT INTO public.deals (org_id, title, contact_id, stage_id, value, status, owner_id)
  VALUES (v_org_id, 'Lead: ' || coalesce(v_nome, 'sem nome'), _contact_id,
          v_stage_id, 0, 'open', v_owner_id)
  RETURNING id INTO v_deal_id;

  RETURN v_deal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_negocio_de_entrada(uuid) FROM public;

-- ---------- 3. O gatilho ----------
--
-- No banco, não nas telas. São seis caminhos de criação de contato -- modal,
-- importação CSV, wizard de setup, webhook do WhatsApp, API pública e
-- lead-capture -- e cobrir cinco deles deixaria o sexto criando gente que não
-- aparece no funil, que é exatamente o defeito que estamos consertando.

CREATE OR REPLACE FUNCTION public.tg_contato_entra_no_funil()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.criar_negocio_de_entrada(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS contato_entra_no_funil ON public.contacts;
CREATE TRIGGER contato_entra_no_funil
  AFTER INSERT ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.tg_contato_entra_no_funil();

-- ---------- 4. Quem já estava cadastrado ----------
--
-- Sem isto o quadro continuaria vazio para a base atual, e a mudança pareceria
-- não ter funcionado. Só quem não tem negócio nenhum.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.contacts c
            WHERE NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.contact_id = c.id)
  LOOP
    PERFORM public.criar_negocio_de_entrada(r.id);
  END LOOP;
END $$;

-- ---------- 5. Qualificar passa a MOVER, não a criar ----------
--
-- Antes ela inseria um negócio na primeira etapa. Com o gatilho, esse negócio já
-- existe -- e qualificar criaria um segundo, no mesmo lugar, deixando o contato
-- com duas fichas idênticas no quadro.
--
-- Agora ela avança o negócio existente para a etapa SEGUINTE, que é o que
-- "qualificar" significa quando todo mundo já entra no funil.
CREATE OR REPLACE FUNCTION public.qualify_lead(p_contact_id uuid, p_pipeline_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_org_id     uuid;
  v_name       text;
  v_entrada    uuid;
  v_proxima    uuid;
  v_deal_id    uuid;
  v_owner_id   uuid;
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

  v_entrada := public.etapa_de_entrada(p_pipeline_id);

  IF v_entrada IS NULL THEN
    RAISE EXCEPTION 'O funil selecionado não tem etapas. Crie ao menos uma etapa antes de qualificar.';
  END IF;

  -- A etapa seguinte à de entrada. Funil de uma etapa só: fica onde está, e o
  -- que muda é o ciclo de vida do contato -- não é erro, é um funil sem para
  -- onde avançar.
  SELECT id INTO v_proxima
  FROM pipeline_stages
  WHERE pipeline_id = p_pipeline_id AND org_id = v_org_id
    AND "order" > (SELECT "order" FROM pipeline_stages WHERE id = v_entrada)
  ORDER BY "order" ASC
  LIMIT 1;

  UPDATE contacts
  SET lifecycle_stage = 'opportunity',
      qualified_at    = coalesce(qualified_at, now()),
      qualified_by    = coalesce(qualified_by, auth.uid()),
      owner_id        = coalesce(owner_id, auth.uid())
  WHERE id = p_contact_id;

  -- O negócio de entrada, se existir: move.
  SELECT id INTO v_deal_id
  FROM deals
  WHERE contact_id = p_contact_id AND status = 'open'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_deal_id IS NOT NULL THEN
    UPDATE deals SET stage_id = coalesce(v_proxima, v_entrada) WHERE id = v_deal_id;
    RETURN v_deal_id;
  END IF;

  -- Sem negócio (contato de antes do gatilho, ou negócio fechado): cria já na
  -- etapa seguinte, porque qualificar não devolve ninguém para a entrada.
  INSERT INTO deals (org_id, title, contact_id, stage_id, value, status, owner_id)
  VALUES (v_org_id, 'Lead: ' || v_name, p_contact_id,
          coalesce(v_proxima, v_entrada), 0, 'open', v_owner_id)
  RETURNING id INTO v_deal_id;

  RETURN v_deal_id;
END;
$$;
