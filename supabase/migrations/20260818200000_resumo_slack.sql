-- ============================================================================
-- Resumo diário no Slack — agregações e agendamento
-- ============================================================================

-- ---------- 1. Deixar o cron chamar as funções do painel ----------
-- As funções sdr_* barram quem não pertence à organização usando auth.uid().
-- Quando o cron chama pela service_role, auth.uid() é NULL, is_org_admin()
-- devolve falso e a função levanta exceção — o resumo nunca sairia.
--
-- A guarda passa a ser "se HÁ usuário, ele precisa ter direito". Só a
-- service_role chega aqui com auth.uid() nulo, porque `anon` não tem EXECUTE:
-- REVOKE ALL FROM public + GRANT TO authenticated. As concessões são
-- reafirmadas no fim deste arquivo para essa premissa não se perder.
--
-- Mesmo padrão já usado em reserve_email_send (20260818120000_seguranca_rls).
-- Os corpos abaixo são os originais, com APENAS a linha da guarda alterada.

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
  IF auth.uid() IS NOT NULL AND NOT public.user_belongs_to_org(auth.uid(), _org_id) THEN
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
  IF auth.uid() IS NOT NULL AND NOT public.user_belongs_to_org(auth.uid(), _org_id) THEN
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
  IF auth.uid() IS NOT NULL AND NOT public.user_belongs_to_org(auth.uid(), _org_id) THEN
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
  IF auth.uid() IS NOT NULL AND NOT public.user_belongs_to_org(auth.uid(), _org_id) THEN
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
  IF auth.uid() IS NOT NULL AND NOT public.is_org_admin(auth.uid(), _org_id) THEN
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

-- ---------- 2. Negócio parado no funil ----------
-- Único bloco do resumo que ainda não existia. "Parado" = negócio aberto sem
-- nenhuma atividade registrada há mais de N dias. Sem atividade nenhuma, conta
-- a partir da criação.
CREATE OR REPLACE FUNCTION public.deals_parados(
  _org_id uuid,
  _dias   int DEFAULT 7,
  _limite int DEFAULT 5
)
RETURNS TABLE (
  titulo      text,
  contato     text,
  responsavel text,
  valor       numeric,
  dias_parado int
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.user_belongs_to_org(auth.uid(), _org_id) THEN
    RAISE EXCEPTION 'Sem permissão nesta organização';
  END IF;

  RETURN QUERY
  WITH ultimo_toque AS (
    SELECT d.id,
           d.title,
           d.value,
           d.contact_id,
           d.owner_id,
           greatest(
             d.created_at,
             coalesce((SELECT max(a.created_at) FROM public.activities a WHERE a.deal_id = d.id), d.created_at)
           ) AS visto_em
    FROM public.deals d
    WHERE d.org_id = _org_id
      -- Ganho e perdido não estão parados: acabaram.
      AND coalesce(d.status, 'open') NOT IN ('won', 'lost')
  )
  SELECT u.title::text,
         coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email, 'Sem contato')::text,
         coalesce(p.name, p.email, 'Sem responsável')::text,
         coalesce(u.value, 0),
         extract(day FROM (now() - u.visto_em))::int
  FROM ultimo_toque u
  LEFT JOIN public.contacts c ON c.id = u.contact_id
  LEFT JOIN public.profiles p ON p.id = u.owner_id
  WHERE u.visto_em < now() - make_interval(days => _dias)
  ORDER BY u.visto_em ASC
  LIMIT _limite;
END;
$$;

-- ---------- 3. Agendamento: todo dia às 20h de Brasília ----------
-- ATENÇÃO AO FUSO: o pg_cron roda em UTC. O Brasil é UTC-3 e não tem mais
-- horário de verão desde 2019, então 20h daqui é 23h UTC. Escrever
-- '0 20 * * *' enviaria o resumo às 17h. É o erro que se comete ao mexer
-- nisto depois.
DO $$
DECLARE
  v_url text := 'https://kschuwekbrrwmhzinsrv.supabase.co/functions/v1';
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'slack-daily-summary';

  -- Mesmo padrão de 20260702140000_automation_engine.sql: depende do segredo
  -- 'service_role_key' existir no Vault, senão o job roda em vazio em vez de
  -- falhar toda noite.
  PERFORM cron.schedule(
    'slack-daily-summary',
    '0 23 * * *',
    format($job$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{"scheduled": true, "all_orgs": true}'::jsonb
      )
      WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key');
    $job$, v_url || '/slack-daily-summary')
  );
END $$;

-- ---------- 4. Reafirmar as concessões ----------
-- A guarda relaxada só é segura porque `anon` não alcança estas funções.
-- Deixar explícito aqui para a premissa não se perder numa migração futura.
REVOKE ALL ON FUNCTION public.sdr_metrics(uuid, timestamptz, timestamptz)    FROM public;
REVOKE ALL ON FUNCTION public.sdr_series(uuid, timestamptz, timestamptz)     FROM public;
REVOKE ALL ON FUNCTION public.sdr_funnel(uuid, timestamptz, timestamptz)     FROM public;
REVOKE ALL ON FUNCTION public.sdr_by_channel(uuid, timestamptz, timestamptz) FROM public;
REVOKE ALL ON FUNCTION public.sdr_by_owner(uuid, timestamptz, timestamptz)   FROM public;
REVOKE ALL ON FUNCTION public.deals_parados(uuid, int, int)                  FROM public;

GRANT EXECUTE ON FUNCTION public.sdr_metrics(uuid, timestamptz, timestamptz)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.sdr_series(uuid, timestamptz, timestamptz)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.sdr_funnel(uuid, timestamptz, timestamptz)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.sdr_by_channel(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sdr_by_owner(uuid, timestamptz, timestamptz)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.deals_parados(uuid, int, int)                  TO authenticated;

-- ---------- 5. purpose vira obsoleto ----------
-- O modelo de duas caixas da empresa (sales/marketing) foi substituído por uma
-- conta por pessoa (scope_type = 'user'). A coluna NÃO é derrubada: os e-mails
-- já sincronizados a usam, e perdê-la apagaria a origem do histórico.
COMMENT ON COLUMN public.email_connections.purpose IS
  'OBSOLETO desde 2026-08-18. Use scope_type (user|org). Mantida só para o histórico já sincronizado; código novo não deve escrever aqui.';
