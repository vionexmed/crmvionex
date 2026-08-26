-- ============================================================================
-- Abordagens rastreáveis: quem fez, por qual canal, e o que enviou
-- ============================================================================
--
-- O drill-down de "abordagens" agrupava por LEAD, mas o número conta EVENTOS.
-- Resultado visto na tela: o card dizia 4 e a lista mostrava uma pessoa só,
-- porque três daquelas abordagens eram e-mails sem contato vinculado — entravam
-- na contagem e não tinham nome para aparecer.
--
-- Agrupar por lead responde "quem foi abordado". Não responde "o que foi feito",
-- que é o que se precisa para auditar: quem mandou, por onde, e o quê.
--
-- Então a lista de abordagens passa a ser de EVENTOS, um por linha. Duas
-- consequências boas: o número do card e a quantidade de linhas passam a bater
-- exatamente, e mensagem sem lead vinculado aparece em vez de desaparecer.
--
-- As outras três métricas continuam listando registros (contato, negócio), e
-- para elas as colunas novas vêm nulas.

-- CREATE OR REPLACE não troca o tipo de retorno de uma função. Com colunas
-- novas no RETURNS TABLE, é DROP e recria.
DROP FUNCTION IF EXISTS public.sdr_metric_leads(uuid, text, timestamptz, timestamptz, int);

