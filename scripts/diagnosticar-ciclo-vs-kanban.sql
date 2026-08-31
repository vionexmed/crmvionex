-- ============================================================================
-- Contato em "negociação" que não aparece no kanban
-- ============================================================================
--
-- O ciclo de vida (`contacts.lifecycle_stage`) e a coluna do kanban
-- (`deals.stage_id`) são DUAS coisas, e podem discordar. A migração
-- 20260831120000 faz o kanban EMPURRAR o ciclo de vida -- mas só para frente, e
-- só a partir de agora. O que já estava torto continua torto.
--
-- QUATRO situações produzem o mesmo sintoma, e a saída é diferente em cada uma. A
-- consulta abaixo as separa antes de qualquer correção.
--
-- Ela NÃO altera dado. As correções estão no fim, comentadas.
-- ============================================================================

-- ---------- O DIAGNÓSTICO: uma consulta, e é a única ----------
--
-- Havia três consultas separadas aqui, e isso era um defeito do arquivo: o
-- editor do Supabase mostra só o resultado do ÚLTIMO SELECT de um script. Quem
-- colava o arquivo inteiro via a terceira -- a menos útil das três -- e as
-- outras duas ficavam invisíveis.
--
-- Agora é UMA. Ela responde o que as três respondiam juntas, então colar o
-- arquivo inteiro dá o resultado certo.

SELECT CASE
         WHEN d.negocios = 0 THEN '1 · SEM NEGÓCIO — precisa da correção A'
         WHEN d.abertos  = 0 THEN '2 · só ganho/perdido — kanban de abertos não mostra, e está certo'
         WHEN d.fora_da_entrada > 0
           THEN '3 · card já avançado — está no kanban; se não vê, é filtro de funil ou de dono'
         ELSE '4 · card na COLUNA DE ENTRADA — o selo diz avançado e o quadro diz que não'
       END                                                    AS situacao,
       d.lifecycle_stage                                      AS ciclo_de_vida,
       count(*)                                               AS contatos,
       count(*) FILTER (WHERE d.de_planilha)                   AS veio_de_planilha,
       string_agg(d.nome, ', ' ORDER BY d.nome)
         FILTER (WHERE d.negocios = 0)                        AS quem_esta_sem_negocio
  FROM (
    SELECT c.id,
           c.lifecycle_stage::text,
           trim(concat(c.first_name, ' ', coalesce(c.last_name, ''))) AS nome,
           (c.metadata->>'importado_em') IS NOT NULL          AS de_planilha,
           (SELECT count(*) FROM public.deals x WHERE x.contact_id = c.id) AS negocios,
           (SELECT count(*) FROM public.deals x
             WHERE x.contact_id = c.id AND x.status NOT IN ('won','lost'))  AS abertos,
           (SELECT count(*) FROM public.deals x
              JOIN public.pipeline_stages s ON s.id = x.stage_id
             WHERE x.contact_id = c.id
               AND x.status NOT IN ('won','lost')
               AND x.stage_id <> public.etapa_de_entrada(s.pipeline_id))    AS fora_da_entrada
      FROM public.contacts c
     WHERE c.lifecycle_stage IN ('qualified','opportunity','customer')
  ) d
 GROUP BY 1, 2
 ORDER BY 1, 2;


-- ---------- PARTE 4: as duas correções ----------
--
-- ESCOLHA conforme a coluna `situacao` do diagnóstico. Descomente só a que você
-- quer, e rode dentro da transação para poder desistir.
--
-- As situações 2 e 3 NÃO precisam de correção -- estão certas.

/*
-- A. CRIAR o negócio que falta, na etapa de entrada.
--     Para a situação 1: o contato está avançado e não tem card nenhum. Mantém o
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
-- B. DEVOLVER o contato para "lead", quando o avanço foi engano da planilha.
--     Para quem veio de planilha avançado: você quer todos a qualificar, e a coluna de
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
