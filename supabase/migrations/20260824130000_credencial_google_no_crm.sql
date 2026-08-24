-- ============================================================================
-- Credencial OAuth do Google: cadastrada pelo CRM, invisível para o navegador
-- ============================================================================
--
-- HOJE a credencial pode vir de dois lugares, e o pior deles é justamente o que
-- a interface oferece:
--
--   integration_configs  → o navegador LÊ (RLS libera SELECT para admin)
--   secrets do ambiente  → o navegador não lê
--
-- O formulário de Integrações grava no primeiro. Ou seja: para cadastrar pela
-- tela, hoje é preciso aceitar que o segredo volte numa resposta HTTP para a aba
-- do admin. E para o segredo ficar protegido, é preciso abrir o painel do
-- Supabase — o que tira a praticidade.
--
-- A saída não é escolher entre os dois: é gravar no banco num compartimento que
-- o front não alcança. RLS ligada e ZERO policies — nem admin lê pela API, só
-- service_role. Mesmo padrão de gmail_oauth_tokens e whatsapp_secrets.
--
-- Assim dá para ser prático E seguro: cola no CRM, e o valor nunca volta.

-- ---------- 1. A credencial, em compartimento fechado ----------
CREATE TABLE IF NOT EXISTS public.google_oauth_secrets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- client_id é público e poderia ficar em tabela legível. Mora aqui junto do
  -- segredo porque separar exigiria duas escritas para manter o par coerente —
  -- e credencial meio-atualizada é pior que credencial escondida. A interface
  -- recebe o client_id por edge function, que devolve só o que é seguro.
  client_id     text NOT NULL,
  client_secret text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid
);

ALTER TABLE public.google_oauth_secrets ENABLE ROW LEVEL SECURITY;
-- Propositalmente SEM CREATE POLICY. Se um dia aparecer uma policy aqui, o
-- segredo da empresa passa a ser alcançável pelo navegador — o oposto do motivo
-- desta tabela existir.

COMMENT ON TABLE public.google_oauth_secrets IS
  'Credencial OAuth do Google por organização. RLS ligada SEM policy: só service_role lê. Não criar policy aqui.';

-- ---------- 2. Por que uma conexão parou de funcionar ----------
-- Requisito explícito: quando a conexão fica inválida ou é desconectada, a
-- pessoa precisa ver o QUE aconteceu. Hoje não existe onde guardar isso, então
-- conexão morta aparece na tela como conectada e o e-mail simplesmente não sai.
--
-- Guarda CÓDIGO, não frase: texto em português dentro de migração fica congelado
-- e não dá para traduzir nem reescrever sem outra migração. A interface traduz.
ALTER TABLE public.email_connections
  ADD COLUMN IF NOT EXISTS invalid_since  timestamptz,
  ADD COLUMN IF NOT EXISTS invalid_reason text;

COMMENT ON COLUMN public.email_connections.invalid_reason IS
  'Código do motivo: credenciais_trocadas | token_revogado | refresh_invalido. A interface traduz — não guardar frase aqui.';
COMMENT ON COLUMN public.email_connections.invalid_since IS
  'Quando a conexão passou a falhar. Nulo = saudável. Limpo ao reconectar com sucesso.';

CREATE INDEX IF NOT EXISTS idx_email_connections_invalidas
  ON public.email_connections (org_id) WHERE invalid_since IS NOT NULL;

-- ---------- 3. Tirar a credencial da tabela que o front lê ----------
-- A LINHA NÃO É APAGADA. Ela é uma sacola compartilhada: carrega `mode`,
-- `email`, `from_name` e oito chaves de assinatura, todas lidas pelo gmail-send
-- para montar o rodapé dos e-mails enviados. Apagar a linha apagaria a
-- assinatura da empresa.
--
-- Só as duas chaves de credencial saem. O operador `-` em jsonb remove chave
-- preservando todo o resto.
DO $$
DECLARE
  v_linhas int;
BEGIN
  SELECT count(*) INTO v_linhas
  FROM public.integration_configs
  WHERE provider = 'gmail'
    AND (config ? 'client_id' OR config ? 'client_secret');

  IF v_linhas > 0 THEN
    RAISE NOTICE 'Removendo credencial de % linha(s) de integration_configs. Assinatura e demais chaves preservadas.', v_linhas;

    UPDATE public.integration_configs
    SET config = config - 'client_id' - 'client_secret'
    WHERE provider = 'gmail'
      AND (config ? 'client_id' OR config ? 'client_secret');
  ELSE
    RAISE NOTICE 'Nenhuma credencial em integration_configs. Nada a limpar.';
  END IF;
END $$;

-- ---------- 4. Marcar conexões afetadas por troca de credencial ----------
-- O Google exige que a renovação use as MESMAS credenciais que emitiram o token.
-- Trocar a credencial invalida todo refresh token já emitido — e hoje isso
-- quebra em silêncio horas ou dias depois, longe da causa.
--
-- Esta função é chamada pelo gmail-credentials-save no momento da troca, para o
-- motivo existir ANTES da primeira falha.
CREATE OR REPLACE FUNCTION public.gmail_invalidar_conexoes(_org_id uuid, _motivo text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qtd int;
BEGIN
  IF _motivo NOT IN ('credenciais_trocadas', 'token_revogado', 'refresh_invalido') THEN
    RAISE EXCEPTION 'Motivo desconhecido: %', _motivo;
  END IF;

  WITH marcadas AS (
    UPDATE public.email_connections
    SET invalid_since = now(), invalid_reason = _motivo
    WHERE org_id = _org_id
      AND is_active
      AND provider = 'gmail'
      -- Não sobrescreve motivo anterior: a primeira causa é a que explica.
      AND invalid_since IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_qtd FROM marcadas;

  RETURN v_qtd;
END;
$$;

REVOKE ALL     ON FUNCTION public.gmail_invalidar_conexoes(uuid, text) FROM public;
GRANT EXECUTE  ON FUNCTION public.gmail_invalidar_conexoes(uuid, text) TO service_role;

COMMENT ON FUNCTION public.gmail_invalidar_conexoes(uuid, text) IS
  'Marca as conexões Gmail da org como inválidas com um motivo. Chamada ao trocar credencial, para o motivo existir antes da primeira falha.';
