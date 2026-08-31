-- Credencial do app de Instagram cadastrada pelo CRM.
--
-- Mesmo dilema e mesma saída de `20260824130000_credencial_google_no_crm`: para
-- cadastrar pela tela seria preciso aceitar que o segredo voltasse numa resposta
-- HTTP para a aba do admin; para o segredo ficar protegido seria preciso abrir o
-- painel do Supabase, o que tira a praticidade.
--
-- A saída não é escolher entre os dois. É gravar num compartimento que o front
-- não alcança: RLS ligada e ZERO policies, só service_role. Cola no CRM, e o
-- valor nunca volta -- nem para quem acabou de salvá-lo.
--
-- Eu havia mandado configurar `INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET` nos
-- secrets do projeto. Funciona, e é pior: o projeto já tinha resolvido isso para
-- o Google, e mandar a pessoa para outro painel quando a tela pode receber é
-- inconsistência, não simplicidade. O ambiente continua valendo como último
-- recurso, na mesma ordem CRM -> ambiente do resolvedor do Google.
--
-- O sufixo `_secrets` no nome NÃO é decorativo: o teste
-- `segredos-fora-do-navegador` descobre as tabelas por esse padrão e cobra RLS
-- sem policy de leitura. Nomear diferente sairia da varredura em silêncio.

CREATE TABLE IF NOT EXISTS public.instagram_app_secrets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- O app_id é PÚBLICO -- ele viaja na URL de autorização que o navegador abre.
  -- Mora aqui junto do segredo porque separar exigiria duas escritas para manter
  -- o par coerente, e credencial meio-atualizada é pior que credencial
  -- escondida. A interface recebe o app_id por edge function, que devolve só o
  -- que é seguro.
  app_id     text NOT NULL,
  app_secret text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.instagram_app_secrets ENABLE ROW LEVEL SECURITY;
-- Propositalmente sem CREATE POLICY. Ver o cabeçalho.

COMMENT ON TABLE public.instagram_app_secrets IS
  'Credencial do app de Instagram da organização. RLS ligada SEM policy: só service_role lê. Não criar policy aqui -- o app_secret assina o webhook e troca o código por token.';
COMMENT ON COLUMN public.instagram_app_secrets.app_id IS
  'Público: viaja na URL de autorização. Fica junto do segredo para o par não desatualizar pela metade.';

-- ---------- Quem tem credencial, sem dizer qual ----------
-- O cartão de Integrações precisa saber se dá para conectar. Não pode ler a
-- tabela (RLS sem policy), e não deveria mesmo -- então esta função devolve o
-- ESTADO e o app_id, que é público. O app_secret nunca sai.
--
-- Devolve também a ORIGEM, porque "configurado no CRM" e "configurado no
-- ambiente" pedem botões diferentes: o primeiro dá para editar e remover pela
-- tela, o segundo não.
CREATE OR REPLACE FUNCTION public.instagram_credencial_estado()
RETURNS TABLE (
  configurado boolean,
  app_id      text,
  origem      text,
  atualizado_em timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid;
BEGIN
  SELECT p.org_id INTO _org_id FROM public.profiles p WHERE p.id = auth.uid();

  IF _org_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, 'nenhum'::text, NULL::timestamptz;
    RETURN;
  END IF;

  -- Só admin. Um comercial não precisa saber com que app a empresa integra, e a
  -- checagem no corpo é o que impede uma SECURITY DEFINER de virar vazamento.
  IF NOT public.is_org_admin(auth.uid(), _org_id) THEN
    RETURN QUERY SELECT false, NULL::text, 'sem_permissao'::text, NULL::timestamptz;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT true, s.app_id, 'crm'::text, s.updated_at
  FROM public.instagram_app_secrets s
  WHERE s.org_id = _org_id;

  -- Sem linha: quem responde sobre o ambiente é a edge function, que é o único
  -- lado que enxerga `Deno.env`. Aqui devolver 'nenhum' seria mentira quando a
  -- variável existe.
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, 'nenhum'::text, NULL::timestamptz;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.instagram_credencial_estado() IS
  'Estado da credencial do app para o cartão de Integrações: configurado, app_id (público) e origem. Nunca devolve o app_secret. Só admin.';
