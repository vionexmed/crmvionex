-- ============================================================================
-- Gmail: histórico completo + sincronização incremental
-- ============================================================================
--
-- O sync atual importa só a INBOX, sem paginação, com direction fixo em
-- 'inbound' e sem History API. Ou seja: perde os enviados, para nos primeiros
-- 100, marca e-mail que a pessoa mandou como recebido, e a cada execução
-- refaz busca por data em vez de perguntar ao Gmail o que mudou.
--
-- Esta migração prepara o banco para o modelo backfill → historyId → incremental.
--
-- A REGRA que o schema tem de sustentar: o gmail_history_id só vira checkpoint
-- DEPOIS que o backfill terminou. Enquanto o histórico está sendo baixado, o
-- checkpoint é backfill_page_token. Misturar os dois perde mensagem: um
-- historyId gravado no meio do backfill faz o incremental achar que já tem tudo
-- para trás.

-- ---------- 1. Labels do Gmail na mensagem ----------
-- Guardar os labelIds crus é o que permite reconstruir Inbox, Enviados,
-- Favoritos, Lixeira e Spam sem inventar uma taxonomia paralela. As colunas
-- booleanas (is_read, is_starred, ...) continuam existindo porque a interface e
-- os filtros já as usam — passam a ser derivadas destes labels.
ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS gmail_labels jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.emails.gmail_labels IS
  'labelIds crus do Gmail (INBOX, SENT, UNREAD, IMPORTANT, ...). Fonte de verdade; as colunas booleanas são derivadas daqui.';

-- ---------- 2. Deduplicação no banco, não só no código ----------
-- Checar antes de inserir não basta: duas execuções concorrentes checam, as duas
-- não encontram, as duas inserem. Com índice único o upsert vira idempotente de
-- verdade — é isso que faz retry, retomada de backfill e reconexão não
-- duplicarem.
--
-- message_id nulo é permitido e não conflita (NULL não colide em índice único no
-- Postgres): e-mail que o CRM acabou de enviar existe antes de a Meta... antes
-- de o Gmail devolver o id.
DO $$
DECLARE
  v_dupes int;
BEGIN
  SELECT count(*) INTO v_dupes
  FROM public.emails e
  WHERE e.message_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.emails outra
      WHERE outra.org_id = e.org_id
        AND outra.message_id = e.message_id
        AND outra.id < e.id
    );

  IF v_dupes > 0 THEN
    RAISE NOTICE 'Removendo % linha(s) duplicada(s) de emails antes de criar o índice único.', v_dupes;

    -- Mantém a linha de menor id em cada grupo. Ordenação por id e não por
    -- created_at porque created_at é anulável, e comparação com NULL daria falso.
    DELETE FROM public.emails e
    WHERE e.message_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.emails outra
        WHERE outra.org_id = e.org_id
          AND outra.message_id = e.message_id
          AND outra.id < e.id
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS emails_org_message_key
  ON public.emails (org_id, message_id) WHERE message_id IS NOT NULL;

-- Consulta por thread é o que monta a conversa na tela.
CREATE INDEX IF NOT EXISTS idx_emails_thread
  ON public.emails (org_id, thread_id) WHERE thread_id IS NOT NULL;

-- ---------- 3. Estado da sincronização na conexão ----------
ALTER TABLE public.email_connections
  ADD COLUMN IF NOT EXISTS gmail_history_id text,
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS backfill_page_token text,
  -- Contador só do backfill em andamento, para a tela dizer "1.542 processados"
  -- em vez de uma barra que não anda.
  ADD COLUMN IF NOT EXISTS backfill_count int NOT NULL DEFAULT 0,
  -- Quando o lote atual começou. Serve para destravar sync que morreu no meio:
  -- sem isto, um timeout deixaria sync_status travado em 'backfill' para sempre
  -- e a conta nunca voltaria a sincronizar.
  ADD COLUMN IF NOT EXISTS sync_started_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_connections_sync_status_check'
  ) THEN
    ALTER TABLE public.email_connections
      ADD CONSTRAINT email_connections_sync_status_check
      CHECK (sync_status IN ('idle', 'backfill', 'incremental', 'error'));
  END IF;
END $$;

COMMENT ON COLUMN public.email_connections.gmail_history_id IS
  'Checkpoint da sincronização incremental. NULO enquanto o backfill não terminou — gravar antes disso perde mensagem.';
COMMENT ON COLUMN public.email_connections.backfill_page_token IS
  'Checkpoint do backfill (nextPageToken do messages.list). Separado do gmail_history_id de propósito.';
COMMENT ON COLUMN public.email_connections.sync_status IS
  'idle | backfill | incremental | error. Também é o cadeado contra sync concorrente da mesma conta.';
