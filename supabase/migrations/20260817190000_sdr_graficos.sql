-- ============================================================================
-- PLANO 3 — Agregações dos gráficos do painel
-- ============================================================================
-- O painel é compartilhado (todos veem os números da empresa) enquanto as
-- linhas são privadas por pessoa. Por isso cada gráfico precisa da própria
-- função SECURITY DEFINER: buscar linha e agrupar no navegador respeitaria a
-- RLS e cada um veria só o próprio recorte.
--
-- Todas validam a organização na primeira linha e devolvem APENAS números.
-- ============================================================================

-- ---------- 1. Evolução no tempo ----------
-- Série DENSA: dia sem dado vira 0 em vez de sumir do gráfico.
CREATE OR REPLACE FUNCTION public.sdr_series(
  _org_id uuid,
  _from   timestamptz DEFAULT NULL,
  _to     timestamptz DEFAULT NULL
)
RETURNS TABLE (dia date, leads int, abordagens int, respostas int)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_ini    date;
  v_fim    date;
  v_ini_ts timestamptz;
  v_fim_ts timestamptz;  -- exclusivo
BEGIN
  IF NOT public.user_belongs_to_org(auth.uid(), _org_id) THEN
    RAISE EXCEPTION 'Sem permissão nesta organização';
  END IF;

  -- Sem período, mostra os últimos 30 dias — série longa demais vira ruído.
  v_ini := coalesce(_from, now() - interval '30 days')::date;
  v_fim := (coalesce(_to, now() + interval '1 day') - interval '1 day')::date;
  IF v_fim < v_ini THEN v_fim := v_ini; END IF;

  -- Os limites do WHERE precisam ser timestamptz CRU. Comparar
  -- `created_at::date BETWEEN ...` aplica função sobre a coluna e anula os
  -- índices (org_id, created_at) — cada subconsulta virava varredura completa.
  -- O ::date fica só no GROUP BY, onde não atrapalha.
  v_ini_ts := v_ini::timestamptz;
  v_fim_ts := (v_fim + 1)::timestamptz;

  RETURN QUERY
  WITH eixo AS (
    SELECT generate_series(v_ini, v_fim, interval '1 day')::date AS d
  ),
  novos AS (
    SELECT c.created_at::date AS d, count(*) AS n
    FROM public.contacts c
    WHERE c.org_id = _org_id
      AND c.created_at >= v_ini_ts AND c.created_at < v_fim_ts
    GROUP BY 1
  ),
  saidas AS (
    SELECT d, sum(n) AS n FROM (
      SELECT a.created_at::date AS d, count(*) AS n
        FROM public.activities a
       WHERE a.org_id = _org_id AND a.type IN ('call', 'email', 'meeting')
         AND a.created_at >= v_ini_ts AND a.created_at < v_fim_ts
       GROUP BY 1
      UNION ALL
      SELECT e.created_at::date, count(*)
        FROM public.emails e
       WHERE e.org_id = _org_id AND e.direction = 'outbound'
         AND e.created_at >= v_ini_ts AND e.created_at < v_fim_ts
       GROUP BY 1
      UNION ALL
      SELECT w.created_at::date, count(*)
        FROM public.whatsapp_messages w
       WHERE w.org_id = _org_id AND w.direction = 'outbound'
         AND w.created_at >= v_ini_ts AND w.created_at < v_fim_ts
       GROUP BY 1
    ) t GROUP BY d
  ),
  entradas AS (
    SELECT w.created_at::date AS d, count(*) AS n
    FROM public.whatsapp_messages w
    WHERE w.org_id = _org_id AND w.direction = 'inbound'
      AND w.created_at >= v_ini_ts AND w.created_at < v_fim_ts
    GROUP BY 1
  )
  SELECT eixo.d,
         coalesce(novos.n, 0)::int,
         coalesce(saidas.n, 0)::int,
         coalesce(entradas.n, 0)::int
  FROM eixo
  LEFT JOIN novos    ON novos.d = eixo.d
  LEFT JOIN saidas   ON saidas.d = eixo.d
  LEFT JOIN entradas ON entradas.d = eixo.d
  ORDER BY eixo.d;
END;
$$;

-- ---------- 2. Funil de conversão ----------
-- Funil de verdade: cada etapa conta quem CHEGOU nela ou passou dela. Contar só
-- quem está parado na etapa daria um gráfico sem forma de funil.
CREATE OR REPLACE FUNCTION public.sdr_funnel(
  _org_id uuid,
  _from   timestamptz DEFAULT NULL,
  _to     timestamptz DEFAULT NULL
)
RETURNS TABLE (etapa text, ordem int, total int)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_belongs_to_org(auth.uid(), _org_id) THEN
    RAISE EXCEPTION 'Sem permissão nesta organização';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT c.lifecycle_stage AS s
    FROM public.contacts c
    WHERE c.org_id = _org_id
      AND (_from IS NULL OR c.created_at >= _from)
      AND (_to   IS NULL OR c.created_at <  _to)
      -- Descartado não é etapa do funil: é saída.
      AND c.lifecycle_stage <> 'disqualified'
  )
  SELECT 'Recebidos'::text, 1, count(*)::int FROM base
  UNION ALL
  SELECT 'Contatados', 2, count(*)::int FROM base
    WHERE s IN ('contacted', 'qualified', 'opportunity', 'customer')
  UNION ALL
  SELECT 'Qualificados', 3, count(*)::int FROM base
    WHERE s IN ('qualified', 'opportunity', 'customer')
  UNION ALL
  SELECT 'Em negociação', 4, count(*)::int FROM base
    WHERE s IN ('opportunity', 'customer')
  UNION ALL
  SELECT 'Clientes', 5, count(*)::int FROM base
    WHERE s = 'customer'
  ORDER BY 2;
