-- ============================================================================
-- Histórico de ciclo de vida: o funil para de mudar depois de fechado
-- ============================================================================
--
-- PROBLEMA
--
-- `sdr_funnel` janela por `contacts.created_at` -- quando o contato entrou --
-- mas lê `contacts.lifecycle_stage`, que é o estágio ATUAL.
--
-- O efeito: um contato criado em julho, contatado em julho e que virou cliente
-- em setembro conta como CLIENTE no funil de julho. O funil de um mês fechado
-- muda toda vez que alguém avança, e quem compara o relatório de julho tirado
-- em agosto com o mesmo relatório tirado em outubro vê números diferentes sem
-- que nada tenha acontecido em julho.
--
-- A tabela guarda só o estágio ATUAL. `lifecycle_changed_at` diz quando mudou
-- pela última vez, não o caminho. Não dá para responder "onde este contato
-- estava em 31 de julho" sem histórico.
--
-- SOLUÇÃO
--
-- Uma linha por transição. Com ela, `sdr_funnel` passa a perguntar "até onde
-- este contato tinha chegado ATÉ o fim da janela" em vez de "onde ele está
-- agora" -- e o funil de julho fica congelado em julho.
--
-- Continua sendo funil de COORTE: "dos contatos que entraram em julho, até onde
-- foram". O que muda é o instante da foto. Cada etapa segue sendo subconjunto
-- da anterior, então o funil continua decrescendo, que é o que faz um funil ser
-- legível.
-- ============================================================================

-- ---------- 1. A tabela ----------

CREATE TABLE IF NOT EXISTS public.contact_lifecycle_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- ON DELETE CASCADE: apagar o contato apaga o histórico dele. O histórico não
  -- tem valor sem o contato, e uma FK sem ON DELETE bloquearia a exclusão --
  -- que é exatamente o problema que quatro outras chaves já causam aqui.
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  stage      public.lifecycle_stage NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid
);

COMMENT ON TABLE public.contact_lifecycle_events IS
  'Uma linha por transição de lifecycle_stage. Existe para que o funil de um mês fechado não mude depois de fechado.';

-- Índice para a pergunta que o funil faz: dado um contato e um instante, qual
-- o estágio mais avançado alcançado até lá.
CREATE INDEX IF NOT EXISTS idx_cle_contato_data
  ON public.contact_lifecycle_events (contact_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_cle_org_data
  ON public.contact_lifecycle_events (org_id, changed_at);

-- ---------- 2. RLS ----------

ALTER TABLE public.contact_lifecycle_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Membros da org leem o histórico" ON public.contact_lifecycle_events;
CREATE POLICY "Membros da org leem o histórico"
  ON public.contact_lifecycle_events FOR SELECT
  USING (public.user_belongs_to_org(auth.uid(), org_id));

-- Sem policy de INSERT, UPDATE ou DELETE de propósito: quem escreve é o
-- gatilho, que roda como SECURITY DEFINER. Histórico que a aplicação pode
-- reescrever não é histórico.

-- ---------- 3. O gatilho ----------

CREATE OR REPLACE FUNCTION public.registrar_transicao_de_ciclo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- INSERT: a entrada é uma transição também. Sem ela, um contato criado já
  -- como 'customer' (importação) não teria linha nenhuma.
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.contact_lifecycle_events (org_id, contact_id, stage, changed_at, changed_by)
    VALUES (NEW.org_id, NEW.id, NEW.lifecycle_stage, COALESCE(NEW.created_at, now()), auth.uid());
    RETURN NEW;
  END IF;

  IF NEW.lifecycle_stage IS DISTINCT FROM OLD.lifecycle_stage THEN
    INSERT INTO public.contact_lifecycle_events (org_id, contact_id, stage, changed_at, changed_by)
    VALUES (NEW.org_id, NEW.id, NEW.lifecycle_stage, now(), auth.uid());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS registrar_transicao_de_ciclo ON public.contacts;
CREATE TRIGGER registrar_transicao_de_ciclo
  -- AFTER, não BEFORE: o gatilho `sync_contact_lifecycle` é BEFORE e ainda pode
  -- REESCREVER `lifecycle_stage` (no INSERT o `status` vence). Gravar o
  -- histórico antes dele registraria um estágio que nunca existiu.
  AFTER INSERT OR UPDATE OF lifecycle_stage ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.registrar_transicao_de_ciclo();

-- ---------- 4. Backfill ----------
--
-- O que existe hoje é parcial e é o melhor possível: a tabela guardou só o
-- estágio atual e três marcas de tempo. Reconstrói-se:
--
--   'lead' em created_at        toda pessoa entrou como lead
--   qualified_at                quando foi qualificada, se foi
--   disqualified_at             quando foi descartada, se foi
--   lifecycle_changed_at        a ÚLTIMA mudança, com o estágio atual
--
-- O caminho intermediário que não deixou marca não volta. Está declarado aqui
-- para que ninguém leia o histórico anterior a esta migração como completo.

INSERT INTO public.contact_lifecycle_events (org_id, contact_id, stage, changed_at)
SELECT c.org_id, c.id, 'lead'::public.lifecycle_stage, c.created_at
FROM public.contacts c
WHERE c.created_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.contact_lifecycle_events e WHERE e.contact_id = c.id
  );

