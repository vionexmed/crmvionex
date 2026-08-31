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
-- Descomente TUDO abaixo, de uma vez. A ordem dos DELETEs é obrigatória.

/*
BEGIN;

CREATE TEMP TABLE lote_para_apagar AS
  SELECT c.id FROM public.contacts c
   WHERE c.metadata->>'source' = 'APROXIMA MED'          -- <<< TROQUE AQUI TAMBÉM
     AND c.metadata->>'importado_em' IS NOT NULL;

-- 1. Atividades primeiro (as notas da importação estão aqui).
DELETE FROM public.activities
 WHERE contact_id IN (SELECT id FROM lote_para_apagar);

-- 2. Negócios. O histórico de ciclo de vida (`contact_lifecycle_events`) tem
--    ON DELETE CASCADE e vai junto com o contato -- não precisa de linha própria.
DELETE FROM public.deals
 WHERE contact_id IN (SELECT id FROM lote_para_apagar);

-- 3. Agora sim os contatos. E-mails e mensagens de WhatsApp apontam com
--    ON DELETE SET NULL: não bloqueiam, e ficam sem contato em vez de sumir.
DELETE FROM public.contacts
 WHERE id IN (SELECT id FROM lote_para_apagar);

DROP TABLE lote_para_apagar;

-- Confira as três contagens contra a PARTE 2. Se alguma divergir, ROLLBACK.
COMMIT;
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
BEGIN;
DELETE FROM public.companies co
 WHERE NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.company_id = co.id)
   AND NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.company_id = co.id);
COMMIT;
*/
