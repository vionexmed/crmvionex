-- Remover membro da organização, de verdade.
--
-- Por que precisa de função no banco: a policy de UPDATE em `profiles` é
-- `USING (id = auth.uid())` — só o próprio perfil. Então o cliente NUNCA
-- consegue limpar o `org_id` de outra pessoa. O código antigo tentava, o erro
-- era engolido, e a tela dizia "Membro removido" enquanto a pessoa continuava
-- na organização com o papel apagado. Era exatamente o estado em que sobrou o
-- primeiro convidado: `org_id` preenchido, papel nulo, ainda listado.
--
-- A função resolve o segundo problema no mesmo passo: os registros da pessoa
-- (contatos, negócios, empresas, tarefas) ficariam apontando para alguém fora
-- da organização, invisíveis para o time e visíveis só para administrador.
-- Aqui eles são transferidos antes de o vínculo cair.

CREATE OR REPLACE FUNCTION public.remove_org_member(
  _user_id     uuid,
  _transfer_to uuid DEFAULT NULL
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
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT org_id INTO v_org FROM profiles WHERE id = v_caller;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Você não pertence a nenhuma organização';
  END IF;

  -- Mesma regra que as policies de `user_roles` já aplicam desde o início:
  -- mexer em papel é exclusivo do proprietário. Repetida aqui porque a função
  -- é SECURITY DEFINER e passa por cima da RLS — sem esta linha, qualquer
  -- membro removeria qualquer colega.
  IF NOT has_role(v_caller, v_org, 'owner') THEN
    RAISE EXCEPTION 'Só o proprietário pode remover membros';
  END IF;

  IF _user_id = v_caller THEN
    RAISE EXCEPTION 'Você não pode remover a si mesmo';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = _user_id AND org_id = v_org) THEN
    RAISE EXCEPTION 'Esta pessoa não pertence à sua organização';
  END IF;

  -- Sem destino escolhido, o trabalho volta para quem está removendo: é o
  -- único destino que com certeza existe e tem acesso a tudo.
  v_dest := COALESCE(_transfer_to, v_caller);

  IF v_dest = _user_id THEN
    RAISE EXCEPTION 'O destino da transferência não pode ser a própria pessoa removida';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_dest AND org_id = v_org) THEN
    RAISE EXCEPTION 'O destino da transferência não pertence à sua organização';
  END IF;

  -- 1. Transferir o trabalho, restrito à organização do chamador.
  WITH t AS (UPDATE contacts  SET owner_id = v_dest WHERE owner_id = _user_id AND org_id = v_org RETURNING 1)
  SELECT count(*) INTO v_contatos FROM t;
  WITH t AS (UPDATE deals     SET owner_id = v_dest WHERE owner_id = _user_id AND org_id = v_org RETURNING 1)
  SELECT count(*) INTO v_negocios FROM t;
  WITH t AS (UPDATE companies SET owner_id = v_dest WHERE owner_id = _user_id AND org_id = v_org RETURNING 1)
  SELECT count(*) INTO v_empresas FROM t;
  WITH t AS (UPDATE activities SET user_id = v_dest WHERE user_id  = _user_id AND org_id = v_org RETURNING 1)
  SELECT count(*) INTO v_tarefas FROM t;

  -- 2. Cortar o acesso, e o que é pessoal não se herda.
  DELETE FROM user_roles    WHERE user_id = _user_id AND org_id = v_org;
  DELETE FROM team_members  WHERE user_id = _user_id
    AND team_id IN (SELECT id FROM teams WHERE org_id = v_org);
  -- Metas NÃO são apagadas: são registro do que se esperava daquele período, e
  -- apagar seria perda de histórico. Ficam apontando para quem saiu, aparecendo
  -- só para administrador. Se preferir limpar, é uma decisão sua.

  -- A conexão de Gmail é da pessoa. Deixar viva daria à empresa um canal de
  -- envio pela caixa de alguém que já saiu.
  UPDATE email_connections SET is_active = false
   WHERE user_id = _user_id AND org_id = v_org;

  -- 3. Desligar da organização. Só aqui, e só via DEFINER.
  UPDATE profiles SET org_id = NULL WHERE id = _user_id;

  -- Correspondência (`emails`) e histórico (`audit_logs`) ficam como estão:
  -- reescrever autoria falsificaria o registro, e a caixa de outra pessoa não
  -- deve mudar de dono. Seguem restritos a administrador.

  RETURN jsonb_build_object(
    'contatos', v_contatos, 'negocios', v_negocios,
    'empresas', v_empresas, 'tarefas',  v_tarefas
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_org_member(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.remove_org_member(uuid, uuid) TO authenticated;
