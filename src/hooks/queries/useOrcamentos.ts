import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  orcamentosApi, type ItemNovo, type OrcamentoComRelacoes,
} from "@/lib/api/orcamentos";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/contexts/AuthContext";

export const orcamentosKeys = {
  all: ["orcamentos"] as const,
  daOrg: (orgId: string) => ["orcamentos", orgId] as const,
  doNegocio: (dealId: string) => ["orcamentos", "negocio", dealId] as const,
};

export function useOrcamentos() {
  const { orgId } = useOrg();
  return useQuery<OrcamentoComRelacoes[]>({
    queryKey: orcamentosKeys.daOrg(orgId ?? ""),
    enabled: !!orgId,
    queryFn: () => orcamentosApi.list(orgId!),
  });
}

/** Os de um negócio, para a seção no detalhe dele. */
export function useOrcamentosDoNegocio(dealId: string | undefined) {
  return useQuery<OrcamentoComRelacoes[]>({
    queryKey: orcamentosKeys.doNegocio(dealId ?? ""),
    enabled: !!dealId,
    queryFn: () => orcamentosApi.doNegocio(dealId!),
  });
}

/**
 * Invalida TUDO que mostra orçamento.
 *
 * São quatro lugares -- a lista, a seção do negócio, o histórico do contato e a
 * última interação do card do kanban -- e os dois últimos leem `activities`,
 * não `orcamentos`. Sem invalidar as atividades, aprovar um orçamento não
 * apareceria na ficha da pessoa até a próxima recarga.
 */
function useInvalidar() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: orcamentosKeys.all });
    qc.invalidateQueries({ queryKey: ["activities"] });
    qc.invalidateQueries({ queryKey: ["deals"] });
  };
}

export function useCriarOrcamento() {
  const invalidar = useInvalidar();
  const { orgId } = useOrg();
  const { user } = useAuth();

  return useMutation({
    mutationFn: ({
      dados,
      itens,
    }: {
      dados: Omit<Parameters<typeof orcamentosApi.criar>[0], "org_id" | "owner_id">;
      itens: ItemNovo[];
    }) =>
      orcamentosApi.criar({ ...dados, org_id: orgId!, owner_id: user?.id ?? null }, itens),
    onSuccess: invalidar,
  });
}

export function useAtualizarOrcamento() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof orcamentosApi.atualizar>[1] }) =>
      orcamentosApi.atualizar(id, patch),
    onSuccess: invalidar,
  });
}

export function useTrocarItens() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, itens }: { id: string; itens: ItemNovo[] }) =>
      orcamentosApi.trocarItens(id, itens),
    onSuccess: invalidar,
  });
}

export function useExcluirOrcamento() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (id: string) => orcamentosApi.excluir(id),
    onSuccess: invalidar,
  });
}
