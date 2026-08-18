-- ============================================================================
-- Auditoria de segurança — fechar os furos encontrados
-- ============================================================================
-- Contexto: as 50 tabelas já têm RLS habilitado e 208 políticas vivas, e a
-- varredura não achou nenhuma `USING (true)` nem função SECURITY DEFINER sem
-- `SET search_path`. O que segue são os quatro furos que sobraram.
-- ============================================================================

-- ---------- 1. Mídia do WhatsApp era pública para a internet ----------
-- O bucket nasceu com `public = true` e uma política `FOR SELECT TO public`.
-- Isso significa leitura SEM AUTENTICAÇÃO de tudo que um lead manda por
-- WhatsApp — foto, documento, áudio. Contradiz a regra de que ninguém vê o
-- atendimento do outro, e é dado pessoal de médico e clínica.
--
-- Dá para fechar sem quebrar nada porque NADA no código lê este bucket ainda
-- (a caixa de WhatsApp é o Plano 3). Melhor fechar antes de algo depender de
-- estar aberto.
--
-- `email-logos` continua público de propósito: cliente de e-mail busca a
-- imagem da assinatura sem autenticação nenhuma.
UPDATE storage.buckets SET public = false WHERE id = 'whatsapp-media';

DROP POLICY IF EXISTS "Public can read whatsapp media"            ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload whatsapp media" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own whatsapp media"       ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own whatsapp media"       ON storage.objects;

-- Convenção de caminho definida agora, antes de existir uso: <org_id>/<contact_id>/<arquivo>
-- Ela permite que a política de storage siga a MESMA privacidade das mensagens
-- (`whatsapp_messages_select`): dono do contato, ou administrador.
CREATE POLICY "whatsapp_media_select" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'whatsapp-media'
  AND public.user_belongs_to_org(auth.uid(), ((storage.foldername(name))[1])::uuid)
  AND (
    public.is_org_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
    OR EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = ((storage.foldername(name))[2])::uuid
        AND c.owner_id = auth.uid()
    )
  )
);

CREATE POLICY "whatsapp_media_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'whatsapp-media'
  AND public.user_belongs_to_org(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "whatsapp_media_delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'whatsapp-media'
  AND public.is_org_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

-- ---------- 2. reserve_email_send não checava de quem era a conexão ----------
-- Furo que eu mesmo introduzi. A função é SECURITY DEFINER (passa por cima da
-- RLS) e estava concedida a `authenticated` recebendo qualquer `_connection_id`.
-- Qualquer pessoa logada podia chamá-la em laço com o id de um colega e zerar a
-- cota de envio dele — negação de serviço contra o e-mail de um coworker.
CREATE OR REPLACE FUNCTION public.reserve_email_send(_connection_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  -- A reserva só vale para a própria conexão. `service_role` não passa por
  -- aqui com auth.uid() preenchido, então o envio automático segue liberado.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.email_connections
    WHERE id = _connection_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Esta conexão de e-mail não é sua';
  END IF;

  UPDATE public.email_connections
  SET sent_today = CASE WHEN sent_today_date = current_date THEN sent_today + 1 ELSE 1 END,
      sent_today_date = current_date
  WHERE id = _connection_id
    AND (sent_today_date IS DISTINCT FROM current_date OR sent_today < daily_send_limit)
  RETURNING true INTO v_ok;

  RETURN coalesce(v_ok, false);
END;
$$;

-- ---------- 3. tracking_events aceitava gravação anônima ----------
-- A política era `FOR INSERT WITH CHECK (true)` sem cláusula TO, o que no
-- Postgres vale para PUBLIC — inclui `anon`. Qualquer pessoa, sem login, podia
-- forjar evento de abertura e clique e sujar as métricas de marketing.
--
-- Ninguém precisa dela: a edge function `tracking` grava com service_role, que
-- não passa por RLS.
DROP POLICY IF EXISTS "Public can insert tracking events" ON public.tracking_events;

CREATE POLICY "tracking_events_insert" ON public.tracking_events FOR INSERT TO authenticated
WITH CHECK (public.user_belongs_to_org(auth.uid(), org_id));

-- ---------- 4. Funções de trigger não devem ser chamáveis à mão ----------
-- Chamar uma dessas direto injeta evento falso na fila de automação ou dispara
-- limpeza. São gatilhos: rodam pelo trigger, nunca pelo cliente.
REVOKE EXECUTE ON FUNCTION public.enqueue_contact_event()  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_deal_event()     FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_activity_event() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_automation_events() FROM anon, authenticated;
