-- ============================================================================
-- Remover os 3 e-mails de teste que estão contando como abordagem
-- ============================================================================
--
-- São linhas de `public.emails` com `status = 'sent'`, `direction = 'outbound'`
-- e `contact_id` nulo -- por isso o painel as rotula "Sem lead vinculado" e as
-- soma em "Abordagens realizadas".
--
-- Nada referencia `emails.id`: o rastreio de abertura e clique são contadores na
-- própria linha (`open_count`, `click_count`), não uma tabela filha. Então o
-- DELETE não deixa órfão nem esbarra em chave estrangeira.
--
-- RODE A PARTE 1 PRIMEIRO. Ela não apaga nada -- mostra exatamente o que a
-- PARTE 2 vai remover. Confira que são as três linhas da sua captura de tela
-- (TESTE 25/08, E-mail teste 25/08, Teste 24/08) e SÓ ELAS antes de seguir.
-- ============================================================================


-- ---------- PARTE 1: conferir (não apaga nada) ----------

SELECT e.id,
       e.subject,
       e.status,
       e.to_emails,
       e.contact_id,
       coalesce(e.sent_at, e.created_at) AS quando,
       p.name AS por
  FROM public.emails e
  LEFT JOIN public.profiles p ON p.id = e.user_id
 WHERE e.direction = 'outbound'
   AND e.contact_id IS NULL
   -- 'TESTE' e 'Teste' diferem só na caixa; o lower() pega as duas.
   AND lower(btrim(e.subject)) IN ('teste', 'e-mail teste')
   -- Janela folgada de propósito: o fuso do banco é UTC e a tela mostra
   -- UTC-3, então apertar a janela por dia corre risco de perder a linha das
   -- 18:48, que em UTC é do dia seguinte.
   AND coalesce(e.sent_at, e.created_at) >= '2026-08-20'
   AND coalesce(e.sent_at, e.created_at) <  '2026-08-27'
 ORDER BY quando DESC;


-- ---------- PARTE 2: apagar ----------
-- Só depois de a PARTE 1 devolver exatamente as três linhas esperadas.

BEGIN;

DELETE FROM public.emails e
 WHERE e.direction = 'outbound'
   AND e.contact_id IS NULL
   AND lower(btrim(e.subject)) IN ('teste', 'e-mail teste')
   AND coalesce(e.sent_at, e.created_at) >= '2026-08-20'
   AND coalesce(e.sent_at, e.created_at) <  '2026-08-27';

-- Confira que diz 3. Se disser outra coisa, ROLLBACK em vez de COMMIT.
COMMIT;


-- ---------- PARTE 3: conferir que sumiram ----------

SELECT count(*) AS ainda_restam
  FROM public.emails e
 WHERE e.direction = 'outbound'
   AND e.contact_id IS NULL
   AND lower(btrim(e.subject)) IN ('teste', 'e-mail teste');
