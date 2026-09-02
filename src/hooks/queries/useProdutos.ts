import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { produtosApi, type Produto } from "@/lib/api/produtos";
import { useOrg } from "@/hooks/useOrg";

export const produtosKeys = {
  all: (orgId: string) => ["produtos", orgId] as const,
  lista: (orgId: string, apenasAtivos: boolean) => ["produtos", orgId, apenasAtivos] as const,
};

/**
 * O catálogo.
 *
 * `apenasAtivos` faz parte da CHAVE do cache, e não só do filtro: sem isso a
 * tela de Produtos (que mostra todos) e o construtor de orçamento (que mostra
 * só ativos) compartilhariam a mesma entrada, e quem abrisse o construtor
 * primeiro veria a lista curta na tela de Produtos.
 */
export function useProdutos(apenasAtivos = false) {
  const { orgId } = useOrg();
  return useQuery<Produto[]>({
    queryKey: produtosKeys.lista(orgId ?? "", apenasAtivos),
    enabled: !!orgId,
    queryFn: () => produtosApi.list(orgId!, apenasAtivos),
  });
}

/** Invalida as duas variantes: um produto novo entra nas duas listas. */
function useInvalidar() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return () => qc.invalidateQueries({ queryKey: ["produtos", orgId ?? ""] });
}

export function useCriarProduto() {
  const invalidar = useInvalidar();
  const { orgId } = useOrg();
  return useMutation({
    // `Omit<…, "org_id">`: o hook preenche a organizacao, e o tipo precisa dizer
    // isso. Exigindo do chamador, ele obrigaria cada tela a repetir `useOrg()`
    // -- e a primeira que esquecesse gravaria produto na org errada.
    mutationFn: (p: Omit<Parameters<typeof produtosApi.create>[0], "org_id">) =>
      produtosApi.create({ ...p, org_id: orgId! }),
    onSuccess: invalidar,
  });
}

export function useAtualizarProduto() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof produtosApi.update>[1] }) =>
      produtosApi.update(id, patch),
    onSuccess: invalidar,
  });
}

export function useExcluirProduto() {
  const invalidar = useInvalidar();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => produtosApi.delete(id),
    onSuccess: () => {
      invalidar();
      // Os itens de orçamento perdem a referência (`ON DELETE SET NULL`) mas
      // mantêm nome e preço. A lista de orçamentos ainda precisa recarregar:
      // é o `produto_id` que decide se o item mostra link para o catálogo.
      qc.invalidateQueries({ queryKey: ["orcamentos"] });
    },
  });
}
