-- ============================================================================
-- A BASE DE CONTATOS É DA ORGANIZAÇÃO, NÃO DA CARTEIRA
-- ============================================================================
-- A policy `contacts_select` (20260702110000_rbac_comercial) exigia dono igual
-- ao usuário para quem não é admin. Efeito prático: quem cadastrava um contato
-- era a única pessoa do time a enxergá-lo. O resto da equipe abria a tela de
-- Contatos e não via nada do que o colega tinha acabado de incluir -- sem erro,
-- sem aviso, sem nada que explicasse a lista curta.
--
-- O QUE MUDA, e só isto: contato -- e portanto lead, que é a MESMA tabela --
-- passa a ser lido e editado por qualquer pessoa da organização.
--
-- O QUE CONTINUA PRIVADO, de propósito:
--   - negócios e atividades, que seguem recortados por responsável;
--   - e-mails e conversas de WhatsApp, cuja privacidade não depende desta
--     policy: elas checam `contacts.owner_id` na própria condição
--     (20260817160000), então abrir a leitura de contato não abre a conversa.
--
-- EXCLUIR CONTINUA SENDO DE ADMIN. É a operação sem desfazer, e o CLAUDE.md
-- registra que ela esbarra em negócio e atividade vinculados.
--
-- POR QUE O UPDATE MUDA JUNTO, e não só a leitura: `contactsApi.updateOwner`
-- grava sem `.select()`, e linha recusada pela RLS volta do PostgREST como
-- sucesso -- trocar o responsável não faria nada e ninguém ficaria sabendo. Ver
-- sem poder editar transformaria metade da tela nesse tipo de mentira.
-- ============================================================================

-- ---------- 1. Leitura, criação e edição: qualquer membro da org ----------
DROP POLICY IF EXISTS "contacts_select" ON public.contacts;
CREATE POLICY "contacts_select" ON public.contacts FOR SELECT
  USING (user_belongs_to_org(auth.uid(), org_id));

DROP POLICY IF EXISTS "contacts_insert" ON public.contacts;
CREATE POLICY "contacts_insert" ON public.contacts FOR INSERT
  WITH CHECK (user_belongs_to_org(auth.uid(), org_id));

DROP POLICY IF EXISTS "contacts_update" ON public.contacts;
CREATE POLICY "contacts_update" ON public.contacts FOR UPDATE
  USING (user_belongs_to_org(auth.uid(), org_id))
  WITH CHECK (user_belongs_to_org(auth.uid(), org_id));

-- `contacts_delete` NÃO é redefinida aqui: segue exigindo is_org_admin.

COMMENT ON COLUMN public.contacts.owner_id IS
  'Responsável pelo relacionamento. NÃO é mais quem pode ver: a base de contatos é da organização inteira desde 20260909. Continua valendo como recorte de negócios, atividades e conversas, e como critério de distribuição.';

-- ---------- 2. O filtro de origens tem de contar o mesmo que a lista ----------
--
-- `origens_de_contato` é SECURITY DEFINER (precisa ser: sem isso a contagem
-- trunca em 1000 linhas, que é a armadilha do PostgREST registrada no
-- CLAUDE.md). Justamente por contornar a RLS, ela REPUNHA o recorte por
-- carteira à mão. Se ficasse assim, o filtro do topo da tela de Contatos
-- ofereceria "planilha X (3)" enquanto a lista abaixo mostra 300 -- card,
-- filtro e lista contando coisas diferentes na mesma tela.
CREATE OR REPLACE FUNCTION public.origens_de_contato(_org_id uuid)
RETURNS TABLE (origem text, contatos int)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.user_belongs_to_org(auth.uid(), _org_id) THEN
    RAISE EXCEPTION 'Sem permissão nesta organização';
  END IF;

  RETURN QUERY
  SELECT nullif(btrim(c.metadata->>'source'), '')::text AS origem,
         count(*)::int
    FROM public.contacts c
   WHERE c.org_id = _org_id
     AND nullif(btrim(c.metadata->>'source'), '') IS NOT NULL
   GROUP BY 1
   -- Mais numerosa primeiro: a planilha de 800 leads interessa mais que a de 3.
   -- Empate pelo nome, para a ordem não dançar entre carregamentos.
   ORDER BY 2 DESC, 1 ASC;
END;
$$;

COMMENT ON FUNCTION public.origens_de_contato(uuid) IS
  'Origens distintas (metadata.source) com contagem, para alimentar o filtro da tela de Contatos. Conta a organização inteira, igual à lista.';

GRANT EXECUTE ON FUNCTION public.origens_de_contato(uuid) TO authenticated;