INSERT INTO public.contact_lifecycle_events (org_id, contact_id, stage, changed_at, changed_by)
SELECT c.org_id, c.id, 'qualified'::public.lifecycle_stage, c.qualified_at, c.qualified_by
FROM public.contacts c
WHERE c.qualified_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.contact_lifecycle_events e
    WHERE e.contact_id = c.id AND e.stage = 'qualified'
  );

INSERT INTO public.contact_lifecycle_events (org_id, contact_id, stage, changed_at)
SELECT c.org_id, c.id, 'disqualified'::public.lifecycle_stage, c.disqualified_at
FROM public.contacts c
WHERE c.disqualified_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.contact_lifecycle_events e
    WHERE e.contact_id = c.id AND e.stage = 'disqualified'
  );

-- O estágio atual, na data da última mudança. Só quando ainda não há linha
-- para ele -- os três acima já cobrem lead, qualified e disqualified.
INSERT INTO public.contact_lifecycle_events (org_id, contact_id, stage, changed_at)
SELECT c.org_id, c.id, c.lifecycle_stage, COALESCE(c.lifecycle_changed_at, c.created_at, now())
FROM public.contacts c
WHERE c.lifecycle_stage IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.contact_lifecycle_events e
    WHERE e.contact_id = c.id AND e.stage = c.lifecycle_stage
  );

-- ---------- 5. Onde cada contato estava num instante ----------

CREATE OR REPLACE FUNCTION public.estagio_do_contato_em(
  _contact_id uuid,
  _quando     timestamptz
)
RETURNS public.lifecycle_stage
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- O MAIS AVANÇADO alcançado até `_quando`, não o último cronológico: o ciclo
  -- de vida pode retroceder (um cliente que vira descartado), e o funil conta
  -- quem CHEGOU a cada etapa, não quem está nela agora.
  SELECT e.stage
  FROM public.contact_lifecycle_events e
  WHERE e.contact_id = _contact_id
    AND e.changed_at <= _quando
  ORDER BY
    CASE e.stage
      WHEN 'lead' THEN 1
      WHEN 'contacted' THEN 2
      WHEN 'qualified' THEN 3
      WHEN 'opportunity' THEN 4
      WHEN 'customer' THEN 5
      WHEN 'disqualified' THEN 0
    END DESC,
    e.changed_at DESC
  LIMIT 1;
$$;

-- ---------- 6. O funil, congelado no fim da janela ----------

CREATE OR REPLACE FUNCTION public.sdr_funnel(
  _org_id uuid,
  _from   timestamptz DEFAULT NULL,
  _to     timestamptz DEFAULT NULL
)
RETURNS TABLE (etapa text, ordem int, total int)
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
  WITH base AS (
    SELECT
      -- O estágio ALCANÇADO até o fim da janela, não o atual. É isso que faz o
      -- funil de julho continuar sendo o funil de julho em outubro.
      --
      -- Sem `_to`, a janela é aberta e a foto é agora -- que é o mesmo
      -- comportamento de antes, e o certo para "todo o período".
      CASE
        WHEN _to IS NULL THEN c.lifecycle_stage
        ELSE public.estagio_do_contato_em(c.id, _to)
      END AS s
    FROM public.contacts c
    WHERE c.org_id = _org_id
      AND (_from IS NULL OR c.created_at >= _from)
      AND (_to   IS NULL OR c.created_at <  _to)
  ),
  vivos AS (
    -- Descartado não é etapa do funil: é saída. Filtrado DEPOIS de resolver o
    -- estágio na data, porque quem foi descartado em setembro ainda contava no
    -- funil de julho.
    SELECT s FROM base WHERE s IS DISTINCT FROM 'disqualified'
  )
  SELECT 'Recebidos'::text, 1, count(*)::int FROM vivos
  UNION ALL
  SELECT 'Contatados', 2, count(*)::int FROM vivos
    WHERE s IN ('contacted', 'qualified', 'opportunity', 'customer')
  UNION ALL
  -- "Qualificados" e "Em negociação" davam SEMPRE o mesmo número, porque
  -- qualify_lead grava 'opportunity' e pula 'qualified'.
  SELECT 'Em negociação', 3, count(*)::int FROM vivos
    WHERE s IN ('qualified', 'opportunity', 'customer')
  UNION ALL
  SELECT 'Clientes', 4, count(*)::int FROM vivos
    WHERE s = 'customer'
  ORDER BY 2;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sdr_funnel(uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estagio_do_contato_em(uuid, timestamptz)   TO authenticated;

-- A função do gatilho não é chamada por ninguém de fora.
REVOKE ALL ON FUNCTION public.registrar_transicao_de_ciclo() FROM public, authenticated, anon;
