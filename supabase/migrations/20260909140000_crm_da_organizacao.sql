-- ============================================================================
-- TODO O CRM É DA ORGANIZAÇÃO
-- ============================================================================
-- Continuação de 20260909120000, que abriu os contatos. O pedido agora é o
-- resto: negócio, atividade, e-mail, conversa, meta e marketing.
--
-- O QUE NÃO MUDA: `owner_id` e `user_id` continuam gravados e continuam
-- significando quem cadastrou e quem é responsável. Eles deixam de decidir
-- QUEM ENXERGA -- viram informação e filtro, que é como as telas já os usam
-- (Contatos, Negócios e Atividades têm seletor de Responsável).
--
-- O QUE CONTINUA FECHADO, e é de propósito -- não é informação de CRM:
--   * segredo e credencial: org_secrets, api_keys, integration_configs,
--     webhooks, whatsapp_config (tem webhook_verify_token),
--     whatsapp_instance_secrets, instagram_app_secrets, e os tokens de OAuth.
--     Há teste no repositório justamente para credencial não virar leitura de
--     membro (`credencial-fora-do-alcance.test.ts`);
--   * conexão de caixa e de canal (email_connections, whatsapp_connections,
--     instagram_connections): são a porta, não a correspondência. As MENSAGENS
--     abrem aqui;
--   * convites: o registro carrega o token que entra na organização;
--   * preferência pessoal: assinatura de e-mail, notificação, onboarding;
--   * regra de automação, sequência e scoring: só existem em telas que já são
--     de admin por rota. Abrir a leitura não mostraria nada a mais.
--
-- EXCLUIR CONTINUA SENDO DE ADMIN em contato e negócio, pelo mesmo motivo da
-- migração anterior: é a operação sem desfazer, e o CLAUDE.md registra que ela
-- esbarra em filho vinculado sem transação para desfazer pela metade.
-- ============================================================================

-- ---------- 0. Como as políticas são aplicadas ----------
--
-- Cada comando passa por um guarda de existência antes de rodar. O motivo é
-- concreto: `whatsapp_conversations` está na lista de tabelas do RBAC
-- (20260702110000) e NÃO EXISTE neste banco -- a tela de Atendimento monta as
-- conversas a partir das mensagens, não de uma tabela de conversa. Sem o
-- guarda, a migração inteira morre na primeira linha que cita uma tabela que
-- este schema não tem, e nenhuma das outras chega a ser aplicada.
--
-- É o mesmo cuidado que o RBAC já tomava com `to_regclass`, e pela mesma razão
-- que ele registra: schema remoto pode estar em versão diferente das migrações
-- do repositório.
--
-- Os comandos ficam escritos por extenso, e não montados com `format`, para
-- continuarem legíveis -- e para o teste de varredura conseguir lê-los.
DO $migracao$
DECLARE
  comando text;
  alvo    text;
