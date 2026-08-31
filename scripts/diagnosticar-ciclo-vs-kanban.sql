-- ============================================================================
-- Contato em "negociação" que não aparece no kanban
-- ============================================================================
--
-- O ciclo de vida (`contacts.lifecycle_stage`) e a coluna do kanban
-- (`deals.stage_id`) são DUAS coisas, e podem discordar. A migração
-- 20260831120000 faz o kanban EMPURRAR o ciclo de vida -- mas só para frente, e
-- só a partir de agora. O que já estava torto continua torto.
--
-- Três causas produzem o mesmo sintoma, e a saída é diferente em cada uma. Este
-- script as separa antes de qualquer correção.
--
-- Nenhuma parte aqui ALTERA dado. A correção é a PARTE 4, e está comentada.
-- ============================================================================

-- ---------- PARTE 1: quantos, e por qual causa ----------

WITH avancados AS (
  SELECT c.id, c.first_name, c.last_name, c.lifecycle_stage, c.metadata->>'source' AS origem
    FROM public.contacts c
   WHERE c.lifecycle_stage IN ('qualified', 'opportunity', 'customer')
),
com_negocio AS (
  SELECT a.*,
         (SELECT count(*) FROM public.deals d WHERE d.contact_id = a.id) AS negocios,
         (SELECT count(*) FROM public.deals d
           WHERE d.contact_id = a.id AND d.status NOT IN ('won', 'lost')) AS abertos
    FROM avancados a
)
SELECT CASE
         WHEN negocios = 0 THEN '1. SEM NEGÓCIO NENHUM — o gatilho de entrada não rodou, ou o negócio foi apagado'
         WHEN abertos = 0  THEN '2. só negócio ganho/perdido — o kanban de abertos não mostra, e está certo'
         ELSE                   '3. tem negócio aberto — aparece no kanban; se não vê, é filtro de funil ou de dono'
       END AS causa,
       count(*) AS contatos
  FROM com_negocio
 GROUP BY 1
 ORDER BY 1;


-- ---------- PARTE 2: quem são, na causa 1 (a que precisa de correção) ----------

SELECT c.id,
       trim(concat(c.first_name, ' ', coalesce(c.last_name, ''))) AS nome,
       c.lifecycle_stage,
       c.metadata->>'source'   AS origem,
       c.created_at::date      AS criado,
       c.qualified_at::date    AS qualificado_em
  FROM public.contacts c
 WHERE c.lifecycle_stage IN ('qualified', 'opportunity', 'customer')
   AND NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.contact_id = c.id)
 ORDER BY c.created_at DESC
 LIMIT 100;


-- ---------- PARTE 3: veio de importação com coluna de estágio? ----------
--
-- Se a maioria dos avançados tem `importado_em`, a causa é a planilha: uma
-- coluna mapeada para "Ciclo de vida" avançou o contato, e o gatilho de entrada
-- criou o negócio na PRIMEIRA etapa -- então o selo diz "negociação" e o card
-- está na coluna de entrada. Não é o mesmo defeito, mas produz a mesma
-- estranheza na tela.

SELECT c.lifecycle_stage,
       count(*) FILTER (WHERE c.metadata->>'importado_em' IS NOT NULL) AS de_planilha,
       count(*) FILTER (WHERE c.metadata->>'importado_em' IS NULL)     AS de_outro_lugar
  FROM public.contacts c
 WHERE c.lifecycle_stage IN ('qualified', 'opportunity', 'customer')
 GROUP BY 1
 ORDER BY 1;


-- ---------- PARTE 4: as duas correções ----------
--
-- ESCOLHA UMA, conforme a PARTE 1 e a PARTE 3 mostrarem. Descomente só a que
-- você quer, e rode dentro da transação para poder desistir.

/*
-- 4a. CRIAR o negócio que falta, na etapa de entrada.
--     Para a causa 1: o contato está avançado e não tem card nenhum. Mantém o
--     ciclo de vida e devolve a pessoa ao quadro.
BEGIN;
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.id FROM public.contacts c
     WHERE c.lifecycle_stage IN ('qualified', 'opportunity', 'customer')
       AND NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.contact_id = c.id)
  LOOP
    PERFORM public.criar_negocio_de_entrada(r.id);
  END LOOP;
END $$;
COMMIT;
*/

/*
-- 4b. DEVOLVER o contato para "lead", quando o avanço foi engano da planilha.
--     Para a causa da PARTE 3: você quer todos a qualificar, e a coluna de
--     estágio da planilha avançou gente que ninguém avaliou.
--
--     Escreve `lifecycle_stage` e NUNCA `status`: no UPDATE o gatilho
--     sync_contact_lifecycle deriva o status a partir do ciclo, e escrever os
--     dois faria um vencer o outro de forma imprevisível.
--
--     `qualified_at` e `qualified_by` voltam a nulo: deixá-los preenchidos
--     afirmaria que alguém qualificou, com nome e data, o que não aconteceu.
BEGIN;
UPDATE public.contacts c
   SET lifecycle_stage = 'lead',
       qualified_at = NULL,
       qualified_by = NULL
 WHERE c.lifecycle_stage IN ('qualified', 'opportunity')
   AND c.metadata->>'importado_em' IS NOT NULL
   -- Só quem NÃO teve avanço no quadro: se o card já saiu da entrada, alguém
   -- mexeu de propósito e rebaixar apagaria essa decisão.
   AND NOT EXISTS (
     SELECT 1 FROM public.deals d
       JOIN public.pipeline_stages s ON s.id = d.stage_id
      WHERE d.contact_id = c.id
        AND d.stage_id <> public.etapa_de_entrada(s.pipeline_id)
   );
COMMIT;
*/
