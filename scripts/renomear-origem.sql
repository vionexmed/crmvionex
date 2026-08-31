-- ============================================================================
-- Renomear a origem de um lote de contatos importados
-- ============================================================================
--
-- A origem fica em `contacts.metadata.source` e é o que o selo da lista mostra.
-- A importação a preenche com o nome do arquivo, e nome de arquivo baixado do
-- navegador costuma vir com sufixo: "INSCRITOS NEXMED (1).xlsx" produziu a
-- origem "INSCRITOS NEXMED (1)".
--
-- Este script troca o texto SEM tocar no resto do metadata: `||` mescla o objeto
-- jsonb em vez de substituí-lo. Trocar por `jsonb_build_object` apagaria as
-- respostas do formulário e a marca `importado_em` -- e a marca é o que faz o
-- filtro "Importação" da tela de Contatos continuar achando essas pessoas.
--
-- RODE A PARTE 1 PRIMEIRO. Ela só mostra.
-- ============================================================================

-- ---------- PARTE 1: conferir (não altera nada) ----------

SELECT c.metadata->>'source'          AS origem_atual,
       count(*)                       AS contatos,
       min(c.created_at)::date        AS primeiro,
       max(c.created_at)::date        AS ultimo
  FROM public.contacts c
 WHERE c.metadata->>'source' IS NOT NULL
 GROUP BY 1
 ORDER BY contatos DESC;


-- ---------- PARTE 2: renomear ----------
-- Troque os dois valores abaixo conforme a PARTE 1 mostrou.

BEGIN;

UPDATE public.contacts c
   SET metadata = c.metadata || jsonb_build_object('source', 'NEXMED 2026')
 WHERE c.metadata->>'source' = 'INSCRITOS NEXMED (1)';

-- Confira o número de linhas. Se não for o esperado, ROLLBACK.
COMMIT;


-- ---------- PARTE 3: conferir que virou ----------

SELECT c.metadata->>'source' AS origem, count(*) AS contatos
  FROM public.contacts c
 WHERE c.metadata->>'source' IN ('NEXMED 2026', 'INSCRITOS NEXMED (1)')
 GROUP BY 1;
