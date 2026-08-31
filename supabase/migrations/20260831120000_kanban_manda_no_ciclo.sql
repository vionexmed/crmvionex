-- ============================================================================
-- O kanban manda no ciclo de vida
-- ============================================================================
--
-- PROBLEMA
--
-- O ciclo de vida avançava assim:
--
--   lead                    no cadastro
--   lead -> contatado       AUTOMÁTICO, na primeira ligação/e-mail/WhatsApp
--                           registrado (três gatilhos, 20260826160000)
--   contatado -> oportunidade   SÓ pelo botão "Aprovar" da tela de Leads
--
-- A tela de Leads era uma fila de triagem: cada lead precisava ser aprovado à
-- mão, um por um. O usuário pediu para removê-la -- triar lead por lead não
-- escala -- e que o lead novo caia direto no kanban.
--
-- Só que apagar a tela sem mais nada quebraria o funil: NINGUÉM passaria de
-- "contatado", porque `qualify_lead` era chamada de um lugar só. O gráfico de
-- ciclo de vida achataria e "Oportunidades geradas" pararia de crescer.
--
-- A SAÍDA, E A COINCIDÊNCIA QUE A JUSTIFICA
--
-- O painel JÁ define oportunidade como "negócio que SAIU da etapa de entrada"
-- (20260826170000, e é o que `sdr_metrics` conta). O ciclo de vida definia a
-- mesma coisa por outro caminho -- aprovação manual -- e os dois podiam
-- discordar: um contato "contatado" com negócio na terceira coluna era possível,
-- e nenhuma tela mostrava a contradição.
--
-- Agora a etapa do negócio é a fonte. Arrastar o card para a segunda coluna É a
-- qualificação. As duas noções passam a ser a mesma.
--
-- O QUE ESTE GATILHO FAZ, E O QUE NÃO FAZ
--
--   saiu da etapa de entrada -> oportunidade
--   status 'won'             -> cliente
--   status 'lost'            -> NADA, e é decisão declarada do usuário
--
-- Negócio perdido quase sempre significa "não agora" -- preço, timing,
-- orçamento -- e não "essa pessoa não serve". Descartar o contato faria
-- reengajar exigir voltar o estágio à mão, e os gatilhos deste projeto nunca
-- regridem de propósito. Descartar segue possível na ficha do contato.
--
-- NUNCA REGRIDE
--
-- Voltar o card para a primeira coluna não rebaixa o contato, e cliente não
-- volta a ser oportunidade. Mesma regra de `promover_lead_para_contatado`: o
-- ciclo de vida é histórico do relacionamento, não espelho da coluna atual. Sem
-- isso, arrastar um card para trás para reorganizar o quadro apagaria a
-- qualificação -- e o histórico em `contact_lifecycle_events` registraria uma
-- regressão que ninguém decidiu.
--
-- O histórico entra de graça: `registrar_transicao_de_ciclo` já é
-- AFTER UPDATE OF lifecycle_stage em `contacts`.
-- ============================================================================

-- ---------- 1. Ordem de um estágio, para comparar sem citar nome ----------
--
-- Os seis valores do enum não têm ordem numérica, e comparar por texto daria
-- ordem alfabética -- 'customer' < 'lead' -- que não é nada.

CREATE OR REPLACE FUNCTION public.ordem_do_ciclo(_estagio public.lifecycle_stage)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _estagio
    WHEN 'lead'         THEN 1
    WHEN 'contacted'    THEN 2
    WHEN 'qualified'    THEN 3
    WHEN 'opportunity'  THEN 4
    WHEN 'customer'     THEN 5
    -- Descartado fica FORA da escala, com 0: ele não é "antes de lead", é outro
    -- ramo. Dar-lhe 6 faria descartado parecer o topo do funil; dar-lhe 1 faria
    -- um descarte ser desfeito pelo primeiro avanço de card.
    WHEN 'disqualified' THEN 0
  END;
$$;

COMMENT ON FUNCTION public.ordem_do_ciclo(public.lifecycle_stage) IS
  'Posição do estágio no funil, para comparar avanço. Descartado é 0 porque não pertence à escala.';

-- ---------- 2. Avançar sem nunca regredir ----------

