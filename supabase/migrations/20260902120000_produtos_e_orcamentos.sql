-- Catálogo de produtos e orçamento aprovável pelo cliente.
--
-- Nada disso existia. Um negócio tinha só `value` -- um número digitado à mão,
-- sem dizer de onde veio nem o que foi ofertado.
--
-- Três decisões deste modelo, e as três respondem a "tudo precisa se conectar":
--
-- 1. O ITEM COPIA NOME E PREÇO. Se apontasse só para o produto, corrigir o
--    preço no catálogo mudaria orçamento já aceito -- inclusive o total que o
--    cliente aprovou por escrito. O item guarda o que FOI ofertado; o catálogo
--    guarda o que se oferta hoje. É a mesma família de defeito que o CLAUDE.md
--    registra em métrica contada por `created_at`: um número fechado que muda
--    depois de fechado.
--
-- 2. CONTATO É OBRIGATÓRIO. Orçamento sem pessoa não tem histórico onde
--    aparecer, e era justamente isso que se pediu: a decisão do cliente vira
--    linha na ficha dele.
--
-- 3. O ACESSO PÚBLICO NÃO PASSA POR RLS. O cliente não tem sessão. Ele entra
--    por uma edge function com `service_role`, que devolve só os campos que ele
--    pode ver. A tabela segue fechada -- ver a política no fim.

-- ---------- 1. O tipo de atividade ----------
--
-- Cada passo do orçamento (visto, aprovado, recusado) grava uma atividade no
-- contato. É o que faz o evento aparecer no histórico dele, na última interação
-- do card do negócio e na tela de Atividades, sem nenhuma tela nova.
--
-- E um tipo NOVO em vez de reusar 'note': "Abordagens realizadas" no painel
-- filtra `call`/`email` explicitamente, então um tipo desconhecido fica fora da
-- métrica sozinho. Reusar 'email' dobraria a contagem de abordagem.
ALTER TYPE public.activity_type ADD VALUE IF NOT EXISTS 'orcamento';

-- ---------- 2. Produtos ----------
CREATE TABLE IF NOT EXISTS public.produtos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  nome        text NOT NULL,
  descricao   text,
  -- URL pública do Storage, gravada por LogoUploadField. Fica no banco e não no
  -- bucket-por-produto porque a foto é atributo, não entidade.
  foto_url    text,

  -- `numeric` e não `float`: preço em ponto flutuante acumula erro de
  -- arredondamento, e o total de um orçamento é o número que o cliente aprova.
  preco       numeric(14,2) NOT NULL DEFAULT 0 CHECK (preco >= 0),
  moeda       text NOT NULL DEFAULT 'BRL',
  -- "un", "hora", "sessão", "caixa". Texto livre porque a lista varia por
  -- ramo, e um enum aqui viraria migração a cada cliente novo.
  unidade     text NOT NULL DEFAULT 'un',
  sku         text,

  -- Desativar em vez de apagar. Produto que já foi orçado não pode desaparecer
  -- do catálogo sem deixar o histórico sem referência.
  ativo       boolean NOT NULL DEFAULT true,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS produtos_org_ativo_idx ON public.produtos (org_id, ativo);
-- SKU único por organização, e só quando existe: dois produtos sem SKU não
-- conflitam entre si.
CREATE UNIQUE INDEX IF NOT EXISTS produtos_org_sku_idx
  ON public.produtos (org_id, sku) WHERE sku IS NOT NULL;

-- ---------- 3. Orçamentos ----------
CREATE TABLE IF NOT EXISTS public.orcamentos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Sequencial POR ORGANIZAÇÃO. É o número que a pessoa fala ao telefone
  -- ("o orçamento 42"), e um uuid não serve para isso. Preenchido pelo trigger
  -- abaixo, sob lock: duas abas salvando ao mesmo tempo pegariam o mesmo número.
  numero       integer NOT NULL,

  -- OBRIGATÓRIO, e RESTRICT de propósito.
  --
  -- O CLAUDE.md registra quatro FKs criadas sem cláusula ON DELETE que hoje
  -- recusam exclusão de contato -- e o problema lá não é o RESTRICT, é ele ser
  -- IMPLÍCITO e ninguém saber. Aqui é explícito: apagar contato com orçamento
  -- deve falhar, e a tela conta os vínculos antes (contactsApi.contarVinculos).
  contact_id   uuid NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  company_id   uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  -- Orçamento pode nascer sem negócio; perder o negócio não apaga o orçamento.
  deal_id      uuid REFERENCES public.deals(id) ON DELETE SET NULL,

  -- Quem enviou. `auth.users` e não `profiles`: é o padrão de `deals.owner_id`,
  -- e o CLAUDE.md registra que embed de profiles por essa FK falha com PGRST200
  -- -- resolver o nome é trabalho do cliente, via useMembers().
  owner_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  status       text NOT NULL DEFAULT 'rascunho'
               CHECK (status IN ('rascunho','enviado','aprovado','recusado','expirado')),

  titulo       text,
  valido_ate   date,
  -- Desconto do orçamento inteiro, sobre a soma dos itens. Em valor e não em
  -- porcentagem: é assim que se negocia ("tiro 200 reais"), e guardar os dois
  -- convidaria os dois a divergirem.
  desconto     numeric(14,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),
  moeda        text NOT NULL DEFAULT 'BRL',
  -- INTERNA. Nunca sai na página pública -- ver a edge function.
  observacoes  text,

  -- O link do cliente. 64 caracteres de hex vindos de crypto: sequencial ou
  -- curto deixaria adivinhar o orçamento do vizinho, e com ele o preço dele.
  token        text NOT NULL UNIQUE,

  enviado_em   timestamptz,
  visto_em     timestamptz,
  decidido_em  timestamptz,
  -- Quem aprovou, pelo nome que a pessoa digitou. Não é login: é o que
  -- transforma "o cliente aprovou" em algo que se sustenta numa conversa.
  decidido_por text,
  motivo_recusa text,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, numero)
);

