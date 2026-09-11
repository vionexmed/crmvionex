-- ============================================================================
-- APAGAR ATIVIDADE PASSA A SER DA ORGANIZAÇÃO
-- ============================================================================
-- Em 20260909140000 abri ver, criar e editar atividade para a organização e
-- deixei o APAGAR como estava -- de quem registrou, ou de admin. O raciocínio
-- era que apagar a ligação de outra pessoa some com histórico que alimenta
-- métrica do painel.
--
-- O QUE MUDOU, e veio de quem usa: teste de alinhamento e erro de digitação
-- entram no histórico do lead e ENTRAM NA MÉTRICA. Uma nota de teste não é
-- histórico -- é sujeira que empurra número de painel para cima. Bloquear a
-- limpeza para preservar "histórico" preservava justamente o que não é.
--
-- O motivo original continua valendo como CUIDADO, não como trava: quem apagar
-- atividade concluída muda número de mês fechado. Por isso o que abre é a
-- exclusão, e não a auditoria -- `created_at`, `user_id` e `completed_at`
-- continuam gravados em tudo que fica.
--
-- E a exclusão parou de falhar calada: `activitiesApi.deleteMany` passou a
-- pedir `.select("id")` e a comparar quantas linhas saíram. Antes, linha
-- recusada pela RLS voltava do PostgREST como sucesso -- a tela dizia
-- "excluída" e a nota continuava lá.
-- ============================================================================

DO $migracao$
BEGIN
  IF to_regclass('public.activities') IS NULL THEN
    RAISE NOTICE 'public.activities não existe — pulando';
    RETURN;
  END IF;

  EXECUTE $sql$DROP POLICY IF EXISTS "activities_delete" ON public.activities$sql$;
  EXECUTE $sql$CREATE POLICY "activities_delete" ON public.activities FOR DELETE
                 USING (user_belongs_to_org(auth.uid(), org_id))$sql$;
END $migracao$;