CREATE OR REPLACE FUNCTION public.avancar_ciclo_do_contato(
  _contact_id uuid,
  _para       public.lifecycle_stage
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _contact_id IS NULL THEN RETURN; END IF;

  UPDATE contacts c
     SET lifecycle_stage = _para,
         qualified_at = CASE
           WHEN _para IN ('qualified', 'opportunity') THEN coalesce(c.qualified_at, now())
           ELSE c.qualified_at
         END,
         qualified_by = CASE
           WHEN _para IN ('qualified', 'opportunity') THEN coalesce(c.qualified_by, auth.uid())
           ELSE c.qualified_by
         END
   WHERE c.id = _contact_id
     -- Só avança. E descartado não é tocado: quem descartou decidiu, e um card
     -- arrastado não desfaz decisão de pessoa.
     AND c.lifecycle_stage <> 'disqualified'
     AND public.ordem_do_ciclo(_para) > public.ordem_do_ciclo(c.lifecycle_stage);
END;
$$;

COMMENT ON FUNCTION public.avancar_ciclo_do_contato(uuid, public.lifecycle_stage) IS
  'Avança o ciclo de vida do contato, nunca regride, e não toca em quem foi descartado. Idempotente.';

REVOKE ALL ON FUNCTION public.avancar_ciclo_do_contato(uuid, public.lifecycle_stage) FROM public;

-- ---------- 3. O gatilho no negócio ----------

CREATE OR REPLACE FUNCTION public.tg_negocio_move_ciclo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entrada uuid;
BEGIN
  -- Negócio sem contato não tem ciclo de vida para mover. Acontece: negócio
  -- criado à mão, fora do fluxo de cadastro.
  IF NEW.contact_id IS NULL THEN RETURN NEW; END IF;

  -- Ganho vence etapa: um funil pode ter a coluna de ganho no meio, e o que
  -- importa é o status.
  IF NEW.status = 'won' THEN
    PERFORM public.avancar_ciclo_do_contato(NEW.contact_id, 'customer');
    RETURN NEW;
  END IF;

  -- 'lost' não faz nada. Ver o cabeçalho: é decisão declarada.
  IF NEW.status = 'lost' THEN RETURN NEW; END IF;

  IF NEW.stage_id IS NULL THEN RETURN NEW; END IF;

  SELECT public.etapa_de_entrada(s.pipeline_id) INTO v_entrada
  FROM pipeline_stages s WHERE s.id = NEW.stage_id;

  -- Saiu da etapa de entrada = foi qualificado. É a MESMA definição que
  -- `sdr_metrics` usa para "Oportunidades geradas" -- se as duas divergirem, o
  -- card do painel e o gráfico de ciclo de vida voltam a se contradizer.
  IF v_entrada IS NOT NULL AND NEW.stage_id <> v_entrada THEN
    PERFORM public.avancar_ciclo_do_contato(NEW.contact_id, 'opportunity');
  END IF;

  RETURN NEW;
END;
$$;

-- AFTER, e nas três colunas que importam.
--
-- `contact_id` na lista porque vincular um contato a um negócio que já está
-- avançado precisa promover esse contato -- senão o vínculo feito depois deixa
-- o ciclo de vida atrasado para sempre.
DROP TRIGGER IF EXISTS negocio_move_ciclo ON public.deals;
CREATE TRIGGER negocio_move_ciclo
  AFTER INSERT OR UPDATE OF stage_id, status, contact_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.tg_negocio_move_ciclo();

-- ---------- 4. Quem já avançou e ficou para trás ----------
--
-- Sem isto, a base atual continuaria mostrando "contatado" para gente com
-- negócio na terceira coluna -- e a mudança pareceria não ter funcionado.
-- Só avança; ninguém é rebaixado.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT d.contact_id, d.status, d.stage_id, s.pipeline_id
      FROM public.deals d
      JOIN public.pipeline_stages s ON s.id = d.stage_id
     WHERE d.contact_id IS NOT NULL
  LOOP
    IF r.status = 'won' THEN
      PERFORM public.avancar_ciclo_do_contato(r.contact_id, 'customer');
    ELSIF r.status <> 'lost'
      AND r.stage_id <> public.etapa_de_entrada(r.pipeline_id) THEN
      PERFORM public.avancar_ciclo_do_contato(r.contact_id, 'opportunity');
    END IF;
  END LOOP;
END $$;