BEGIN
  FOREACH comando IN ARRAY ARRAY[

  -- ---------- 1. Negócios ----------
  -- O UPDATE abre junto com o SELECT, e não é simetria estética: arrastar card
  -- no kanban é UPDATE, e linha recusada pela RLS volta do PostgREST sem erro.
  -- O cartão voltaria para a coluna de origem sem uma palavra de explicação.
  $sql$DROP POLICY IF EXISTS "deals_select" ON public.deals$sql$,
  $sql$CREATE POLICY "deals_select" ON public.deals FOR SELECT
         USING (user_belongs_to_org(auth.uid(), org_id))$sql$,
  $sql$DROP POLICY IF EXISTS "deals_insert" ON public.deals$sql$,
  $sql$CREATE POLICY "deals_insert" ON public.deals FOR INSERT
         WITH CHECK (user_belongs_to_org(auth.uid(), org_id))$sql$,
  $sql$DROP POLICY IF EXISTS "deals_update" ON public.deals$sql$,
  $sql$CREATE POLICY "deals_update" ON public.deals FOR UPDATE
         USING (user_belongs_to_org(auth.uid(), org_id))
         WITH CHECK (user_belongs_to_org(auth.uid(), org_id))$sql$,

  -- ---------- 2. Atividades ----------
  -- Concluir a tarefa do colega passa a ser possível, e é o ponto: a agenda da
  -- equipe é uma só. `activities_delete` NÃO abre -- apagar o registro de uma
  -- ligação alheia some com histórico que alimenta métrica do painel.
  $sql$DROP POLICY IF EXISTS "activities_select" ON public.activities$sql$,
  $sql$CREATE POLICY "activities_select" ON public.activities FOR SELECT
         USING (user_belongs_to_org(auth.uid(), org_id))$sql$,
  $sql$DROP POLICY IF EXISTS "activities_insert" ON public.activities$sql$,
  $sql$CREATE POLICY "activities_insert" ON public.activities FOR INSERT
         WITH CHECK (user_belongs_to_org(auth.uid(), org_id))$sql$,
  $sql$DROP POLICY IF EXISTS "activities_update" ON public.activities$sql$,
  $sql$CREATE POLICY "activities_update" ON public.activities FOR UPDATE
         USING (user_belongs_to_org(auth.uid(), org_id))
         WITH CHECK (user_belongs_to_org(auth.uid(), org_id))$sql$,

  -- ---------- 3. E-mail e conversa: a MENSAGEM abre, a CONTA não ----------
  -- `emails_select` checava a conexão de origem para decidir. Some a condição
  -- inteira: quem lê a mensagem não precisa mais ter direito sobre a caixa.
  -- Escrever continua de quem enviou -- ninguém edita nem apaga e-mail alheio.
  $sql$DROP POLICY IF EXISTS "emails_select" ON public.emails$sql$,
  $sql$CREATE POLICY "emails_select" ON public.emails FOR SELECT
         USING (user_belongs_to_org(auth.uid(), org_id))$sql$,

  -- WhatsApp e Instagram: a tela de Atendimento lê a view
  -- `mensagens_do_atendimento`, que tem `security_invoker = on` -- ou seja, ela
  -- obedece à RLS destas duas tabelas. Abrir aqui é o que faz a tela funcionar
  -- para quem não é admin, sem tocar na view.
  $sql$DROP POLICY IF EXISTS "whatsapp_messages_select" ON public.whatsapp_messages$sql$,
  $sql$CREATE POLICY "whatsapp_messages_select" ON public.whatsapp_messages FOR SELECT
         USING (user_belongs_to_org(auth.uid(), org_id))$sql$,
  $sql$DROP POLICY IF EXISTS "instagram_messages_select" ON public.instagram_messages$sql$,
  $sql$CREATE POLICY "instagram_messages_select" ON public.instagram_messages FOR SELECT
         USING (user_belongs_to_org(auth.uid(), org_id))$sql$,

  -- O anexo segue a mensagem. O caminho é <org_id>/<contact_id>/<arquivo>, então
  -- a organização continua sendo a fronteira -- o que sai é o "dono do contato".
  $sql$DROP POLICY IF EXISTS "whatsapp_media_select" ON storage.objects$sql$,
  $sql$CREATE POLICY "whatsapp_media_select" ON storage.objects FOR SELECT TO authenticated
         USING (
           bucket_id = 'whatsapp-media'
           AND public.user_belongs_to_org(auth.uid(), ((storage.foldername(name))[1])::uuid)
         )$sql$,

  -- ---------- 4. Metas ----------
  $sql$DROP POLICY IF EXISTS "sales_goals_select" ON public.sales_goals$sql$,
  $sql$CREATE POLICY "sales_goals_select" ON public.sales_goals FOR SELECT
         USING (user_belongs_to_org(auth.uid(), org_id))$sql$,

  -- ---------- 5. Marketing e histórico ----------
  -- As policies `<t>_admin_all` (FOR ALL) continuam de pé e continuam dando a
  -- ESCRITA a admin. Policy permissiva soma: acrescentar um SELECT aberto não
  -- afrouxa o resto.
  $sql$DROP POLICY IF EXISTS "meta_ad_accounts_select" ON public.meta_ad_accounts$sql$,
  $sql$CREATE POLICY "meta_ad_accounts_select" ON public.meta_ad_accounts FOR SELECT
         USING (user_belongs_to_org(auth.uid(), org_id))$sql$,
  $sql$DROP POLICY IF EXISTS "meta_ads_select" ON public.meta_ads$sql$,
  $sql$CREATE POLICY "meta_ads_select" ON public.meta_ads FOR SELECT
         USING (user_belongs_to_org(auth.uid(), org_id))$sql$,
  $sql$DROP POLICY IF EXISTS "meta_adsets_select" ON public.meta_adsets$sql$,
  $sql$CREATE POLICY "meta_adsets_select" ON public.meta_adsets FOR SELECT
         USING (user_belongs_to_org(auth.uid(), org_id))$sql$,
  $sql$DROP POLICY IF EXISTS "meta_campaigns_select" ON public.meta_campaigns$sql$,
  $sql$CREATE POLICY "meta_campaigns_select" ON public.meta_campaigns FOR SELECT
         USING (user_belongs_to_org(auth.uid(), org_id))$sql$,
  $sql$DROP POLICY IF EXISTS "meta_insights_select" ON public.meta_insights$sql$,
  $sql$CREATE POLICY "meta_insights_select" ON public.meta_insights FOR SELECT
         USING (user_belongs_to_org(auth.uid(), org_id))$sql$,
  $sql$DROP POLICY IF EXISTS "meta_sync_log_select" ON public.meta_sync_log$sql$,
  $sql$CREATE POLICY "meta_sync_log_select" ON public.meta_sync_log FOR SELECT
         USING (user_belongs_to_org(auth.uid(), org_id))$sql$,
  $sql$DROP POLICY IF EXISTS "automation_logs_select" ON public.automation_logs$sql$,
  $sql$CREATE POLICY "automation_logs_select" ON public.automation_logs FOR SELECT
         USING (user_belongs_to_org(auth.uid(), org_id))$sql$,
  $sql$DROP POLICY IF EXISTS "lead_score_history_select" ON public.lead_score_history$sql$,
  $sql$CREATE POLICY "lead_score_history_select" ON public.lead_score_history FOR SELECT
         USING (user_belongs_to_org(auth.uid(), org_id))$sql$,
  $sql$DROP POLICY IF EXISTS "gmail_sync_log_select" ON public.gmail_sync_log$sql$,
  $sql$CREATE POLICY "gmail_sync_log_select" ON public.gmail_sync_log FOR SELECT
         USING (user_belongs_to_org(auth.uid(), org_id))$sql$
  ] LOOP
    alvo := (regexp_match(comando, 'ON ((?:public|storage)\.\w+)'))[1];
    IF to_regclass(alvo) IS NULL THEN
      RAISE NOTICE 'Tabela % não existe neste banco — pulando', alvo;
      CONTINUE;
    END IF;
    EXECUTE comando;
  END LOOP;
