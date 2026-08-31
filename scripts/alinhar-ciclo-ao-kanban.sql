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

-- ---------- A CORREÇÃO ----------
--
-- UM comando, e não três. A versão anterior tinha PARTE 1 (prévia), PARTE 2
-- (correção comentada) e PARTE 3 (sem card) -- e o editor do Supabase mostra só
-- o resultado do ÚLTIMO SELECT. O usuário rodou o arquivo, viu a Parte 3, e a
-- correção nem havia sido descomentada. Terceira vez que esse formato me morde
-- nesta sessão.
--
-- Agora o comando já devolve quem foi afetado, então prévia e correção são a
-- mesma coisa.

-- Rebaixa para "lead" quem está marcado como qualificado SEM ter card fora da
-- coluna de entrada. Um comando só, e ele já diz quem foi afetado.
--
-- A REGRA: o quadro manda. Ninguém moveu o card, logo ninguém qualificou.
--
-- É REVERSÍVEL pela tela: o gatilho `negocio_move_ciclo` está aplicado, então
-- arrastar o card de alguém para a segunda coluna requalifica na hora.
--
-- NÃO toca em 'customer': cliente vem de negócio GANHO, fato registrado.
-- NÃO toca em quem já teve o card movido: aquilo foi decisão de alguém.
WITH corrigidos AS (
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
     )
  RETURNING trim(concat(c.first_name, ' ', coalesce(c.last_name, ''))) AS nome
)
SELECT count(*)                                    AS rebaixados_para_lead,
       string_agg(nome, ' · ' ORDER BY nome)        AS quem
  FROM corrigidos;


-- ---------- QUEM NÃO TEM CARD NENHUM ----------
--
-- "Todos precisam acompanhar o kanban desde a entrada" também vale para quem não
-- tem negócio: sem card, a pessoa não aparece no quadro e não há o que arrastar.
--
-- Comando único que CRIA os que faltam e diz quantos foram. Rode só depois da
-- correção acima -- a ordem importa, porque criar_negocio_de_entrada dispara o
-- gatilho `negocio_move_ciclo`, e o card nasce na entrada (não avança ninguém).

/*
WITH sem_card AS (
  SELECT c.id FROM public.contacts c
   WHERE NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.contact_id = c.id)
),
criados AS (
  SELECT public.criar_negocio_de_entrada(id) AS negocio FROM sem_card
)
SELECT count(*) AS cards_criados FROM criados WHERE negocio IS NOT NULL;
*/