END;
$$;

-- ---------- 3. Leads por canal ----------
-- RESSALVA: o vocabulário de origem ainda não foi unificado (Plano 6). Hoje
-- existem quatro classificações divergentes no código e quase tudo cai em
-- "Não informado". O gráfico só fica correto depois daquele plano.
CREATE OR REPLACE FUNCTION public.sdr_by_channel(
  _org_id uuid,
  _from   timestamptz DEFAULT NULL,
  _to     timestamptz DEFAULT NULL
)
RETURNS TABLE (canal text, total int)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_belongs_to_org(auth.uid(), _org_id) THEN
    RAISE EXCEPTION 'Sem permissão nesta organização';
  END IF;

  RETURN QUERY
  SELECT bucket, count(*)::int
  FROM (
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM public.whatsapp_messages w
                    WHERE w.contact_id = c.id AND w.direction = 'inbound') THEN 'WhatsApp'
      WHEN lower(coalesce(c.metadata ->> 'source', '')) = 'cadastro_likawave' THEN 'Cadastro Likawave'
      WHEN lower(coalesce(c.metadata ->> 'source', '')) ~ 'instagram|ig_'      THEN 'Instagram'
      WHEN lower(coalesce(c.metadata ->> 'source', '')) ~ 'google|gads|adwords' THEN 'Google'
      WHEN lower(coalesce(c.metadata ->> 'source', '')) ~ 'linkedin'          THEN 'LinkedIn'
      WHEN lower(coalesce(c.metadata ->> 'source', '')) ~ 'landing|site|form|web|utm' THEN 'Landing page'
      WHEN lower(coalesce(c.metadata ->> 'source', '')) ~ 'csv|import'        THEN 'Importação'
      WHEN coalesce(c.metadata ->> 'source', '') IN ('', 'manual')            THEN 'Não informado'
      ELSE c.metadata ->> 'source'
    END AS bucket
    FROM public.contacts c
    WHERE c.org_id = _org_id
      AND (_from IS NULL OR c.created_at >= _from)
      AND (_to   IS NULL OR c.created_at <  _to)
  ) t
  GROUP BY bucket
  ORDER BY 2 DESC;
END;
$$;

-- ---------- 4. Desempenho por pessoa ----------
-- SOMENTE ADMIN: expõe o volume individual, o que contradiz a privacidade entre
-- pares se ficasse visível a todos.
CREATE OR REPLACE FUNCTION public.sdr_by_owner(
  _org_id uuid,
  _from   timestamptz DEFAULT NULL,
  _to     timestamptz DEFAULT NULL
)
RETURNS TABLE (pessoa text, leads int, abordagens int, reunioes int, vendas int)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_org_admin(auth.uid(), _org_id) THEN
    RAISE EXCEPTION 'Somente administradores podem ver desempenho individual';
  END IF;

  -- Uma passada agregada por tabela, em vez de 4 subconsultas correlacionadas
  -- por pessoa. Com N pessoas aquilo era 4N varreduras.
  RETURN QUERY
  WITH pessoas AS (
    SELECT p.id, coalesce(p.name, p.email, 'Sem nome')::text AS nome
    FROM public.profiles p WHERE p.org_id = _org_id
  ),
  leads AS (
    SELECT c.owner_id AS id, count(*) AS n
    FROM public.contacts c
    WHERE c.org_id = _org_id
      AND (_from IS NULL OR c.created_at >= _from)
      AND (_to   IS NULL OR c.created_at <  _to)
    GROUP BY 1
  ),
  atos AS (
    SELECT a.user_id AS id,
           count(*) FILTER (WHERE a.type IN ('call', 'email', 'meeting')) AS abordagens,
           count(*) FILTER (WHERE a.type = 'meeting')                     AS reunioes
    FROM public.activities a
    WHERE a.org_id = _org_id
      AND (_from IS NULL OR a.created_at >= _from)
      AND (_to   IS NULL OR a.created_at <  _to)
    GROUP BY 1
  ),
  ganhos AS (
    SELECT d.owner_id AS id, count(*) AS n
    FROM public.deals d
    WHERE d.org_id = _org_id AND d.status = 'won'
      AND (_from IS NULL OR d.close_date >= _from::date)
      AND (_to   IS NULL OR d.close_date <  _to::date)
    GROUP BY 1
  )
  SELECT pe.nome,
         coalesce(l.n, 0)::int,
         coalesce(a.abordagens, 0)::int,
         coalesce(a.reunioes, 0)::int,
         coalesce(g.n, 0)::int
  FROM pessoas pe
  LEFT JOIN leads  l ON l.id = pe.id
  LEFT JOIN atos   a ON a.id = pe.id
  LEFT JOIN ganhos g ON g.id = pe.id
  ORDER BY 2 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.sdr_series(uuid, timestamptz, timestamptz)     FROM public;
REVOKE ALL ON FUNCTION public.sdr_funnel(uuid, timestamptz, timestamptz)     FROM public;
REVOKE ALL ON FUNCTION public.sdr_by_channel(uuid, timestamptz, timestamptz) FROM public;
REVOKE ALL ON FUNCTION public.sdr_by_owner(uuid, timestamptz, timestamptz)   FROM public;

GRANT EXECUTE ON FUNCTION public.sdr_series(uuid, timestamptz, timestamptz)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.sdr_funnel(uuid, timestamptz, timestamptz)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.sdr_by_channel(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sdr_by_owner(uuid, timestamptz, timestamptz)   TO authenticated;
