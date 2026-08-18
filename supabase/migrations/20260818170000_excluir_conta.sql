-- ============================================================================
-- Remover membro com opção de APAGAR A CONTA
-- ============================================================================
-- Antes, remover desligava da empresa mas a conta de autenticação continuava.
-- Resultado: convidar o mesmo e-mail de novo falhava com "A user with this
-- email address has already been registered".
--
-- É seguro apagar porque as FKs de contacts/deals/companies/activities para
-- auth.users são NO ACTION: o Postgres RECUSA a exclusão se ainda houver
-- registro apontando para a pessoa. A transferência acontece antes, então
-- quando chega no DELETE não sobrou nada. profiles e user_roles são ON DELETE
-- CASCADE e saem junto, que é o desejado.
--
-- IRREVERSÍVEL. A pessoa perde a conta; o trabalho dela fica com quem herdou.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.remove_org_member(
  _user_id       uuid,
  _transfer_to   uuid DEFAULT NULL,
  _apagar_conta  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_org    uuid;
  v_dest   uuid;
  v_contatos int; v_negocios int; v_empresas int; v_tarefas int;
  v_apagada  boolean := false;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT org_id INTO v_org FROM profiles WHERE id = v_caller;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Você não pertence a nenhuma organização';
  END IF;

  IF NOT has_role(v_caller, v_org, 'owner') THEN
    RAISE EXCEPTION 'Só o proprietário pode remover membros';
  END IF;

  IF _user_id = v_caller THEN
    RAISE EXCEPTION 'Você não pode remover a si mesmo';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = _user_id AND org_id = v_org) THEN
    RAISE EXCEPTION 'Esta pessoa não pertence à sua organização';
  END IF;

  v_dest := COALESCE(_transfer_to, v_caller);

  IF v_dest = _user_id THEN
    RAISE EXCEPTION 'O destino da transferência não pode ser a própria pessoa removida';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_dest AND org_id = v_org) THEN
    RAISE EXCEPTION 'O destino da transferência não pertence à sua organização';
  END IF;

  -- 1. Transferir o trabalho. Precisa vir antes do DELETE: as FKs NO ACTION
  --    bloqueariam a exclusão enquanto houvesse registro apontando para ela.
  WITH t AS (UPDATE contacts   SET owner_id = v_dest WHERE owner_id = _user_id AND org_id = v_org RETURNING 1)
  SELECT count(*) INTO v_contatos FROM t;
  WITH t AS (UPDATE deals      SET owner_id = v_dest WHERE owner_id = _user_id AND org_id = v_org RETURNING 1)
  SELECT count(*) INTO v_negocios FROM t;
  WITH t AS (UPDATE companies  SET owner_id = v_dest WHERE owner_id = _user_id AND org_id = v_org RETURNING 1)
  SELECT count(*) INTO v_empresas FROM t;
  WITH t AS (UPDATE activities SET user_id  = v_dest WHERE user_id  = _user_id AND org_id = v_org RETURNING 1)
  SELECT count(*) INTO v_tarefas FROM t;

  -- 2. Cortar o acesso. O que é pessoal não se herda.
  DELETE FROM team_members WHERE user_id = _user_id
    AND team_id IN (SELECT id FROM teams WHERE org_id = v_org);

  UPDATE email_connections SET is_active = false
   WHERE user_id = _user_id AND org_id = v_org;

  IF _apagar_conta THEN
    -- Convites que ELA enviou têm FK NO ACTION e bloqueariam o DELETE. Passam
    -- para quem está removendo: o histórico de convite continua existindo.
    UPDATE invitations SET invited_by = v_caller
     WHERE invited_by = _user_id AND org_id = v_org;

    -- Metas e conexões de e-mail são dela e não sobrevivem à conta.
    DELETE FROM sales_goals       WHERE user_id = _user_id AND org_id = v_org;
    DELETE FROM email_connections WHERE user_id = _user_id AND org_id = v_org;

    -- Convites pendentes para o e-mail dela, para o próximo convite nascer limpo.
    DELETE FROM invitations i
     WHERE i.org_id = v_org
       AND lower(i.email) = (SELECT lower(email) FROM profiles WHERE id = _user_id);

    -- Apaga a conta. profiles e user_roles saem em cascata. Se alguma FK
    -- NO ACTION ainda apontar para ela, o Postgres levanta erro aqui — o que é
    -- proteção, não falha: significa que sobrou trabalho sem transferir.
    DELETE FROM auth.users WHERE id = _user_id;
    v_apagada := true;
  ELSE
    DELETE FROM user_roles WHERE user_id = _user_id AND org_id = v_org;
    UPDATE profiles SET org_id = NULL WHERE id = _user_id;
  END IF;

  RETURN jsonb_build_object(
    'contatos', v_contatos, 'negocios', v_negocios,
    'empresas', v_empresas, 'tarefas',  v_tarefas,
    'conta_apagada', v_apagada
  );
END;
$$;

-- A assinatura mudou (ganhou o 3º parâmetro), então a antiga de 2 argumentos
-- continuaria existindo em paralelo e a tela poderia chamar a errada.
DROP FUNCTION IF EXISTS public.remove_org_member(uuid, uuid);

REVOKE ALL   ON FUNCTION public.remove_org_member(uuid, uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.remove_org_member(uuid, uuid, boolean) TO authenticated;
