-- ============================================================================
-- Alinhar as métricas que ficaram para trás, e contar pessoas além de toques
-- ============================================================================
--
-- Em 26/08 realinhei `sdr_metrics`, `sdr_series` e `sdr_metric_leads` para
-- contarem abordagem REALIZADA -- atividade com `completed_at`, e-mail que saiu,
-- WhatsApp aceito pela Meta -- e janeladas pela conclusão, não pela criação.
--
-- E não toquei em três coisas que medem a mesma ideia:
--
--   sdr_by_owner   o gráfico "Desempenho por pessoa"
--   sdr_funnel     o gráfico "Funil de conversão"
--   reunioes       o card "Reuniões geradas"
--
-- O resultado é pior que o problema original: antes tudo estava uniformemente
-- errado; depois ficou inconsistente. Hoje o card "Abordagens realizadas" e o
-- gráfico logo ABAIXO dele contam coisas diferentes -- o gráfico soma só
-- `activities`, por `created_at`, sem `completed_at`, sem e-mail e sem WhatsApp.
--
-- Um painel que se contradiz na mesma tela é pior que um painel errado, porque
-- quem vê não sabe em qual número acreditar.

-- ---------- 1. Desempenho por pessoa ----------

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
  -- Atividade CONCLUÍDA, janelada pela conclusão. Mesmo critério de
  -- sdr_metrics; era `created_at` sem filtro de conclusão.
  atos AS (
    SELECT a.user_id AS id,
           count(*) FILTER (WHERE a.type IN ('call', 'email', 'meeting')) AS abordagens,
           count(*) FILTER (WHERE a.type = 'meeting')                     AS reunioes
    FROM public.activities a
    WHERE a.org_id = _org_id
      AND a.completed_at IS NOT NULL
      AND (_from IS NULL OR a.completed_at >= _from)
      AND (_to   IS NULL OR a.completed_at <  _to)
    GROUP BY 1
  ),
  -- E-mail e WhatsApp entram no total por pessoa. Sem eles, o gráfico somava
  -- menos que o card e a diferença não tinha explicação na tela.
  correios AS (
    SELECT e.user_id AS id, count(*) AS n
    FROM public.emails e
    WHERE e.org_id = _org_id AND e.direction = 'outbound' AND e.status = 'sent'
      AND (_from IS NULL OR coalesce(e.sent_at, e.created_at) >= _from)
      AND (_to   IS NULL OR coalesce(e.sent_at, e.created_at) <  _to)
    GROUP BY 1
  ),
  zaps AS (
    SELECT w.user_id AS id, count(*) AS n
    FROM public.whatsapp_messages w
    WHERE w.org_id = _org_id AND w.direction = 'outbound'
      AND w.status IN ('sent', 'delivered', 'read')
      AND (_from IS NULL OR w.created_at >= _from)
      AND (_to   IS NULL OR w.created_at <  _to)
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
         (coalesce(a.abordagens, 0) + coalesce(co.n, 0) + coalesce(z.n, 0))::int,
         coalesce(a.reunioes, 0)::int,
         coalesce(g.n, 0)::int
  FROM pessoas pe
  LEFT JOIN leads    l  ON l.id  = pe.id
  LEFT JOIN atos     a  ON a.id  = pe.id
  LEFT JOIN correios co ON co.id = pe.id
  LEFT JOIN zaps     z  ON z.id  = pe.id
  LEFT JOIN ganhos   g  ON g.id  = pe.id
  ORDER BY 2 DESC;
END;
$$;

-- ---------- 2. Funil de conversão ----------
--
-- O critério de "Contatados" mudou embaixo desta função sem ela ser reescrita:
-- 20260826160000 criou gatilhos que promovem lead → contacted em qualquer
-- abordagem realizada. Antes dessa migração a etapa era permanentemente zero.
--
-- Uma ressalva que fica REGISTRADA e não corrigida aqui: o recorte é por
-- `created_at` do contato, mas a etapa é o estado ATUAL. Contato criado em
-- janeiro que virou cliente em agosto aparece em "Clientes" de janeiro -- ou
-- seja, mês fechado muda depois. Corrigir isso exige histórico de transição
-- (`lifecycle_changed_at` só guarda a última), e é mudança de modelo, não de
-- consulta. Está no plano como item próprio.
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
  -- "Qualificados" e "Em negociação" davam SEMPRE o mesmo número, porque
  -- qualify_lead grava 'opportunity' e pula 'qualified' -- a etapa 3 nunca teve
  -- população própria. Duas barras idênticas num funil não informam nada e
  -- fazem quem lê procurar a diferença.
  SELECT 'Em negociação', 3, count(*)::int FROM base
    WHERE s IN ('qualified', 'opportunity', 'customer')
  UNION ALL
  SELECT 'Clientes', 4, count(*)::int FROM base
    WHERE s = 'customer'
  ORDER BY 2;
END;
$$;

-- ---------- 3. sdr_metrics: reunião realizada, e pessoas além de toques ----------
--
-- DROP + CREATE porque `CREATE OR REPLACE` não troca o tipo de retorno, e a
-- função ganha a coluna `pessoas_abordadas`.

DROP FUNCTION IF EXISTS public.sdr_metrics(uuid, timestamptz, timestamptz);

CREATE FUNCTION public.sdr_metrics(
  _org_id uuid,
  _from   timestamptz DEFAULT NULL,
  _to     timestamptz DEFAULT NULL
)
RETURNS TABLE (
  leads_recebidos     int,
  abordagens          int,
  pessoas_abordadas   int,
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
    -- `total` é o denominador da taxa de entrega e continua contando toda
    -- tentativa. `enviado` é o que vale como abordagem: whatsapp-send grava
    -- 'failed' quando a Meta recusa, e mensagem recusada não é abordagem.
    -- São dois números diferentes de propósito -- juntá-los faria a taxa de
    -- entrega esconder as recusas em vez de mostrá-las.
    SELECT count(*) AS total,
           count(*) FILTER (WHERE status IN ('sent', 'delivered', 'read')) AS enviado,
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
          -- REALIZADA, não registrada: sem esta linha uma reunião agendada para
          -- semana que vem contava como abordagem feita hoje.
          AND a.completed_at IS NOT NULL
          -- E pela data da CONCLUSÃO. Por created_at, ligação criada em julho e
          -- feita em agosto apareceria no mês errado.
          AND (_from IS NULL OR a.completed_at >= _from)
          AND (_to   IS NULL OR a.completed_at <  _to))
      -- Mesmo princípio no e-mail. gmail-send grava a linha com status
      -- 'sending' ANTES de falar com o Google, para ter id de rastreio. Se a
      -- função morrer no meio -- timeout, cold start, rede -- a linha fica em
      -- 'sending' para sempre e contava como abordagem. Nunca saiu e-mail.
      -- 'draft', 'failed' e 'bounced' entravam pelo mesmo buraco.
      + (SELECT count(*) FROM public.emails e
          WHERE e.org_id = _org_id AND e.direction = 'outbound'
            AND e.status = 'sent'
            -- Pela hora do ENVIO. coalesce porque importação futura pode trazer
            -- sent_at do Gmail sem passar pelo gmail-send.
            AND (_from IS NULL OR coalesce(e.sent_at, e.created_at) >= _from)
            AND (_to   IS NULL OR coalesce(e.sent_at, e.created_at) <  _to))
      + (SELECT enviado FROM envio)
    )::int,

    -- PESSOAS abordadas, somando os três canais.
    --
    -- `abordagens` conta eventos: 1 ligação + 1 e-mail para a mesma pessoa dão 2.
    -- Isso mede volume de trabalho, e está certo -- mas lido sozinho parece
    -- contagem de gente, e foi exatamente o que confundiu.
    --
    -- Até aqui NÃO existia nenhuma métrica de pessoas somando os três canais: o
    -- único denominador em pessoas era WhatsApp puro (`conversas_iniciadas`),
    -- então uma operação de e-mail não tinha como saber quantas portas bateu.
    --
    -- `contact_id IS NOT NULL` é obrigatório e muda o número: e-mail para
    -- destinatário que não casa com contato nenhum conta como toque e não conta
    -- como pessoa. É a leitura honesta -- não dá para afirmar que uma pessoa foi
    -- abordada sem saber quem ela é.
    (SELECT count(DISTINCT alvo)::int FROM (
       SELECT a.contact_id AS alvo
       FROM public.activities a
       WHERE a.org_id = _org_id AND a.type IN ('call', 'email', 'meeting')
         AND a.contact_id IS NOT NULL
         AND a.completed_at IS NOT NULL
         AND (_from IS NULL OR a.completed_at >= _from)
         AND (_to   IS NULL OR a.completed_at <  _to)
       UNION ALL
       SELECT e.contact_id
       FROM public.emails e
       WHERE e.org_id = _org_id AND e.direction = 'outbound' AND e.status = 'sent'
         AND e.contact_id IS NOT NULL
         AND (_from IS NULL OR coalesce(e.sent_at, e.created_at) >= _from)
         AND (_to   IS NULL OR coalesce(e.sent_at, e.created_at) <  _to)
       UNION ALL
       SELECT w.contact_id
       FROM public.whatsapp_messages w
       WHERE w.org_id = _org_id AND w.direction = 'outbound'
         AND w.status IN ('sent', 'delivered', 'read')
         AND w.contact_id IS NOT NULL
         AND (_from IS NULL OR w.created_at >= _from)
         AND (_to   IS NULL OR w.created_at <  _to)
     ) toques),

    (SELECT CASE WHEN total > 0 THEN round(entregue * 100.0 / total)::int END FROM envio),
    (SELECT CASE WHEN abordados > 0 THEN round(responderam * 100.0 / abordados)::int END FROM resposta),
    (SELECT count(*)::int FROM wa_contato),

    -- Reunião REALIZADA, pela data da conclusão.
    --
    -- Ficou de fora quando realinhei as outras métricas, e o efeito era visível
    -- na tela: reunião agendada para setembro contava em "Reuniões geradas" de
    -- agosto e NÃO contava em "Abordagens realizadas" -- dois cards vizinhos com
    -- critérios diferentes para o mesmo evento.
    (SELECT count(*)::int FROM public.activities a
      WHERE a.org_id = _org_id AND a.type = 'meeting'
        AND a.completed_at IS NOT NULL
        AND (_from IS NULL OR a.completed_at >= _from)
        AND (_to   IS NULL OR a.completed_at <  _to)),

    -- Oportunidade = negócio que SAIU da etapa de entrada.
    --
    -- Todo contato passou a entrar no funil (20260826170000), então
    -- `count(*) FROM deals` viraria contagem de cadastro: importar 500 pessoas
    -- anunciaria 500 oportunidades geradas, sem ninguém ter avaliado nenhuma.
    -- Estar no funil é o padrão; ter avançado é que é o feito.
    --
    -- A etapa de entrada é a de menor `order`, nunca o nome -- rótulo é
    -- editável numa tela de configuração, e número de painel não pode depender
    -- disso. Negócio sem etapa conta: foi criado à mão, fora do fluxo.
    (SELECT count(*)::int FROM public.deals d
      WHERE d.org_id = _org_id
        AND (d.stage_id IS NULL
             OR d.stage_id <> public.etapa_de_entrada(
                  (SELECT s.pipeline_id FROM public.pipeline_stages s WHERE s.id = d.stage_id)))
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
