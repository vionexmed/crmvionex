-- ============================================================================
-- Drill-down dos KPIs do painel — de número para nome
-- ============================================================================
--
-- O painel mostra "1 abordagem" e o usuário não tem como saber de quem se
-- trata. O número é um beco sem saída.
--
-- POR QUE UMA FUNÇÃO NOVA, E NÃO UM CAMPO A MAIS EM sdr_metrics:
-- sdr_metrics é SECURITY DEFINER e devolve SÓ inteiros, de propósito. Ela
-- agrega a organização inteira, enquanto o RLS de contacts restringe cada
-- comercial à carteira dele (contacts_select, 20260702110000_rbac_comercial).
-- Devolver identidade por lá vazaria linha que o chamador não pode ver.
--
-- Aqui a identidade sai, então o recorte por dono é reposto à mão: admin vê a
-- org toda, comercial vê só quem é dele. A diferença entre o total do card e a
-- soma do que aparece é mostrada na interface como "+N de outros responsáveis",
-- em vez de calada — número que não fecha com a lista lê-se como bug.
--
-- Os filtros de cada métrica são cópia fiel de sdr_metrics
-- (20260818200000_resumo_slack). Se um lado mudar, o outro tem de mudar junto,
-- senão a lista discorda do número que ela deveria explicar.

