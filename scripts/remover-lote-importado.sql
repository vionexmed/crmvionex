-- ============================================================================
-- Remover um LOTE importado, para reimportar com o mapeamento corrigido
-- ============================================================================
--
-- POR QUE ISTO NÃO É UM `DELETE FROM contacts`
--
-- Duas chaves estrangeiras recusam a exclusão (registrado no CLAUDE.md):
--
--   deals.contact_id       NO ACTION -- BLOQUEIA apagar o contato
--   activities.contact_id  NO ACTION -- BLOQUEIA apagar o contato
--
-- E TODO contato tem negócio: o gatilho `contato_entra_no_funil` cria um na
-- etapa de entrada em cada INSERT. Então um DELETE direto falha em 100% dos
-- casos, com erro de violação de chave.
--
-- Os filhos vão primeiro. Dentro de UMA transação, porque o PostgREST não expõe
-- transação e este é o caminho para não sobrar negócio órfão apontando para
-- contato que não existe mais.
--
-- ---------------------------------------------------------------------------
-- ANTES DE RODAR: escolha o lote pela ORIGEM
-- ---------------------------------------------------------------------------
--
-- Troque 'APROXIMA MED' pelo valor exato que aparece no selo de Origem. A PARTE
-- 1 lista as origens com contagem, para você copiar o texto certo -- origem com
-- espaço a mais ou acento diferente não casa, e o DELETE não apagaria nada.
-- ============================================================================

-- ---------- PARTE 1: quais lotes existem ----------

SELECT c.metadata->>'source'      AS origem,
       count(*)                   AS contatos,
       min(c.created_at)          AS primeiro,
       max(c.created_at)          AS ultimo,
       count(*) FILTER (WHERE nullif(btrim(c.phone), '') IS NOT NULL) AS com_telefone,
       count(*) FILTER (WHERE nullif(btrim(c.title), '') IS NOT NULL) AS com_especialidade
  FROM public.contacts c
 WHERE c.metadata->>'importado_em' IS NOT NULL
 GROUP BY 1
 ORDER BY ultimo DESC;


-- ---------- PARTE 2: o que exatamente vai embora ----------
-- Confira os números ANTES de descomentar a PARTE 3.

WITH lote AS (
  SELECT c.id FROM public.contacts c
   WHERE c.metadata->>'source' = 'APROXIMA MED'          -- <<< TROQUE AQUI
     AND c.metadata->>'importado_em' IS NOT NULL          -- só o que veio de planilha
)
SELECT (SELECT count(*) FROM lote)                                        AS contatos,
       (SELECT count(*) FROM public.deals d      WHERE d.contact_id IN (SELECT id FROM lote)) AS negocios,
       (SELECT count(*) FROM public.activities a WHERE a.contact_id IN (SELECT id FROM lote)) AS atividades,
       -- Negócio que alguém MOVEU do lugar é trabalho humano. Se este número
       -- for maior que zero, pare: apagar joga fora decisão de alguém.
       (SELECT count(*) FROM public.deals d
          JOIN public.pipeline_stages s ON s.id = d.stage_id
         WHERE d.contact_id IN (SELECT id FROM lote)
           AND d.stage_id <> public.etapa_de_entrada(s.pipeline_id))       AS negocios_ja_movidos,
       (SELECT count(*) FROM public.deals d
         WHERE d.contact_id IN (SELECT id FROM lote) AND d.status IN ('won','lost')) AS negocios_fechados;


-- ---------- PARTE 3: apagar ----------
--
-- UM COMANDO SÓ, e não é preferência de estilo: o editor do Supabase roda cada
-- `;` separadamente, e uma `TEMP TABLE` criada num comando NÃO EXISTE no
-- seguinte. A primeira versão deste script usava temp table e falhava com
-- `relation "lote" does not exist`.
--
-- E funciona apesar das chaves estrangeiras por um detalhe do schema:
-- `deals.contact_id` e `activities.contact_id` são NO ACTION, não RESTRICT.
-- NO ACTION permite a checagem ser ADIADA para o fim do comando, então pai e
-- filhos saem juntos. Com RESTRICT este comando falharia.
--
-- Não há BEGIN/COMMIT: comando único já é atômico.

/*
WITH lote AS (
  SELECT c.id FROM public.contacts c
   WHERE c.metadata->>'source' = 'APROXIMA MED'          -- <<< TROQUE AQUI
     AND c.metadata->>'importado_em' IS NOT NULL
),
del_ativ AS (
  DELETE FROM public.activities WHERE contact_id IN (SELECT id FROM lote) RETURNING 1
),
del_neg AS (
  DELETE FROM public.deals      WHERE contact_id IN (SELECT id FROM lote) RETURNING 1
),
del_cont AS (
  DELETE FROM public.contacts   WHERE id         IN (SELECT id FROM lote) RETURNING 1
)
SELECT (SELECT count(*) FROM del_cont) AS contatos_apagados,
       (SELECT count(*) FROM del_neg)  AS negocios_apagados,
       (SELECT count(*) FROM del_ativ) AS atividades_apagadas;
*/


-- ---------- PARTE 4: as empresas criadas pelo lote ----------
--
-- Empresa sem contato nenhum, criada por importação. Fica de fora da PARTE 3 de
-- propósito: a empresa pode ter sido usada por contato de OUTRO lote, e apagar
-- em bloco levaria vínculo alheio.

SELECT co.id, co.name, co.created_at::date
  FROM public.companies co
 WHERE NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.company_id = co.id)
 ORDER BY co.created_at DESC;

/*
-- Descomente para apagar SÓ as empresas que ficaram sem ninguém.
-- Comando único, atômico por si.
DELETE FROM public.companies co
 WHERE NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.company_id = co.id)
   AND NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.company_id = co.id);
*/
