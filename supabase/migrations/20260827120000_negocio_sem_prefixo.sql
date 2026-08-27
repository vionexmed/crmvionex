-- ============================================================================
-- O negócio se chama pelo nome da pessoa, sem "Lead:" na frente
-- ============================================================================
--
-- O prefixo veio de mim, em 20260826170000, e no quadro ele aparecia duas vezes:
-- "Lead: Dr Rodrigo otavio Araujo" no título e "Dr Rodrigo otavio Araujo" na
-- linha de baixo. Eu tinha resolvido escondendo o título repetido na tela --
-- consertando a aparência e deixando o dado errado.
--
-- O dado é que estava errado. "Lead:" não informa nada: a etapa do funil já diz
-- em que ponto a pessoa está, e o ciclo de vida do contato também. E o prefixo
-- vaza para fora da tela onde a duplicata era escondida -- assunto de e-mail,
-- exportação de relatório, busca. Procurar "Rodrigo" numa lista de títulos que
-- todos começam com "Lead: " é pior, não melhor.
--
-- ---------------------------------------------------------------------------
-- Uma função para a regra, três chamadores
-- ---------------------------------------------------------------------------
--
-- O prefixo estava escrito à mão em três lugares (o gatilho de entrada, a RPC de
-- qualificação e a edge function de captação), e é por isso que ele sobreviveu:
-- mudar um não muda os outros. A regra passa a morar num lugar só.

CREATE OR REPLACE FUNCTION public.titulo_de_negocio(_contact_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- first_name é NOT NULL, então o concat quase nunca é vazio; o coalesce cobre
  -- o caso de um nome só com espaços, que passaria pelo NOT NULL.
  SELECT coalesce(
           nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
           c.email,
           'Sem nome'
         )
  FROM public.contacts c
  WHERE c.id = _contact_id;
$$;

COMMENT ON FUNCTION public.titulo_de_negocio(uuid) IS
  'Título padrão de um negócio: o nome da pessoa, sem prefixo. Fonte única — o prefixo "Lead:" sobrevivia porque estava escrito à mão em três lugares.';

REVOKE ALL ON FUNCTION public.titulo_de_negocio(uuid) FROM public;

-- ---------- 1. O gatilho de entrada ----------

CREATE OR REPLACE FUNCTION public.criar_negocio_de_entrada(_contact_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id   uuid;
  v_owner_id uuid;
  v_pipeline uuid;
  v_stage_id uuid;
  v_deal_id  uuid;
BEGIN
  SELECT org_id, owner_id INTO v_org_id, v_owner_id
  FROM public.contacts WHERE id = _contact_id;

  IF v_org_id IS NULL THEN RETURN NULL; END IF;

  -- Idempotente: contato que já tem negócio não ganha outro. Sem isto, uma
  -- reimportação ou um caminho que crie negócio por conta própria produziria
  -- duplicata silenciosa -- nada no banco impede N negócios por contato.
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
  VALUES (v_org_id, public.titulo_de_negocio(_contact_id), _contact_id,
          v_stage_id, 0, 'open', v_owner_id)
  RETURNING id INTO v_deal_id;

  RETURN v_deal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_negocio_de_entrada(uuid) FROM public;

-- ---------- 2. Qualificar ----------
--
-- Ela avança o negócio existente; o INSERT aqui é só o caminho de quem não tem
-- negócio (contato de antes do gatilho, ou negócio já fechado).
CREATE OR REPLACE FUNCTION public.qualify_lead(p_contact_id uuid, p_pipeline_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_org_id   uuid;
  v_entrada  uuid;
  v_proxima  uuid;
  v_deal_id  uuid;
  v_owner_id uuid;
BEGIN
  SELECT org_id, coalesce(owner_id, auth.uid())
    INTO v_org_id, v_owner_id
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

  SELECT id INTO v_deal_id
  FROM deals
  WHERE contact_id = p_contact_id AND status = 'open'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_deal_id IS NOT NULL THEN
    UPDATE deals SET stage_id = coalesce(v_proxima, v_entrada) WHERE id = v_deal_id;
    RETURN v_deal_id;
  END IF;

  INSERT INTO deals (org_id, title, contact_id, stage_id, value, status, owner_id)
  VALUES (v_org_id, public.titulo_de_negocio(p_contact_id), p_contact_id,
          coalesce(v_proxima, v_entrada), 0, 'open', v_owner_id)
  RETURNING id INTO v_deal_id;

  RETURN v_deal_id;
END;
$$;

-- ---------- 3. Renomear o que já existe ----------
--
-- Casamento EXATO com "Lead: " + nome do contato, não por prefixo.
--
-- Um negócio que alguém renomeou à mão para "Lead: fulano da clínica X" NÃO é
-- tocado: ali o texto carrega informação que o nome do contato não tem, e
-- cortar o prefixo por LIKE apagaria isso. Vale para o histórico antigo também,
-- que usava a mesma convenção desde 20260702110000.
UPDATE public.deals d
   SET title = public.titulo_de_negocio(d.contact_id)
 WHERE d.contact_id IS NOT NULL
   AND d.title = 'Lead: ' || public.titulo_de_negocio(d.contact_id);