CREATE OR REPLACE FUNCTION public.sdr_metric_leads(
  _org_id uuid,
  _metric text,
  _from   timestamptz DEFAULT NULL,
  _to     timestamptz DEFAULT NULL,
  _limite int DEFAULT 5
)
RETURNS TABLE (
  id        uuid,        -- contact_id ou deal_id, para a interface navegar
  tipo      text,        -- 'contact' | 'deal'
  titulo    text,        -- nome do lead / título do negócio
  subtitulo text,        -- empresa / contato do negócio
  detalhe   text,        -- "2 e-mails · 1 whats", estágio, etc.
  quando    timestamptz,
  toques    int,         -- eventos que a linha representa (1 nas métricas de linha)
  respondeu boolean,     -- só taxaResposta; NULL nas outras
  valor     numeric      -- só oportunidades; NULL nas outras
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_admin  boolean;
  v_limite int;
BEGIN
  -- Guarda mais rígida que a de sdr_metrics de propósito. Lá o `auth.uid() IS
  -- NOT NULL AND` foi afrouxado para o resumo do Slack rodar como service_role
  -- com auth.uid() nulo. Esta função só tem consumidor de interface: sem
  -- usuário não há carteira para recortar, então chamada anônima é erro, não
  -- caso de uso.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Requer usuário autenticado';
  END IF;

  IF NOT public.user_belongs_to_org(auth.uid(), _org_id) THEN
    RAISE EXCEPTION 'Sem permissão nesta organização';
  END IF;

  -- Whitelist: _metric entra na escolha do ramo, e nada além destes quatro
  -- valores tem ramo. Erro explícito em vez de devolver vazio silencioso.
  IF _metric NOT IN ('leadsRecebidos', 'abordagens', 'taxaResposta', 'oportunidades') THEN
    RAISE EXCEPTION 'Métrica sem drill-down: %', _metric;
  END IF;

  v_admin  := public.is_org_admin(auth.uid(), _org_id);
  -- Teto de 200: o painel lateral pagina, e sem limite um período longo
  -- devolveria a base inteira para dentro de um popover.
  v_limite := least(greatest(coalesce(_limite, 5), 1), 200);

  -- ---------- Leads recebidos ----------
  -- Por created_at, sem filtro de lifecycle_stage — igual a sdr_metrics, que
  -- não filtra por estágio justamente porque ele avança com o tempo.
  IF _metric = 'leadsRecebidos' THEN
    RETURN QUERY
    SELECT c.id,
           'contact'::text,
           coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email, 'Sem nome')::text,
           co.name::text,
           c.lifecycle_stage::text,
           c.created_at,
           1,
           NULL::boolean,
           NULL::numeric
    FROM public.contacts c
    LEFT JOIN public.companies co ON co.id = c.company_id
    WHERE c.org_id = _org_id
      AND (_from IS NULL OR c.created_at >= _from)
      AND (_to   IS NULL OR c.created_at <  _to)
      AND (v_admin OR c.owner_id = auth.uid())
    ORDER BY c.created_at DESC
    LIMIT v_limite;

  -- ---------- Abordagens realizadas ----------
  -- sdr_metrics soma TRÊS contagens de evento: atividade de contato, e-mail
  -- enviado e WhatsApp enviado. Portanto o card conta eventos, não leads: 8
  -- abordagens podem ser 3 leads. Aqui agrupamos por contato e devolvemos
  -- `toques` para a interface poder fechar a conta.
  --
  -- contact_id é anulável nas três tabelas, e toque sem contato não tem nome
  -- para mostrar — fica de fora das linhas e entra no resto que a interface
  -- exibe como "sem lead vinculado".
  ELSIF _metric = 'abordagens' THEN
    RETURN QUERY
    WITH toque AS (
      SELECT a.contact_id, 'ativ'::text AS canal, a.created_at
      FROM public.activities a
      WHERE a.org_id = _org_id
        AND a.type IN ('call', 'email', 'meeting')
        AND a.contact_id IS NOT NULL
        AND (_from IS NULL OR a.created_at >= _from)
        AND (_to   IS NULL OR a.created_at <  _to)
      UNION ALL
      SELECT e.contact_id, 'mail', e.created_at
      FROM public.emails e
      WHERE e.org_id = _org_id
        AND e.direction = 'outbound'
        AND e.contact_id IS NOT NULL
        AND (_from IS NULL OR e.created_at >= _from)
        AND (_to   IS NULL OR e.created_at <  _to)
      UNION ALL
      SELECT w.contact_id, 'whats', w.created_at
      FROM public.whatsapp_messages w
      WHERE w.org_id = _org_id
        AND w.direction = 'outbound'
        AND w.contact_id IS NOT NULL
        AND (_from IS NULL OR w.created_at >= _from)
        AND (_to   IS NULL OR w.created_at <  _to)
    ),
    por_contato AS (
      -- n_toques/visto_em, e não toques/quando: os nomes do RETURNS TABLE são
      -- variáveis dentro do corpo em PL/pgSQL, e alias homônimo é a origem
      -- clássica de "ambiguous column reference" em tempo de execução.
      SELECT t.contact_id,
             count(*)::int                                  AS n_toques,
             max(t.created_at)                              AS visto_em,
             count(*) FILTER (WHERE t.canal = 'ativ')::int   AS n_ativ,
             count(*) FILTER (WHERE t.canal = 'mail')::int   AS n_mail,
             count(*) FILTER (WHERE t.canal = 'whats')::int  AS n_whats
      FROM toque t
      GROUP BY t.contact_id
    )
    SELECT c.id,
           'contact'::text,
           coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email, 'Sem nome')::text,
           co.name::text,
           -- concat_ws já descarta NULL, então canal sem toque não vira "0 x".
           nullif(concat_ws(' · ',
             CASE WHEN g.n_ativ  > 0 THEN g.n_ativ  || ' ativ.' END,
             CASE WHEN g.n_mail  > 0 THEN g.n_mail  || ' e-mail' || CASE WHEN g.n_mail  > 1 THEN 's' ELSE '' END END,
             CASE WHEN g.n_whats > 0 THEN g.n_whats || ' whats' END
           ), '')::text,
           g.visto_em,
           g.n_toques,
           NULL::boolean,
           NULL::numeric
    FROM por_contato g
    JOIN public.contacts c ON c.id = g.contact_id
    LEFT JOIN public.companies co ON co.id = c.company_id
    WHERE (v_admin OR c.owner_id = auth.uid())
    ORDER BY g.visto_em DESC
    LIMIT v_limite;

  -- ---------- Taxa de resposta ----------
  -- Recorte igual ao de sdr_metrics: só WhatsApp, e "abordado" = contato com
  -- primeiro envio DENTRO da janela. Resposta que chega depois do fim do
  -- período não conta — é a mesma ressalva que o card já exibe.
  --
  -- Ordem começa por quem NÃO respondeu: numa taxa de resposta, a lista que
  -- gera ação é a de quem falta cobrar, não a de quem já respondeu.
  ELSIF _metric = 'taxaResposta' THEN
    RETURN QUERY
    WITH wa AS (
      SELECT w.contact_id, w.direction, w.created_at
      FROM public.whatsapp_messages w
      WHERE w.org_id = _org_id
        AND (_from IS NULL OR w.created_at >= _from)
        AND (_to   IS NULL OR w.created_at <  _to)
    ),
    wa_contato AS (
      SELECT contact_id,
             min(created_at) FILTER (WHERE direction = 'outbound') AS primeiro_envio
      FROM wa
      WHERE contact_id IS NOT NULL
      GROUP BY contact_id
    ),
    abordado AS (
      SELECT k.contact_id,
             k.primeiro_envio,
             (SELECT min(w.created_at) FROM wa w
               WHERE w.contact_id = k.contact_id
                 AND w.direction = 'inbound'
                 AND w.created_at > k.primeiro_envio) AS lead_respondeu
      FROM wa_contato k
      WHERE k.primeiro_envio IS NOT NULL
    )
    SELECT c.id,
           'contact'::text,
           coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email, 'Sem nome')::text,
           co.name::text,
           NULL::text,
           a.primeiro_envio,
           1,
           (a.lead_respondeu IS NOT NULL),
           NULL::numeric
    FROM abordado a
    JOIN public.contacts c ON c.id = a.contact_id
    LEFT JOIN public.companies co ON co.id = c.company_id
    WHERE (v_admin OR c.owner_id = auth.uid())
    ORDER BY (a.lead_respondeu IS NOT NULL) ASC, a.primeiro_envio DESC
    LIMIT v_limite;

  -- ---------- Oportunidades geradas ----------
  -- Negócio por created_at. Recorta por owner_id do negócio, não do contato:
  -- é o dono do negócio que responde por ele, e deals aceita negócio sem
  -- contato vinculado.
  ELSE
    RETURN QUERY
    SELECT d.id,
           'deal'::text,
           d.title::text,
           coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email, 'Sem contato')::text,
           NULL::text,
           d.created_at,
           1,
           NULL::boolean,
           d.value
    FROM public.deals d
    LEFT JOIN public.contacts c ON c.id = d.contact_id
    WHERE d.org_id = _org_id
      AND (_from IS NULL OR d.created_at >= _from)
      AND (_to   IS NULL OR d.created_at <  _to)
      AND (v_admin OR d.owner_id = auth.uid())
    ORDER BY d.created_at DESC
    LIMIT v_limite;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.sdr_metric_leads(uuid, text, timestamptz, timestamptz, int) IS
  'Linhas por trás de um KPI do painel. Admin vê a organização; os demais, só a própria carteira. Filtros espelham sdr_metrics.';

-- anon não alcança a função; só usuário autenticado, que é o que a guarda exige.
REVOKE ALL  ON FUNCTION public.sdr_metric_leads(uuid, text, timestamptz, timestamptz, int) FROM public;
GRANT EXECUTE ON FUNCTION public.sdr_metric_leads(uuid, text, timestamptz, timestamptz, int) TO authenticated;