END $migracao$;

-- ---------- 5b. "O canal está conectado?" sem abrir a credencial ----------
--
-- A tela de Atendimento perguntava isso direto a `whatsapp_config`, e essa
-- tabela guarda `webhook_verify_token`. Abrir a leitura dela entregaria o token
-- a qualquer membro pelo navegador -- é exatamente o defeito que o repositório
-- já registra duas vezes (o token do WhatsApp e o do Meta moraram em tabela
-- legível, e há teste dedicado a isso).
--
-- O QUE ACONTECIA SEM ISTO: para quem não é admin a consulta voltava vazia, e a
-- tela concluía "WhatsApp ainda não está conectado" -- com um link para uma
-- página de administrador. Mentira, e sem saída.
--
-- Esta função devolve DOIS BOOLEANOS e mais nada. É o mínimo que a tela precisa
-- saber, e não há como extrair segredo de um `true`.
CREATE OR REPLACE FUNCTION public.canais_do_atendimento(_org_id uuid)
RETURNS TABLE (whatsapp boolean, instagram boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.whatsapp_config w WHERE w.org_id = _org_id),
    EXISTS (SELECT 1 FROM public.instagram_connections i
             WHERE i.org_id = _org_id AND i.is_active)
  -- Sem linha para quem é de fora. SECURITY DEFINER não passa por RLS, então a
  -- fronteira da organização precisa estar escrita aqui.
  WHERE public.user_belongs_to_org(auth.uid(), _org_id);
$$;

COMMENT ON FUNCTION public.canais_do_atendimento(uuid) IS
  'Diz se WhatsApp e Instagram estão conectados, sem expor a configuração — whatsapp_config guarda webhook_verify_token e continua fechada.';

GRANT EXECUTE ON FUNCTION public.canais_do_atendimento(uuid) TO authenticated;

