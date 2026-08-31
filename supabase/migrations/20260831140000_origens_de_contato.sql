-- ============================================================================
-- As origens que EXISTEM, para o filtro deixar de ser lista fixa
-- ============================================================================
--
-- PROBLEMA
--
-- O filtro "Origem" da tela de Contatos tinha quatro opções cravadas em
-- `ORIGIN_OPTIONS`: Cadastro Likawave, Landing Page, Manual e Importação. São
-- BUCKETS -- agrupam por padrão de texto.
--
-- Desde que a importação passou a gravar o nome escolhido pelo usuário
-- ("NEXMED 2026", "APROXIMA MED"), o selo da lista mostra um valor que o filtro
-- não oferece. Dá para ver a origem e não dá para filtrar por ela, o que é o
-- pior dos dois mundos: a informação aparece e não serve para nada.
--
-- POR QUE UMA FUNÇÃO E NÃO UMA CONSULTA DA TELA
--
-- Precisa de DISTINCT com contagem, que o PostgREST não expressa. A alternativa
-- seria baixar os contatos e agrupar no navegador -- e aí o teto silencioso de
-- 1000 linhas faria a lista de origens ficar incompleta a partir do contato
-- 1001, sem avisar. Com 835 contatos hoje, isso quebraria na próxima planilha.
--
-- O RECORTE POR CARTEIRA É REPOSTO À MÃO
--
-- SECURITY DEFINER contorna a RLS de `contacts`, que é por dono
-- (contacts_select, 20260702110000). Sem a checagem abaixo, um comercial veria
-- na lista de origens as planilhas de outra pessoa -- e a contagem entregaria
-- o tamanho da carteira dela.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.origens_de_contato(_org_id uuid)
RETURNS TABLE (origem text, contatos int)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_admin boolean;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.user_belongs_to_org(auth.uid(), _org_id) THEN
    RAISE EXCEPTION 'Sem permissão nesta organização';
  END IF;

  v_admin := auth.uid() IS NULL OR public.is_org_admin(auth.uid(), _org_id);

  RETURN QUERY
  SELECT nullif(btrim(c.metadata->>'source'), '')::text AS origem,
         count(*)::int
    FROM public.contacts c
   WHERE c.org_id = _org_id
     AND nullif(btrim(c.metadata->>'source'), '') IS NOT NULL
     AND (v_admin OR c.owner_id = auth.uid())
   GROUP BY 1
   -- Mais numerosa primeiro: a planilha de 800 leads interessa mais que a de 3.
   -- Empate pelo nome, para a ordem não dançar entre carregamentos.
   ORDER BY 2 DESC, 1 ASC;
END;
$$;

COMMENT ON FUNCTION public.origens_de_contato(uuid) IS
  'Origens distintas (metadata.source) com contagem, para alimentar o filtro da tela de Contatos. Respeita o recorte por carteira.';

GRANT EXECUTE ON FUNCTION public.origens_de_contato(uuid) TO authenticated;

-- Índice para o GROUP BY não varrer a tabela inteira a cada abertura do filtro.
CREATE INDEX IF NOT EXISTS idx_contacts_origem
  ON public.contacts (org_id, (metadata->>'source'))
  WHERE metadata->>'source' IS NOT NULL;
