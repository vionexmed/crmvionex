-- ============================================================================
-- "Abordagens realizadas" contava o que nunca saiu
-- ============================================================================
--
-- O card promete REALIZADAS, e os três canais falhavam nisso de forma parecida:
-- cada tabela guarda a INTENÇÃO e a CONCLUSÃO em campos separados, e a métrica
-- só olhava a intenção.
--
--   activities         -- linha existe ao agendar;  completed_at diz se ocorreu
--   emails             -- linha existe antes do envio; status diz se saiu
--   whatsapp_messages  -- linha existe na tentativa;   status diz se a Meta aceitou
--
-- O caso do e-mail é o mais traiçoeiro: gmail-send grava a linha com status
-- 'sending' para ter id de rastreio ANTES de falar com o Google. Quando a função
-- morre no meio -- timeout, cold start, rede -- ela apaga a linha; se ela morre
-- antes de conseguir apagar, a linha fica em 'sending' e conta como abordagem
-- para sempre. Ninguém recebeu nada.
--
-- Isso também é o que faz teste poluir o painel: quase todo teste morre em
-- 'sending', 'draft' ou 'failed'. Filtrar por conclusão resolve na origem, e sem
-- apagar histórico -- a tentativa continua registrada, só não conta como feito.
--
-- Parte 1: atividades. A parte de atividades contava por `created_at` e
-- ignorava `completed_at`: uma reunião agendada para semana que vem aparecia
-- como abordagem feita hoje, e uma ligação que alguém só planejou entrava na
-- conta igual a uma que aconteceu.
--
-- Duas correções, e a segunda é tão importante quanto a primeira:
--
--   1. Só conta atividade com completed_at preenchido.
--   2. Pela data da CONCLUSÃO, não da criação. Por created_at, uma ligação
--      criada em julho e feita em agosto apareceria no mês errado — e o número
--      de um mês fechado mudaria depois de fechado.
--
-- E-mail e WhatsApp seguem por created_at, que ali é a data do envio de fato.
-- Reunião continua contando: é contato com o lead, mesmo não sendo mensagem.
--
-- CONSEQUÊNCIA ESPERADA: o número de abordagens CAI. Atividade planejada sai da
-- conta, e é isso que se quer — o número anterior estava inflado.
--
-- Os três lugares que contam abordagem mudam JUNTOS. Corrigir só um faria o
-- card, o gráfico e a lista discordarem entre si.

-- DEPENDÊNCIA: esta função usa public.etapa_de_entrada, criada em
-- 20260826170000_contato_entra_no_funil.sql. Num banco novo a ordem por nome de
-- arquivo resolve (o corpo plpgsql não é validado na criação, só na execução).
-- Reaplicando à mão, rode 170000 ANTES desta.
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

    (SELECT CASE WHEN total > 0 THEN round(entregue * 100.0 / total)::int END FROM envio),
    (SELECT CASE WHEN abordados > 0 THEN round(responderam * 100.0 / abordados)::int END FROM resposta),
    (SELECT count(*)::int FROM wa_contato),

    (SELECT count(*)::int FROM public.activities a
      WHERE a.org_id = _org_id AND a.type = 'meeting'
        AND (_from IS NULL OR a.created_at >= _from)
        AND (_to   IS NULL OR a.created_at <  _to)),

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
      -- Mesmo critério do sdr_metrics: concluída, e pela data da conclusão.
      -- Divergir aqui faria o gráfico contradizer o card logo acima dele.
      SELECT a.completed_at::date AS d, count(*) AS n
        FROM public.activities a
       WHERE a.org_id = _org_id AND a.type IN ('call', 'email', 'meeting')
         AND a.completed_at IS NOT NULL
         AND a.completed_at >= v_ini_ts AND a.completed_at < v_fim_ts
       GROUP BY 1
      UNION ALL
      -- Enviado de fato, e pela hora do envio. Igual ao sdr_metrics.
      SELECT coalesce(e.sent_at, e.created_at)::date, count(*)
        FROM public.emails e
       WHERE e.org_id = _org_id AND e.direction = 'outbound'
         AND e.status = 'sent'
         AND coalesce(e.sent_at, e.created_at) >= v_ini_ts
         AND coalesce(e.sent_at, e.created_at) <  v_fim_ts
       GROUP BY 1
      UNION ALL
      SELECT w.created_at::date, count(*)
        FROM public.whatsapp_messages w
       WHERE w.org_id = _org_id AND w.direction = 'outbound'
         AND w.status IN ('sent', 'delivered', 'read')
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
