-- ============================================================================
-- Todo mundo começa como lead, e só o kanban avança
-- ============================================================================
--
-- PEDIDO: "tem qualificado sendo que nao foi ainda... todos precisam acompanhar
-- o kanban desde o inicio da entrada dele no crm".
--
-- O ciclo de vida e a coluna do kanban são DUAS coisas e podem discordar. A
-- migração 20260831120000 faz o kanban empurrar o ciclo -- mas só para frente e
-- só a partir de quando é aplicada. O que já estava torto continua torto, e é o
-- que este script endireita.
--
-- A REGRA: o quadro manda. Contato marcado como avançado cujo card ainda está na
-- COLUNA DE ENTRADA volta a ser lead -- porque ninguém o moveu, logo ninguém o
-- qualificou. Quem tem card fora da entrada fica como está: aquilo foi decisão
-- de alguém.
--
-- 'customer' NÃO é tocado. Cliente vem de negócio GANHO, que é fato registrado,
-- não rótulo herdado.
--
-- `qualified_at` e `qualified_by` voltam a nulo: deixá-los preenchidos afirmaria
-- que alguém qualificou, com nome e data, o que não aconteceu.
--
-- Escreve `lifecycle_stage` e NUNCA `status`: no UPDATE o gatilho
-- sync_contact_lifecycle deriva o status a partir do ciclo. Escrever os dois
-- faria um vencer o outro de forma imprevisível -- a armadilha do CLAUDE.md.
--
-- O histórico registra a volta: `registrar_transicao_de_ciclo` é AFTER UPDATE OF
-- lifecycle_stage, então a correção aparece em `contact_lifecycle_events` em vez
-- de reescrever o passado em silêncio.
-- ============================================================================

-- ---------- PARTE 1: quem seria afetado, e por quê ----------

SELECT c.lifecycle_stage::text                            AS ciclo_atual,
       CASE
         WHEN NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.contact_id = c.id)
           THEN 'sem negócio nenhum'
         ELSE 'card na coluna de entrada'
       END                                                AS motivo,
       count(*)                                           AS contatos,
       string_agg(trim(concat(c.first_name, ' ', coalesce(c.last_name, ''))), ', '
                  ORDER BY c.first_name)                  AS quem
  FROM public.contacts c
 WHERE c.lifecycle_stage IN ('qualified', 'opportunity')
   -- Nenhum negócio FORA da etapa de entrada: ninguém moveu este card.
   AND NOT EXISTS (
     SELECT 1 FROM public.deals d
       JOIN public.pipeline_stages s ON s.id = d.stage_id
      WHERE d.contact_id = c.id
        AND d.status NOT IN ('won', 'lost')
        AND d.stage_id <> public.etapa_de_entrada(s.pipeline_id)
   )
   -- E nenhum negócio ganho: isso seria cliente, e cliente não é tocado.
   AND NOT EXISTS (
     SELECT 1 FROM public.deals d WHERE d.contact_id = c.id AND d.status = 'won'
   )
 GROUP BY 1, 2
 ORDER BY 1, 2;


-- ---------- PARTE 2: corrigir ----------
-- Descomente e rode. Comando único, atômico por si.

/*
UPDATE public.contacts c
   SET lifecycle_stage = 'lead',
       qualified_at    = NULL,
       qualified_by    = NULL
 WHERE c.lifecycle_stage IN ('qualified', 'opportunity')
   AND NOT EXISTS (
     SELECT 1 FROM public.deals d
       JOIN public.pipeline_stages s ON s.id = d.stage_id
      WHERE d.contact_id = c.id
        AND d.status NOT IN ('won', 'lost')
        AND d.stage_id <> public.etapa_de_entrada(s.pipeline_id)
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.deals d WHERE d.contact_id = c.id AND d.status = 'won'
   );
*/


-- ---------- PARTE 3: quem ficou sem card, e precisa de um ----------
--
-- "Todos precisam acompanhar o kanban" também vale para quem não tem card
-- nenhum: sem negócio, a pessoa não aparece no quadro e não há o que arrastar.

SELECT count(*) AS contatos_sem_card
  FROM public.contacts c
 WHERE NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.contact_id = c.id);

/*
-- Descomente para criar o card de entrada de quem não tem.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.id FROM public.contacts c
     WHERE NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.contact_id = c.id)
  LOOP
    PERFORM public.criar_negocio_de_entrada(r.id);
  END LOOP;
END $$;
*/
