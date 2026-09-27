-- Camada de potencial: o que o lead vale além da venda do equipamento
--
-- O formulário de captação sempre perguntou especialidade, volume de
-- pacientes, se já usa ondas de choque e qual equipamento tem. Tudo isso caía
-- em `contacts.metadata` como texto e ficava só de enfeite na ficha: dá para
-- LER "30 – 60 pacientes/mês" num contato, mas não dá para LISTAR todo mundo
-- acima de 30, porque a faixa é uma string com travessão.
--
-- Aqui esses campos viram coluna. Duas consequências: dá para filtrar e somar,
-- e dá para registrar o que o formulário nunca perguntou -- potencial de
-- ALUGUEL e interesse em EDUCAÇÃO MÉDICA, que não existiam em lugar nenhum do
-- sistema e são as duas frentes da Estratégia 360.
--
-- `metadata` continua intacto: é a prova do que o lead respondeu, a coluna é
-- a leitura de trabalho.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS especialidade text,
  ADD COLUMN IF NOT EXISTS pacientes_mes_min integer,
  ADD COLUMN IF NOT EXISTS pacientes_mes_max integer,
  ADD COLUMN IF NOT EXISTS usa_ondas_choque boolean,
  ADD COLUMN IF NOT EXISTS equipamento_atual text,
  ADD COLUMN IF NOT EXISTS potencial_compra text,
  ADD COLUMN IF NOT EXISTS potencial_aluguel text,
  ADD COLUMN IF NOT EXISTS interesse_educacao text;

-- Texto + CHECK em vez de ENUM: acrescentar valor a um ENUM exige migração e
-- não pode rodar na mesma transação que o usa. Aqui a lista ainda vai mudar.
ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_potencial_compra_check,
  ADD CONSTRAINT contacts_potencial_compra_check
    CHECK (potencial_compra IS NULL OR potencial_compra IN ('alto', 'medio', 'baixo', 'nenhum'));

ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_potencial_aluguel_check,
  ADD CONSTRAINT contacts_potencial_aluguel_check
    CHECK (potencial_aluguel IS NULL OR potencial_aluguel IN ('alto', 'medio', 'baixo', 'nenhum'));

ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_interesse_educacao_check,
  ADD CONSTRAINT contacts_interesse_educacao_check
    CHECK (interesse_educacao IS NULL OR interesse_educacao IN
      ('nenhum', 'aluno', 'palestrante', 'sede_de_curso', 'pesquisa'));

COMMENT ON COLUMN public.contacts.pacientes_mes_min IS
  'Piso da faixa de pacientes/mês com indicação. Faixa virou dois inteiros para ser filtrável (">30") -- como texto, "30 – 60" não ordena nem soma.';
COMMENT ON COLUMN public.contacts.potencial_aluguel IS
  'Locação não existia no sistema: não havia coluna, tela nem modalidade no produto. Sem isto a frente de aluguel é invisível para todo relatório.';
COMMENT ON COLUMN public.contacts.interesse_educacao IS
  'Educação médica (curso, imersão, palestra, pesquisa): a outra frente da Estratégia 360, também ausente até aqui.';

-- Índices dos filtros que passam a existir. Parciais: só quem tem o dado
-- preenchido interessa a essas listas.
CREATE INDEX IF NOT EXISTS idx_contacts_especialidade
  ON public.contacts (org_id, especialidade)
  WHERE especialidade IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_pacientes_mes
  ON public.contacts (org_id, pacientes_mes_min)
  WHERE pacientes_mes_min IS NOT NULL;

-- ── Backfill do que o formulário já capturou ───────────────────────────────

-- Especialidade: o formulário gravava em `title` (o campo genérico de cargo).
-- Copiada, não movida -- `title` segue como está para não quebrar tela nenhuma.
UPDATE public.contacts
SET especialidade = NULLIF(btrim(title), '')
WHERE especialidade IS NULL
  AND NULLIF(btrim(title), '') IS NOT NULL;

-- Faixas do formulário: "Até 10", "10 – 30", "30 – 60", "Mais de 60".
-- O travessão é EN DASH (–), não hífen: veio do Google Forms.
UPDATE public.contacts
SET pacientes_mes_min = faixa.minimo,
    pacientes_mes_max = faixa.maximo
FROM (VALUES
  ('Até 10',      0,   10),
  ('Ate 10',      0,   10),
  ('10 – 30',    10,   30),
  ('10 - 30',    10,   30),
  ('30 – 60',    30,   60),
  ('30 - 60',    30,   60),
  ('Mais de 60', 60, NULL)
) AS faixa(rotulo, minimo, maximo)
WHERE public.contacts.pacientes_mes_min IS NULL
  AND btrim(public.contacts.metadata->>'pacientes_mes') = faixa.rotulo;

UPDATE public.contacts
SET usa_ondas_choque = CASE
      WHEN btrim(metadata->>'usa_ondas_choque') ILIKE 'sim%' THEN true
      WHEN btrim(metadata->>'usa_ondas_choque') ILIKE 'n%o%' THEN false
    END
WHERE usa_ondas_choque IS NULL
  AND NULLIF(btrim(metadata->>'usa_ondas_choque'), '') IS NOT NULL;

UPDATE public.contacts
SET equipamento_atual = NULLIF(btrim(metadata->>'equipamento_atual'), '')
WHERE equipamento_atual IS NULL
  AND NULLIF(btrim(metadata->>'equipamento_atual'), '') IS NOT NULL;

-- ── Produto: venda ou aluguel ──────────────────────────────────────────────
-- `produtos` tinha preço e unidade, mas nenhuma noção de modalidade, então o
-- orçamento não sabia dizer se aquilo era venda ou locação.
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS modalidade text NOT NULL DEFAULT 'venda';

ALTER TABLE public.produtos
  DROP CONSTRAINT IF EXISTS produtos_modalidade_check,
  ADD CONSTRAINT produtos_modalidade_check
    CHECK (modalidade IN ('venda', 'aluguel', 'comodato'));