CREATE INDEX IF NOT EXISTS orcamentos_org_status_idx ON public.orcamentos (org_id, status);
CREATE INDEX IF NOT EXISTS orcamentos_contact_idx ON public.orcamentos (contact_id);
CREATE INDEX IF NOT EXISTS orcamentos_deal_idx ON public.orcamentos (deal_id);

-- ---------- 4. Itens ----------
CREATE TABLE IF NOT EXISTS public.orcamento_itens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orcamento_id  uuid NOT NULL REFERENCES public.orcamentos(id) ON DELETE CASCADE,

  -- ANULÁVEL, e é a outra metade da cópia abaixo: apagar um produto não pode
  -- apagar a linha de um orçamento já aprovado.
  produto_id    uuid REFERENCES public.produtos(id) ON DELETE SET NULL,

  -- CÓPIA, não referência. Ver o item 1 do cabeçalho: sem isto, corrigir o
  -- preço no catálogo reescreve o total que o cliente já aprovou.
  nome          text NOT NULL,
  descricao     text,
  unidade       text NOT NULL DEFAULT 'un',
  preco_unit    numeric(14,2) NOT NULL CHECK (preco_unit >= 0),

  quantidade    numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  desconto      numeric(14,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),

  ordem         integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orcamento_itens_orcamento_idx
  ON public.orcamento_itens (orcamento_id, ordem);

-- ---------- 5. O número sequencial ----------
--
-- Sob `pg_advisory_xact_lock` por organização: sem o lock, duas pessoas
-- salvando ao mesmo tempo leem o mesmo MAX e o UNIQUE (org_id, numero) recusa a
-- segunda -- com um erro que não explica nada para quem só clicou em salvar.
CREATE OR REPLACE FUNCTION public.orcamento_numero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.numero IS NOT NULL AND NEW.numero > 0 THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.org_id::text));

  SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM public.orcamentos WHERE org_id = NEW.org_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orcamento_numero_trg ON public.orcamentos;
CREATE TRIGGER orcamento_numero_trg
  BEFORE INSERT ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.orcamento_numero();

-- ---------- 6. RLS ----------
--
-- Leitura para a organização, escrita para a organização. Não restringi escrita
-- a admin: montar orçamento é trabalho de quem vende, não de quem administra.
--
-- O CLIENTE NÃO ENTRA POR AQUI. Ele não tem sessão -- `auth.uid()` é nulo, e
-- toda política abaixo recusa. O acesso público é só pela edge function
-- `orcamento-publico`, com service_role, que devolve campo escolhido a dedo.

ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamento_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS produtos_rw ON public.produtos;
CREATE POLICY produtos_rw ON public.produtos FOR ALL
  USING (public.user_belongs_to_org(auth.uid(), org_id))
  WITH CHECK (public.user_belongs_to_org(auth.uid(), org_id));

DROP POLICY IF EXISTS orcamentos_rw ON public.orcamentos;
CREATE POLICY orcamentos_rw ON public.orcamentos FOR ALL
  USING (public.user_belongs_to_org(auth.uid(), org_id))
  WITH CHECK (public.user_belongs_to_org(auth.uid(), org_id));

-- O item não tem `org_id`: ele herda pelo orçamento. Repetir a coluna daria
-- duas fontes para o mesmo fato, e nada garantiria que concordam.
DROP POLICY IF EXISTS orcamento_itens_rw ON public.orcamento_itens;
CREATE POLICY orcamento_itens_rw ON public.orcamento_itens FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.orcamentos o
     WHERE o.id = orcamento_id
       AND public.user_belongs_to_org(auth.uid(), o.org_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.orcamentos o
     WHERE o.id = orcamento_id
       AND public.user_belongs_to_org(auth.uid(), o.org_id)
  ));

COMMENT ON TABLE public.produtos IS
  'Catálogo de produtos e serviços da organização. Preço aqui é o de HOJE; o que foi ofertado está copiado em orcamento_itens.';
COMMENT ON TABLE public.orcamentos IS
  'Orçamento aprovável pelo cliente por link público. O acesso do cliente não passa por RLS: é a edge function orcamento-publico, com service_role.';
COMMENT ON COLUMN public.orcamento_itens.preco_unit IS
  'CÓPIA do preço no momento da criação. Nunca ler produtos.preco para exibir item de orçamento existente.';