CREATE FUNCTION public.sdr_metric_leads(
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
  detalhe   text,        -- estágio, composição de canais, etc.
  quando    timestamptz,
  toques    int,         -- eventos que a linha representa
  respondeu boolean,     -- só taxaResposta
  valor     numeric,     -- só oportunidades
  -- ---- rastreabilidade, só em abordagens ----
  autor     text,        -- QUEM fez a abordagem
  canal     text,        -- POR ONDE: atividade | e-mail | whatsapp
  conteudo  text         -- O QUE foi enviado: assunto, título ou trecho
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Requer usuário autenticado';
  END IF;

  IF NOT public.user_belongs_to_org(auth.uid(), _org_id) THEN
    RAISE EXCEPTION 'Sem permissão nesta organização';
  END IF;

  IF _metric NOT IN ('leadsRecebidos', 'abordagens', 'taxaResposta', 'oportunidades') THEN
    RAISE EXCEPTION 'Métrica sem drill-down: %', _metric;
  END IF;

  v_admin  := public.is_org_admin(auth.uid(), _org_id);
  v_limite := least(greatest(coalesce(_limite, 5), 1), 200);

  -- ---------- Leads recebidos ----------
  IF _metric = 'leadsRecebidos' THEN
    RETURN QUERY
    SELECT c.id, 'contact'::text,
           coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email, 'Sem nome')::text,
           co.name::text, c.lifecycle_stage::text, c.created_at, 1,
           NULL::boolean, NULL::numeric, NULL::text, NULL::text, NULL::text
    FROM public.contacts c
    LEFT JOIN public.companies co ON co.id = c.company_id
    WHERE c.org_id = _org_id
      AND (_from IS NULL OR c.created_at >= _from)
      AND (_to   IS NULL OR c.created_at <  _to)
      AND (v_admin OR c.owner_id = auth.uid())
    ORDER BY c.created_at DESC
    LIMIT v_limite;

  -- ---------- Abordagens: UM EVENTO POR LINHA ----------
  -- Sem agrupar e sem exigir contact_id. É o que faz a contagem do card e a
  -- quantidade de linhas baterem, e o que traz à tona a abordagem que não está
  -- vinculada a lead nenhum — antes ela sumia da lista e virava só um número.
  --
  -- Os filtros de fonte, tipo e período são cópia fiel de sdr_metrics: se um
  -- lado mudar, o outro tem de mudar junto.
  ELSIF _metric = 'abordagens' THEN
    RETURN QUERY
    WITH evento AS (
      -- Atividade registrada por alguém do time.
      SELECT a.contact_id,
             a.user_id,
             'atividade'::text AS canal_ev,
             a.created_at      AS quando_ev,
             coalesce(nullif(trim(a.title), ''), a.type::text) AS conteudo_ev
      FROM public.activities a
      WHERE a.org_id = _org_id
        AND a.type IN ('call', 'email', 'meeting')
        AND (_from IS NULL OR a.created_at >= _from)
        AND (_to   IS NULL OR a.created_at <  _to)

      UNION ALL

      -- E-mail enviado. O assunto é o que identifica a abordagem.
      SELECT e.contact_id,
             e.user_id,
             'e-mail',
             e.created_at,
             coalesce(nullif(trim(e.subject), ''), '(sem assunto)')
      FROM public.emails e
      WHERE e.org_id = _org_id
        AND e.direction = 'outbound'
        AND (_from IS NULL OR e.created_at >= _from)
        AND (_to   IS NULL OR e.created_at <  _to)

      UNION ALL

      -- WhatsApp enviado. Trecho do corpo, porque mensagem não tem assunto.
      SELECT w.contact_id,
             w.user_id,
             'whatsapp',
             w.created_at,
             coalesce(nullif(trim(left(w.body, 120)), ''), '(sem texto)')
      FROM public.whatsapp_messages w
      WHERE w.org_id = _org_id
        AND w.direction = 'outbound'
        AND (_from IS NULL OR w.created_at >= _from)
        AND (_to   IS NULL OR w.created_at <  _to)
    )
    SELECT ev.contact_id,
           'contact'::text,
           -- Sem contato vinculado a linha ainda aparece, dizendo isso.
           coalesce(
             nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
             c.email,
             'Sem lead vinculado'
           )::text,
           co.name::text,
           NULL::text,
           ev.quando_ev,
           1,
           NULL::boolean,
           NULL::numeric,
           -- Quem fez. Sem user_id não há a quem atribuir, e dizer isso é
           -- melhor que deixar em branco: e-mail de automação cai aqui.
           coalesce(p.name, p.email, 'Não atribuído')::text,
           ev.canal_ev,
           ev.conteudo_ev
    FROM evento ev
    LEFT JOIN public.contacts c ON c.id = ev.contact_id
    LEFT JOIN public.companies co ON co.id = c.company_id
    LEFT JOIN public.profiles p ON p.id = ev.user_id
    -- Recorte por carteira: admin vê tudo. Os demais veem o que é do lead deles
    -- OU o que eles mesmos fizeram — sem a segunda metade, a pessoa não veria a
    -- própria abordagem a um lead que não é dela.
    WHERE (
      v_admin
      OR c.owner_id = auth.uid()
      OR ev.user_id = auth.uid()
    )
    ORDER BY ev.quando_ev DESC
    LIMIT v_limite;

  -- ---------- Taxa de resposta ----------
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
      FROM wa WHERE contact_id IS NOT NULL GROUP BY contact_id
    ),
    abordado AS (
      SELECT k.contact_id, k.primeiro_envio,
             (SELECT min(w.created_at) FROM wa w
               WHERE w.contact_id = k.contact_id
                 AND w.direction = 'inbound'
                 AND w.created_at > k.primeiro_envio) AS lead_respondeu
      FROM wa_contato k WHERE k.primeiro_envio IS NOT NULL
    )
    SELECT c.id, 'contact'::text,
           coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email, 'Sem nome')::text,
           co.name::text, NULL::text, a.primeiro_envio, 1,
           (a.lead_respondeu IS NOT NULL), NULL::numeric,
           NULL::text, NULL::text, NULL::text
    FROM abordado a
    JOIN public.contacts c ON c.id = a.contact_id
    LEFT JOIN public.companies co ON co.id = c.company_id
    WHERE (v_admin OR c.owner_id = auth.uid())
    ORDER BY (a.lead_respondeu IS NOT NULL) ASC, a.primeiro_envio DESC
    LIMIT v_limite;

  -- ---------- Oportunidades geradas ----------
  ELSE
    RETURN QUERY
    SELECT d.id, 'deal'::text, d.title::text,
           coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email, 'Sem contato')::text,
           NULL::text, d.created_at, 1,
           NULL::boolean, d.value, NULL::text, NULL::text, NULL::text
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
  'Linhas por trás de um KPI. Em abordagens devolve UM EVENTO por linha, com autor, canal e conteúdo. Admin vê a organização; os demais, a própria carteira e as próprias ações.';

REVOKE ALL     ON FUNCTION public.sdr_metric_leads(uuid, text, timestamptz, timestamptz, int) FROM public;
GRANT EXECUTE  ON FUNCTION public.sdr_metric_leads(uuid, text, timestamptz, timestamptz, int) TO authenticated;