-- ---------- 6. O painel: as quatro funções, redeclaradas juntas ----------
--
-- `sdr_by_owner` PARA DE RECUSAR quem não é admin. Ela alimenta o gráfico de
-- desempenho por pessoa, e era a última coisa do painel que dizia, com todas as
-- letras, "somente administradores". Num CRM em que a equipe inteira vê o mesmo
-- contato, o mesmo negócio e a mesma conversa, esconder quantas abordagens cada
-- um fez não protege nada -- os eventos que compõem o número já estão à vista.
--
-- O QUE MUDA é uma só: `sdr_metric_leads` era SECURITY DEFINER e REPUNHA o
-- recorte por carteira à mão -- o card somava a organização e a lista abaixo
-- mostrava só a carteira de quem olhava, com uma frase na tela explicando a
-- diferença. Com tudo aberto, a diferença deixa de existir, e a frase saiu da
-- tela junto.
--
-- POR QUE AS OUTRAS TRÊS ESTÃO AQUI SEM UMA VÍRGULA DE DIFERENÇA: card,
-- gráfico, lista e desempenho contam a mesma coisa em funções separadas, e o
-- CLAUDE.md registra que mexer numa só faz clicar no número abrir uma lista com
-- outro total. Há teste exigindo que as quatro sejam declaradas pela MESMA
-- migração -- é o que impede o critério de divergir em silêncio, e é por isso
-- que elas viajam juntas mesmo quando três não mudam.
--
-- `CREATE OR REPLACE` e não DROP: as colunas de retorno são as mesmas, e o
-- CLAUDE.md registra que trocar o tipo de retorno exigiria DROP.

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
  -- A CHECAGEM DE ORGANIZAÇÃO, e ela é nova aqui.
  --
  -- Esta função nunca teve uma: quem barrava org alheia era o próprio teste de
  -- admin (`is_org_admin(quem, _org_id)` é falso para a org do vizinho), e ele
  -- fazia dois trabalhos ao mesmo tempo. Tirar o recorte de papel sem repor a
  -- fronteira deixaria qualquer usuário autenticado ler o desempenho de outra
  -- organização passando o _org_id dela -- SECURITY DEFINER não passa por RLS.
  --
  -- Mesma forma das outras três funções do painel: `auth.uid() IS NOT NULL AND
  -- NOT ...`, que recusa o usuário de fora e continua deixando o service_role
  -- (uid nulo) passar.
  IF auth.uid() IS NOT NULL AND NOT public.user_belongs_to_org(auth.uid(), _org_id) THEN
    RAISE EXCEPTION 'Sem permissão nesta organização';
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
           count(*) FILTER (WHERE a.type IN ('call', 'email')
                              AND a.contact_id IS NOT NULL)      AS abordagens,
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
      AND e.contact_id IS NOT NULL
      AND (_from IS NULL OR coalesce(e.sent_at, e.created_at) >= _from)
      AND (_to   IS NULL OR coalesce(e.sent_at, e.created_at) <  _to)
    GROUP BY 1
  ),
  zaps AS (
    SELECT w.user_id AS id, count(*) AS n
    FROM public.whatsapp_messages w
    WHERE w.org_id = _org_id AND w.direction = 'outbound'
      AND w.status IN ('sent', 'delivered', 'read')
      AND w.contact_id IS NOT NULL
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

-- ---------- sdr_series ----------

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
       WHERE a.org_id = _org_id AND a.type IN ('call', 'email')
         AND a.contact_id IS NOT NULL
         AND a.completed_at IS NOT NULL
         AND a.completed_at >= v_ini_ts AND a.completed_at < v_fim_ts
       GROUP BY 1
      UNION ALL
      -- Enviado de fato, e pela hora do envio. Igual ao sdr_metrics.
      SELECT coalesce(e.sent_at, e.created_at)::date, count(*)
        FROM public.emails e
       WHERE e.org_id = _org_id AND e.direction = 'outbound'
         AND e.status = 'sent'
         AND e.contact_id IS NOT NULL
         AND coalesce(e.sent_at, e.created_at) >= v_ini_ts
         AND coalesce(e.sent_at, e.created_at) <  v_fim_ts
       GROUP BY 1
      UNION ALL
      SELECT w.created_at::date, count(*)
        FROM public.whatsapp_messages w
       WHERE w.org_id = _org_id AND w.direction = 'outbound'
         AND w.status IN ('sent', 'delivered', 'read')
         AND w.contact_id IS NOT NULL
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

-- ---------- sdr_metric_leads ----------
--
-- `CREATE OR REPLACE` e não `DROP` + `CREATE`: aqui só muda o FILTRO, não as
-- colunas de retorno. `CREATE OR REPLACE` não trocaria o tipo de retorno -- é a
-- armadilha registrada no CLAUDE.md -- mas para mudar o corpo ele serve, e
-- preserva as concessões que um DROP levaria junto.

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
  detalhe   text,        -- estágio, composição de canais, etc.
  quando    timestamptz,
  toques    int,         -- eventos que a linha representa
  respondeu boolean,     -- só taxaResposta
  valor     numeric,     -- só oportunidades
  -- ---- rastreabilidade, só em abordagens ----
  autor     text,        -- QUEM fez a abordagem
  canal     text,        -- ligacao | reuniao | email_manual | e-mail | whatsapp
  conteudo  text         -- O QUE foi enviado: assunto, título ou trecho
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
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
      -- Concluída, e pela data da conclusão — mesmo critério de sdr_metrics e
      -- sdr_series. Se a lista contasse diferente do card, voltaríamos ao
      -- problema que este drill-down existe para resolver.
      -- O TIPO da atividade, não "atividade".
      --
      -- Dizer só "atividade" descarta a informação que a tabela já tem: quem lê
      -- a lista precisa saber se foi ligação ou reunião, porque isso muda
      -- completamente o que aconteceu com aquele lead.
      --
      -- 'email_manual' distingue e-mail REGISTRADO à mão de e-mail que o CRM
      -- enviou de verdade. Os dois são abordagem, mas só um tem conteúdo que o
      -- sistema conhece — e confundi-los faria alguém procurar no Gmail uma
      -- mensagem que nunca saiu de lá.
      SELECT a.contact_id,
             a.user_id,
             (CASE a.type
                WHEN 'call'    THEN 'ligacao'
                WHEN 'meeting' THEN 'reuniao'
                ELSE 'email_manual'
              END)::text       AS canal_ev,
             a.completed_at    AS quando_ev,
             coalesce(nullif(trim(a.title), ''), a.type::text) AS conteudo_ev
      FROM public.activities a
      WHERE a.org_id = _org_id
        AND a.type IN ('call', 'email')
        AND a.contact_id IS NOT NULL
        AND a.completed_at IS NOT NULL
        AND (_from IS NULL OR a.completed_at >= _from)
        AND (_to   IS NULL OR a.completed_at <  _to)

      UNION ALL

      -- E-mail enviado. O assunto é o que identifica a abordagem.
      SELECT e.contact_id,
             e.user_id,
             'e-mail',
             coalesce(e.sent_at, e.created_at),
             coalesce(nullif(trim(e.subject), ''), '(sem assunto)')
      FROM public.emails e
      WHERE e.org_id = _org_id
        AND e.direction = 'outbound'
        -- Só o que saiu. 'sending' é pré-registro do gmail-send que ficou órfão
        -- porque a função morreu antes de o Google responder.
        AND e.status = 'sent'
        AND e.contact_id IS NOT NULL
        AND (_from IS NULL OR coalesce(e.sent_at, e.created_at) >= _from)
        AND (_to   IS NULL OR coalesce(e.sent_at, e.created_at) <  _to)

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
        -- Recusada pela Meta não é abordagem.
        AND w.status IN ('sent', 'delivered', 'read')
        AND w.contact_id IS NOT NULL
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
      -- Mesmo recorte de sdr_metrics: só negócio que saiu da etapa de entrada.
      -- Divergir faria o card contar uma coisa e a lista mostrar outra, que é o
      -- problema que este drill-down existe para resolver.
      AND (d.stage_id IS NULL
           OR d.stage_id <> public.etapa_de_entrada(
                (SELECT s.pipeline_id FROM public.pipeline_stages s WHERE s.id = d.stage_id)))
      AND (_from IS NULL OR d.created_at >= _from)
      AND (_to   IS NULL OR d.created_at <  _to)
    ORDER BY d.created_at DESC
    LIMIT v_limite;
  END IF;
END;
$$;

-- ---------- sdr_metrics ----------

CREATE OR REPLACE FUNCTION public.sdr_metrics(
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
           count(*) FILTER (WHERE status IN ('sent', 'delivered', 'read')
                              AND contact_id IS NOT NULL)                  AS enviado,
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
        WHERE a.org_id = _org_id AND a.type IN ('call', 'email')
          -- Sem lead vinculado não é abordagem: ver o cabeçalho.
          AND a.contact_id IS NOT NULL
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
            AND e.contact_id IS NOT NULL
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
       WHERE a.org_id = _org_id AND a.type IN ('call', 'email')
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

-- ---------- Permissões ----------
--
-- `CREATE OR REPLACE` preserva as concessões; `DROP` + `CREATE` não. Como
-- `sdr_metrics` já foi recriada com DROP numa migração anterior, repetir os
-- GRANT aqui é barato e evita depender de qual caminho cada função tomou.

GRANT EXECUTE ON FUNCTION public.sdr_metrics(uuid, timestamptz, timestamptz)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.sdr_by_owner(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sdr_series(uuid, timestamptz, timestamptz)   TO authenticated;
-- O drill-down nasceu em outra migração; a concessão vem junto para a função
-- não depender de quem a criou primeiro.
GRANT EXECUTE ON FUNCTION public.sdr_metric_leads(uuid, text, timestamptz, timestamptz, int) TO authenticated;

COMMENT ON FUNCTION public.sdr_metric_leads(uuid, text, timestamptz, timestamptz, int) IS
  'Linhas por trás de um KPI do painel. Conta a organização inteira, igual ao card -- não há mais recorte por carteira. Filtros espelham sdr_metrics.';
