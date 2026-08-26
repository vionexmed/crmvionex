-- ============================================================================
-- Ninguém nunca virava "Contatado"
-- ============================================================================
--
-- `lifecycle_stage` tem seis valores, e 'contacted' era inalcançável: nenhuma
-- migração, função ou tela jamais escrevia esse valor. Ele só aparecia em
-- leituras (`IN ('lead','contacted')`).
--
-- Isso passava despercebido enquanto a maior parte dos contatos nascia
-- 'qualified' por um bug de derivação. Corrigido esse bug, o defeito fica óbvio
-- e grave: toda pessoa entra em 'lead' e FICA LÁ PARA SEMPRE. A fila de leads
-- cresce sem parar, ninguém sabe quem já foi abordado, e a etapa "Contatados"
-- do funil SDR fica permanentemente em zero.
--
-- Uma fila que não anda não é uma fila, é uma pilha de coisas esquecidas.
--
-- ---------------------------------------------------------------------------
-- O critério: MESMA definição de "abordagem realizada" do painel
-- ---------------------------------------------------------------------------
--
-- Cada tabela guarda a intenção e a conclusão em campos separados, e é a
-- conclusão que conta:
--
--   activities         completed_at IS NOT NULL
--   emails             status = 'sent'
--   whatsapp_messages  status IN ('sent','delivered','read')
--
-- É o critério fixado em 20260826140000. Inventar um terceiro dialeto aqui faria
-- o card "Abordagens realizadas" e o estágio do contato discordarem sobre o
-- mesmo evento -- e quem visse a discordância chamaria os dois de errados.
--
-- Só SAÍDA conta. "Contatado" significa que NÓS falamos com a pessoa; se ela
-- escreve primeiro, isso é uma resposta a ser tratada, não uma abordagem nossa.
--
-- ---------------------------------------------------------------------------
-- Por que INSERT **e** UPDATE
-- ---------------------------------------------------------------------------
--
-- O e-mail não nasce enviado. `gmail-send` grava a linha com status 'sending'
-- para ter id de rastreio e só depois promove para 'sent'. Um trigger que só
-- olhasse o INSERT nunca veria um e-mail sair. O mesmo vale para o WhatsApp,
-- que nasce na tentativa e é atualizado quando a Meta responde, e para a
-- atividade, que quase sempre é criada agendada e concluída depois.
--
-- Na prática o caminho do UPDATE é o principal, não a exceção.

-- ---------- 1. A promoção ----------

CREATE OR REPLACE FUNCTION public.promover_lead_para_contatado(
  _contact_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- SECURITY DEFINER porque quem registra a abordagem não é necessariamente
  -- quem tem permissão de escrita no contato: a RLS de `contacts` é por dono, e
  -- um vendedor pode mandar e-mail para lead de outro. Sem isto a promoção
  -- falharia em silêncio justamente nos casos que mais importam.
  --
  -- `WHERE lifecycle_stage = 'lead'` faz três coisas de uma vez: torna a chamada
  -- idempotente (a segunda abordagem não escreve nada), impede regressão de quem
  -- já avançou para 'qualified' ou além, e evita disparar o trigger de `contacts`
  -- -- que reescreveria `lifecycle_changed_at` a cada mensagem enviada, apagando
  -- a data em que a pessoa foi contatada de fato.
  UPDATE public.contacts
     SET lifecycle_stage = 'contacted'
   WHERE id = _contact_id
     AND lifecycle_stage = 'lead';
$$;

COMMENT ON FUNCTION public.promover_lead_para_contatado(uuid) IS
  'Avança um contato de lead para contatado na primeira abordagem realizada. Idempotente e nunca regride: quem já passou de lead não é tocado.';

REVOKE ALL ON FUNCTION public.promover_lead_para_contatado(uuid) FROM public;

-- ---------- 2. Atividade concluída ----------

CREATE OR REPLACE FUNCTION public.tg_atividade_contatou()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 'note' e 'task' não são abordagem: anotar algo sobre alguém não é falar com
  -- essa pessoa. Mesma lista de tipos que sdr_metrics usa.
  IF NEW.contact_id IS NOT NULL
     AND NEW.type IN ('call', 'email', 'meeting')
     AND NEW.completed_at IS NOT NULL THEN
    PERFORM public.promover_lead_para_contatado(NEW.contact_id);
  END IF;
  RETURN NULL; -- AFTER trigger: o retorno é ignorado
END;
$$;

DROP TRIGGER IF EXISTS atividade_contatou ON public.activities;
CREATE TRIGGER atividade_contatou
  AFTER INSERT OR UPDATE OF completed_at, contact_id ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.tg_atividade_contatou();

-- ---------- 3. E-mail enviado ----------

CREATE OR REPLACE FUNCTION public.tg_email_contatou()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL
     AND NEW.direction = 'outbound'
     AND NEW.status = 'sent' THEN
    PERFORM public.promover_lead_para_contatado(NEW.contact_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS email_contatou ON public.emails;
CREATE TRIGGER email_contatou
  AFTER INSERT OR UPDATE OF status, contact_id ON public.emails
  FOR EACH ROW EXECUTE FUNCTION public.tg_email_contatou();

-- ---------- 4. WhatsApp aceito pela Meta ----------

CREATE OR REPLACE FUNCTION public.tg_whatsapp_contatou()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL
     AND NEW.direction = 'outbound'
     AND NEW.status IN ('sent', 'delivered', 'read') THEN
    PERFORM public.promover_lead_para_contatado(NEW.contact_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_contatou ON public.whatsapp_messages;
CREATE TRIGGER whatsapp_contatou
  AFTER INSERT OR UPDATE OF status, contact_id ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_whatsapp_contatou();

-- ---------- 5. Índices ----------
--
-- Nenhum. Eu havia criado três aqui, afirmando que `emails` e
-- `whatsapp_messages` não tinham índice por contact_id. Tinham:
--
--   idx_activities_contact_id       (20260315232842)
--   idx_emails_contact_id           (20260315235301)
--   idx_whatsapp_messages_contact   (20260513181405)
--
-- Os três cobrem tanto o EXISTS do backfill quanto a consulta do trigger.
-- Acrescentar (contact_id, direction) por cima de (contact_id) daria ganho
-- desprezível -- contact_id já é seletivo o bastante, são poucas linhas por
-- contato -- e custaria escrita e disco em três das tabelas que mais crescem.

-- ---------- 6. Quem já foi abordado antes destes triggers existirem ----------
--
-- Sem isto os triggers só valem para o futuro, e todo lead já trabalhado
-- continuaria na fila -- o que faria a correção parecer não ter funcionado.
--
-- Só avança quem está em 'lead': ninguém é rebaixado aqui.
UPDATE public.contacts c
   SET lifecycle_stage = 'contacted'
 WHERE c.lifecycle_stage = 'lead'
   AND (
     EXISTS (
       SELECT 1 FROM public.activities a
        WHERE a.contact_id = c.id
          AND a.type IN ('call', 'email', 'meeting')
          AND a.completed_at IS NOT NULL
     )
     OR EXISTS (
       SELECT 1 FROM public.emails e
        WHERE e.contact_id = c.id
          AND e.direction = 'outbound'
          AND e.status = 'sent'
     )
     OR EXISTS (
       SELECT 1 FROM public.whatsapp_messages w
        WHERE w.contact_id = c.id
          AND w.direction = 'outbound'
          AND w.status IN ('sent', 'delivered', 'read')
     )
   );
