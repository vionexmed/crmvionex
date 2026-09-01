import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";

export const organizacaoKeys = {
  atual: (orgId: string) => ["organizacao", orgId] as const,
};

/**
 * A organização atual.
 *
 * `useOrg()` devolve só o `org_id`, que vem do perfil. O NOME não estava em
 * lugar nenhum compartilhado: `GeneralTab` e `BillingTab` fazem cada uma o
 * próprio `from("organizations").select("*")`, e a barra lateral precisava dele
 * para mostrar de qual empresa é a conta -- coisa que a navegação nunca disse.
 *
 * Só as três colunas que a interface usa, e não `select("*")`: a tabela guarda
 * `settings` em JSONB, que pode crescer bastante e não tem nada a ver com
 * desenhar um nome no topo da lateral. Não há coluna de logo -- a da empresa
 * mora dentro de `settings`, e a lateral usa a marca do produto.
 *
 * `staleTime` alto de propósito: nome de empresa não muda enquanto se usa o CRM,
 * e sem ele esta consulta sairia a cada troca de tela.
 */
export function useOrganizacao() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: organizacaoKeys.atual(orgId ?? ""),
    enabled: !!orgId,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, slug")
        .eq("id", orgId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