COMMENT ON COLUMN public.email_connections.sync_started_at IS
  'Início do lote atual. Sync mais antigo que a janela de expiração é considerado morto e pode ser retomado.';

-- ---------- 4. Registro de cada sincronização ----------
CREATE TABLE IF NOT EXISTS public.gmail_sync_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id   uuid REFERENCES public.email_connections(id) ON DELETE SET NULL,
  email_address   text,
  sync_type       text NOT NULL CHECK (sync_type IN ('backfill', 'incremental')),
  status          text NOT NULL CHECK (status IN ('running', 'completed', 'error')),
  messages_synced int NOT NULL DEFAULT 0,
  pages_fetched   int NOT NULL DEFAULT 0,
  error_message   text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  duration_ms     int
);

CREATE INDEX IF NOT EXISTS idx_gmail_sync_log_org
  ON public.gmail_sync_log (org_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_gmail_sync_log_connection
  ON public.gmail_sync_log (connection_id, started_at DESC);

ALTER TABLE public.gmail_sync_log ENABLE ROW LEVEL SECURITY;

-- Leitura no mesmo idioma de email_connections: admin vê tudo, cada um vê o log
-- da própria conta. Sem policy de escrita — só service_role grava, porque quem
-- grava é a edge function.
CREATE POLICY "gmail_sync_log_select" ON public.gmail_sync_log FOR SELECT
  USING (
    public.user_belongs_to_org(auth.uid(), org_id)
    AND (
      public.is_org_admin(auth.uid(), org_id)
      OR EXISTS (
        SELECT 1 FROM public.email_connections ec
        WHERE ec.id = gmail_sync_log.connection_id
          AND ec.user_id = auth.uid()
      )
    )
  );

COMMENT ON TABLE public.gmail_sync_log IS
  'Uma linha por execução de sincronização do Gmail. Sem policy de escrita: só service_role grava.';

-- ---------- 5. Destravar sync morto ----------
-- Uma execução que estourou o tempo da edge function deixa sync_status preso.
-- Esta função libera o que passou da janela, e é chamada no começo de cada sync.
-- Preferido a um cron separado: o destravamento acontece exatamente quando
-- alguém precisa da conexão.
CREATE OR REPLACE FUNCTION public.gmail_liberar_sync_travado(_minutos int DEFAULT 15)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qtd int;
BEGIN
  WITH liberadas AS (
    UPDATE public.email_connections
    SET sync_status = 'idle', sync_started_at = NULL
    WHERE sync_status IN ('backfill', 'incremental')
      AND sync_started_at IS NOT NULL
      AND sync_started_at < now() - make_interval(mins => _minutos)
    RETURNING 1
  )
  SELECT count(*) INTO v_qtd FROM liberadas;

  -- O backfill_page_token é PRESERVADO: liberar o cadeado não é recomeçar o
  -- histórico. A próxima execução continua da página onde parou.
  RETURN v_qtd;
END;
$$;

REVOKE ALL     ON FUNCTION public.gmail_liberar_sync_travado(int) FROM public;
GRANT EXECUTE  ON FUNCTION public.gmail_liberar_sync_travado(int) TO service_role;

COMMENT ON FUNCTION public.gmail_liberar_sync_travado(int) IS
  'Solta conexões com sync travado além da janela. Preserva backfill_page_token — libera o cadeado, não recomeça o histórico.';

-- ---------- 6. Tomar o cadeado, de forma atômica ----------
-- Duas execuções simultâneas (a pessoa clicando e o cron) não podem sincronizar
-- a mesma conta: dobraria chamada de API e embaralharia checkpoint. O UPDATE
-- condicional resolve no banco — quem perde recebe false e desiste.
CREATE OR REPLACE FUNCTION public.gmail_tomar_sync(_connection_id uuid, _tipo text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  IF _tipo NOT IN ('backfill', 'incremental') THEN
    RAISE EXCEPTION 'Tipo de sync inválido: %', _tipo;
  END IF;

  UPDATE public.email_connections
  SET sync_status = _tipo,
      sync_started_at = now()
  WHERE id = _connection_id
    AND is_active
    -- 'error' entra porque conta que falhou tem de poder tentar de novo.
    AND sync_status IN ('idle', 'error')
  RETURNING true INTO v_ok;

  RETURN coalesce(v_ok, false);
END;
$$;

REVOKE ALL     ON FUNCTION public.gmail_tomar_sync(uuid, text) FROM public;
GRANT EXECUTE  ON FUNCTION public.gmail_tomar_sync(uuid, text) TO service_role;

COMMENT ON FUNCTION public.gmail_tomar_sync(uuid, text) IS
  'Cadeado de sincronização por conexão. Devolve false quando já há sync em andamento.';
