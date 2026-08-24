-- ============================================================================
-- Assinatura de e-mail por pessoa
-- ============================================================================
--
-- Hoje existem TRÊS camadas de assinatura, e o gmail-send escolhe nesta ordem:
--
--   1. email_connections.signature_html   por pessoa   ← ganha, e NÃO tem tela
--   2. integration_configs.signature_*    da empresa   ← a única editável
--   3. email_signatures.html              por usuário  ← órfã, sem tela
--
-- Resultado: a única assinatura que dá para editar é a da empresa inteira, e a
-- aba que a edita é só para admin. Num CRM onde cada pessoa tem o próprio Gmail,
-- o e-mail da Ana sai assinado com o nome de quem o admin cadastrou.
--
-- A camada 1 já existe e já vence — falta só onde guardar os CAMPOS. Sem eles,
-- o editor consegue gerar o HTML mas não consegue reabrir com o que a pessoa
-- preencheu, porque ler os valores de volta do HTML seria adivinhação.
ALTER TABLE public.email_connections
  ADD COLUMN IF NOT EXISTS signature_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.email_connections.signature_fields IS
  'Campos da assinatura desta pessoa (nome, cargo, empresa, telefone, email, site, logoUrl, extra). O HTML renderizado fica em signature_html; estes campos existem para o editor reabrir preenchido.';

COMMENT ON COLUMN public.email_connections.signature_html IS
  'HTML já montado a partir de signature_fields. Tem prioridade sobre a assinatura da organização no gmail-send. Gerado por src/lib/email-signature.ts — não editar à mão.';
