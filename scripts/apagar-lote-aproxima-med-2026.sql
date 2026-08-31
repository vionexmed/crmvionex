-- Apaga o lote 'APROXIMA MED 2026'. UM comando só.
--
-- Comando único porque o editor do Supabase roda cada `;` separadamente, e uma
-- TEMP TABLE criada num comando não existe no seguinte -- foi o
-- "relation lote does not exist".
--
-- E funciona apesar das chaves estrangeiras por um detalhe: `deals.contact_id` e
-- `activities.contact_id` são NO ACTION, não RESTRICT. NO ACTION permite a
-- checagem ser ADIADA para o fim do comando, então pai e filhos saem juntos.
-- Com RESTRICT isto falharia.
--
-- Para o outro lote, troque o texto na linha do `lote` por 'APROXIMA MED'.

WITH lote AS (
  SELECT c.id
    FROM public.contacts c
   WHERE c.metadata->>'source' = 'APROXIMA MED 2026'
),
del_ativ AS (
  DELETE FROM public.activities
   WHERE contact_id IN (SELECT id FROM lote)
  RETURNING 1
),
del_neg AS (
  DELETE FROM public.deals
   WHERE contact_id IN (SELECT id FROM lote)
  RETURNING 1
),
del_cont AS (
  DELETE FROM public.contacts
   WHERE id IN (SELECT id FROM lote)
  RETURNING 1
)
SELECT (SELECT count(*) FROM del_cont) AS contatos_apagados,
       (SELECT count(*) FROM del_neg)  AS negocios_apagados,
       (SELECT count(*) FROM del_ativ) AS atividades_apagadas;
