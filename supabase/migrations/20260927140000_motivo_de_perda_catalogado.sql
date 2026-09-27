-- Motivo de perda: categoria vira FK, para que "por que perdemos" agregue
--
-- Hoje `deals.loss_reason` é texto livre e recebe motivo e observação
-- concatenados: `"Preço: cliente achou caro"`. O relatório agrupa pela string
-- inteira, então cada observação digitada cria um balde novo -- "Preço: achou
-- caro" e "Preço: acima do orçamento" contam como dois motivos diferentes, e a
-- pergunta mais importante do funil ("o que mais nos faz perder?") não tem
-- resposta confiável.
--
-- Pior: a tabela `loss_reasons` existe desde 20260316002308 e tem tela de
-- gestão em Configurações > Funil, mas NINGUÉM a lê. Os dois modais de perda
-- (Negócios e a ficha do negócio) usam uma lista escrita no código. Quem
-- cadastra um motivo próprio não o vê aparecer em lugar nenhum.
--
-- Aqui a categoria passa a ser FK para esse catálogo. `loss_reason` continua
-- existindo e NÃO é reescrito: o texto histórico é registro do que foi
-- digitado na época, e reescrevê-lo perderia informação para ganhar estética.
-- Daqui para frente ele guarda só a observação.

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS loss_reason_id uuid
    REFERENCES public.loss_reasons(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.deals.loss_reason_id IS
  'Categoria da perda, do catálogo loss_reasons. É por aqui que o relatório agrupa. `loss_reason` guarda a observação livre.';

-- O relatório agrupa por esta coluna dentro de uma organização.
CREATE INDEX IF NOT EXISTS idx_deals_loss_reason
  ON public.deals (org_id, loss_reason_id)
  WHERE loss_reason_id IS NOT NULL;

-- ── Semear o catálogo ──────────────────────────────────────────────────────
-- Os sete motivos que estavam escritos no código viram linhas reais, em cada
-- organização que ainda não os tenha. Sem isto, trocar o modal para ler o
-- catálogo deixaria a lista VAZIA para quem nunca cadastrou motivo -- ou seja,
-- todo mundo, já que a tela nunca serviu para nada.
INSERT INTO public.loss_reasons (org_id, label)
SELECT o.id, m.label
FROM public.organizations o
CROSS JOIN (VALUES
  ('Preço muito alto'),
  ('Perdeu para concorrência'),
  ('Timing inadequado'),
  ('Sem orçamento'),
  ('Produto não atende'),
  ('Sem resposta do cliente'),
  ('Outro')
) AS m(label)
WHERE NOT EXISTS (
  SELECT 1 FROM public.loss_reasons lr
  WHERE lr.org_id = o.id AND lower(btrim(lr.label)) = lower(m.label)
);

-- ── Backfill das perdas já registradas ─────────────────────────────────────
-- O texto antigo começa pelo rótulo curto que o modal gravava ("Preço",
-- "Concorrência", ...), às vezes seguido de ": observação". Mapeia esse
-- prefixo para a linha do catálogo correspondente.
WITH mapa AS (
  SELECT * FROM (VALUES
    ('preço',        'Preço muito alto'),
    ('preco',        'Preço muito alto'),
    ('concorrência', 'Perdeu para concorrência'),
    ('concorrencia', 'Perdeu para concorrência'),
    ('timing',       'Timing inadequado'),
    ('budget',       'Sem orçamento'),
    ('fit',          'Produto não atende'),
    ('sem resposta', 'Sem resposta do cliente'),
    ('outro',        'Outro')
  ) AS t(prefixo, label)
)
UPDATE public.deals d
SET loss_reason_id = lr.id
FROM mapa, public.loss_reasons lr
WHERE d.loss_reason_id IS NULL
  AND d.loss_reason IS NOT NULL
  AND lr.org_id = d.org_id
  AND lower(btrim(lr.label)) = lower(mapa.label)
  AND lower(btrim(split_part(d.loss_reason, ':', 1))) = mapa.prefixo;
