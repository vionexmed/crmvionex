-- Desfaz `contacts.especialidade`: era duplicata de `title`
--
-- A coluna foi criada hoje, na migração de potencial (20260927130000), e o
-- backfill dela copiou justamente de `title` -- o que já mostrava que as duas
-- guardavam a mesma coisa.
--
-- `title` é nominalmente o campo genérico de cargo, mas este CRM o usa como
-- especialidade desde sempre: é alimentado pela lista AREAS_ATUACAO, e a tela
-- de Contatos exibe e ordena por ele numa coluna chamada "Especialidade".
--
-- Manter as duas deixava a ficha com "Área de atuação" e "Especialidade" lado
-- a lado, preenchidas pela mesma lista, enquanto a coluna "Especialidade" da
-- listagem mostrava a OUTRA. Um vendedor editaria um campo e não o veria
-- mudar onde esperava.
--
-- Some a coluna nova, não a antiga: `title` já é exibido, ordenável,
-- importado por CSV e lido por relatório. Nada em produção chegou a gravar
-- `especialidade` -- ela nasceu e morreu no mesmo dia.

DROP INDEX IF EXISTS public.idx_contacts_especialidade;

ALTER TABLE public.contacts
  DROP COLUMN IF EXISTS especialidade;
