-- Consentimento de contato (LGPD)
--
-- O formulário Likawave sempre perguntou a autorização, e a resposta caía em
-- `contacts.metadata->>'autorizacao'` como a frase inteira -- inclusive a
-- variante "NÃO AUTORIZO o contato da equipe...". Só que nenhum disparador
-- lia esse campo: sequência de e-mail, automação e WhatsApp enviavam do mesmo
-- jeito para quem tinha recusado. Não havia sequer onde registrar uma
-- revogação pedida depois ("me tira da lista").
--
-- Aqui a recusa vira coluna, indexada e consultável, e os disparadores passam
-- a filtrar por ela. A frase original continua no metadata como prova de
-- origem do consentimento.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS descadastrado_em timestamptz,
  ADD COLUMN IF NOT EXISTS descadastrado_motivo text;

COMMENT ON COLUMN public.contacts.descadastrado_em IS
  'Quando o contato deixou de autorizar contato comercial. NULL = pode receber. Todo disparador filtra por esta coluna.';
COMMENT ON COLUMN public.contacts.descadastrado_motivo IS
  'De onde veio a recusa: formulário de captação, pedido do próprio contato, bounce, etc.';

-- Índice parcial: as consultas de envio perguntam sempre "quem PODE receber",
-- então só a fatia com NULL precisa ser indexada.
CREATE INDEX IF NOT EXISTS idx_contacts_pode_receber
  ON public.contacts (org_id)
  WHERE descadastrado_em IS NULL;

-- Backfill: quem já respondeu "NÃO AUTORIZO" no formulário passa a estar
-- bloqueado de fato. Cobre "NÃO"/"NAO" porque o texto veio de digitação
-- livre do Google Forms e nem sempre tem acento.
UPDATE public.contacts
SET descadastrado_em = COALESCE(updated_at, created_at, now()),
    descadastrado_motivo = 'Formulário de captação: não autorizou contato'
WHERE descadastrado_em IS NULL
  AND (
    metadata->>'autorizacao' ILIKE 'NÃO AUTORIZO%'
    OR metadata->>'autorizacao' ILIKE 'NAO AUTORIZO%'
  );
