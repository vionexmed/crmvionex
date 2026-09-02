-- O número do orçamento tem DEFAULT, para o tipo gerado dizer a verdade.
--
-- `numero integer NOT NULL` sem default fazia o gerador do Supabase marcá-lo
-- como OBRIGATÓRIO no tipo de Insert -- e ele não é: o trigger
-- `orcamento_numero` calcula o próximo sob lock, e quem insere não deve
-- escolher número nenhum.
--
-- O efeito era o cliente ter de mandar um valor que o banco ia jogar fora, ou
-- silenciar o TypeScript com um cast. Os dois pioram o mesmo lugar: o ponto em
-- que se decide o número passa a existir em dois sítios, e o do cliente é o
-- errado.
--
-- Zero é SENTINELA, não número válido: o trigger já testava `numero > 0` para
-- decidir se calcula. Com o default, "não informado" e "zero" viram a mesma
-- coisa nos dois lados, que é o que sempre foram.
--
-- O CHECK impede que o zero sobreviva: se o trigger deixar de rodar, a linha é
-- recusada em vez de nascer com número inválido e colidir com o próximo.
ALTER TABLE public.orcamentos ALTER COLUMN numero SET DEFAULT 0;

ALTER TABLE public.orcamentos DROP CONSTRAINT IF EXISTS orcamentos_numero_positivo;
ALTER TABLE public.orcamentos
  ADD CONSTRAINT orcamentos_numero_positivo CHECK (numero > 0) NOT VALID;

COMMENT ON COLUMN public.orcamentos.numero IS
  'Sequencial por organização, atribuído pelo trigger orcamento_numero. O default 0 é sentinela de "não informado" — o CHECK garante que ele nunca sobreviva ao INSERT.';
