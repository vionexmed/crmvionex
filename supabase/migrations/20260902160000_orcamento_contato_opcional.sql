-- O contato do orçamento passa a ser OPCIONAL.
--
-- Ele nasceu `NOT NULL` por um bom motivo: era o vínculo que faz a decisão do
-- cliente aparecer na ficha de alguém. Na prática, obriga a cadastrar contato
-- antes de orçar -- e nem todo orçamento começa assim. Cotação por telefone,
-- pedido de preço por indicação, orçamento-modelo: em todos, o contato só
-- existe depois, se existir.
--
-- O QUE SE PERDE, e vale saber: sem contato, a aprovação do cliente não tem
-- ficha onde aparecer. A edge function passa a pendurar a atividade no NEGÓCIO
-- quando há um, e a não gravar nada quando não há nenhum dos dois. O orçamento
-- continua registrando `decidido_por` e `decidido_em` em si mesmo -- o que se
-- perde é o eco no histórico, não o registro.
--
-- E o ON DELETE muda junto. `RESTRICT` fazia sentido para vínculo obrigatório:
-- apagar contato com orçamento devia falhar. Para vínculo opcional, recusar a
-- exclusão seria pior que soltá-lo -- o orçamento sobrevive sem contato por
-- construção agora, então `SET NULL` é o que corresponde ao modelo.
ALTER TABLE public.orcamentos ALTER COLUMN contact_id DROP NOT NULL;

ALTER TABLE public.orcamentos DROP CONSTRAINT IF EXISTS orcamentos_contact_id_fkey;
ALTER TABLE public.orcamentos
  ADD CONSTRAINT orcamentos_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.orcamentos.contact_id IS
  'Opcional. Quando preenchido, o ciclo do orçamento (visto, aprovado, recusado) vira atividade na ficha da pessoa. Sem ele, a atividade cai no negócio — e sem negócio, não há eco no histórico.';
