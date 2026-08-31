-- ============================================================================
-- E-mail guarda as PASTAS (labels) do Gmail
-- ============================================================================
--
-- PROBLEMA
--
-- A tela de E-mail tinha sete "pastas" — Caixa de entrada, Arquivados, Lixeira,
-- Spam, Favoritos, Adiados, Importantes — e TODAS eram flags locais do CRM
-- (`is_archived`, `is_trashed`, …). Nenhuma correspondia a pasta do Gmail, e não
-- havia como guardar as pastas que a pessoa realmente usa.
--
-- Pior: as ações da tela nunca chegavam ao Gmail. Arquivar gravava
-- `is_archived = true` e o e-mail continuava na caixa de entrada do Google.
--
-- `labels` guarda os IDs de label que o Gmail informa para cada mensagem. Os IDs
-- e não os nomes: o nome é editável pela pessoa a qualquer momento, e uma pasta
-- renomeada faria toda mensagem dela virar órfã. O nome é resolvido na tela, a
-- partir da lista de labels da conta.
-- ============================================================================

ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS labels text[];

COMMENT ON COLUMN public.emails.labels IS
  'IDs de label do Gmail da mensagem (INBOX, UNREAD, Label_123…). IDs e não nomes: nome é editável e renomear tornaria as mensagens órfãs.';

-- Índice GIN para "quais mensagens estão nesta pasta" não varrer a tabela.
-- `array_ops` porque a consulta usa `labels && ARRAY['Label_123']`.
CREATE INDEX IF NOT EXISTS idx_emails_labels
  ON public.emails USING gin (labels)
  WHERE labels IS NOT NULL;
