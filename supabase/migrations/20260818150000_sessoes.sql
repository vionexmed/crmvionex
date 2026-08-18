-- ============================================================================
-- Sessões: quem está usando, de qual máquina, com qual conta
-- ============================================================================
-- O Supabase já guarda tudo em `auth.sessions` — user_agent, ip, criação e
-- última atividade. Mas o schema `auth` não é exposto pela API, então o cliente
-- não alcança. Daí as funções abaixo.
--
-- A aba de Sessões era fachada: mostrava um cartão fixo escrito "Este
-- dispositivo / Sessão ativa agora", sem consultar nada.
--
-- Privacidade: cada pessoa vê as próprias sessões; administrador vê as da
-- organização. É metadado de segurança, não conteúdo de atendimento.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_org_sessions()
RETURNS TABLE (
  session_id       uuid,
  user_id          uuid,
  pessoa           text,
  email            text,
  papel            text,
  user_agent       text,
  ip               text,
  criada_em        timestamptz,
  ultima_atividade timestamptz,
  expira_em        timestamptz,
  atual            boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_org   uuid;
  v_admin boolean;
  v_sess  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT org_id INTO v_org FROM profiles WHERE id = v_uid;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Você não pertence a nenhuma organização';
  END IF;

  v_admin := is_org_admin(v_uid, v_org);

  -- O token traz o id da própria sessão. É como marcamos "este dispositivo"
  -- sem depender de comparar user agent, que repete entre máquinas iguais.
  v_sess := nullif(auth.jwt() ->> 'session_id', '')::uuid;

  RETURN QUERY
  SELECT
    s.id,
    s.user_id,
    coalesce(p.name, p.email, 'Sem nome')::text,
    p.email::text,
    coalesce(ur.role::text, 'sem papel'),
    s.user_agent,
    -- `ip` é inet; host() devolve só o endereço, sem máscara de rede.
    host(s.ip)::text,
    s.created_at,
    -- O GoTrue atualiza updated_at a cada renovação de token, então ele é a
    -- última atividade real da sessão.
    s.updated_at,
    s.not_after,
    (s.id = v_sess)
  FROM auth.sessions s
  JOIN public.profiles p ON p.id = s.user_id
  LEFT JOIN public.user_roles ur ON ur.user_id = s.user_id AND ur.org_id = v_org
  WHERE p.org_id = v_org
    AND (v_admin OR s.user_id = v_uid)
  ORDER BY s.updated_at DESC;
END;
$$;

-- ---------- Encerrar uma sessão ----------
CREATE OR REPLACE FUNCTION public.revoke_session(_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_org   uuid;
  v_dono  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT org_id INTO v_org FROM profiles WHERE id = v_uid;

  SELECT s.user_id INTO v_dono FROM auth.sessions s WHERE s.id = _session_id;
  IF v_dono IS NULL THEN
    RETURN false;  -- já não existe; encerrar de novo não é erro
  END IF;

  -- Encerrar a própria sessão é sempre permitido. Encerrar a de outra pessoa é
  -- ação de resposta a incidente: exige administrador, e ela precisa estar na
  -- mesma organização — a função é DEFINER e alcançaria a instância toda.
  IF v_dono <> v_uid THEN
    IF NOT is_org_admin(v_uid, v_org) THEN
      RAISE EXCEPTION 'Só administradores encerram a sessão de outra pessoa';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_dono AND org_id = v_org) THEN
      RAISE EXCEPTION 'Esta sessão não pertence à sua organização';
    END IF;
  END IF;

  -- O refresh_token tem FK para a sessão com ON DELETE CASCADE, então apagar a
  -- sessão invalida a renovação. O access token em mãos continua válido até
  -- expirar (padrão: 1 hora) — é assim que JWT funciona, não dá para revogar
  -- um token já emitido.
  DELETE FROM auth.sessions WHERE id = _session_id;
  RETURN true;
END;
$$;

-- ---------- Encerrar TODAS as sessões de uma pessoa ----------
CREATE OR REPLACE FUNCTION public.revoke_user_sessions(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_n   integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT org_id INTO v_org FROM profiles WHERE id = v_uid;

  IF _user_id <> v_uid THEN
    IF NOT is_org_admin(v_uid, v_org) THEN
      RAISE EXCEPTION 'Só administradores encerram as sessões de outra pessoa';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = _user_id AND org_id = v_org) THEN
      RAISE EXCEPTION 'Esta pessoa não pertence à sua organização';
    END IF;
  END IF;

  WITH d AS (DELETE FROM auth.sessions WHERE user_id = _user_id RETURNING 1)
  SELECT count(*) INTO v_n FROM d;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.list_org_sessions()          FROM public;
REVOKE ALL ON FUNCTION public.revoke_session(uuid)         FROM public;
REVOKE ALL ON FUNCTION public.revoke_user_sessions(uuid)   FROM public;

GRANT EXECUTE ON FUNCTION public.list_org_sessions()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_session(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_sessions(uuid) TO authenticated;
