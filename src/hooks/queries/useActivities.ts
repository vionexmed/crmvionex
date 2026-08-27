import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { activitiesApi } from "@/lib/api/activities";
import { useOrg } from "@/hooks/useOrg";
import type { ActivityInsert, ActivityUpdate } from "@/lib/api/activities";

/**
 * Mexer em atividade também invalida os NEGÓCIOS.
 *
 * A listagem de negócios embute as atividades para o card do kanban mostrar a
 * última interação. Invalidando só `["activities"]`, criar uma nota no detalhe do
 * negócio não atualizava o card -- ele só mudava depois de um refetch de deals
 * por outro motivo, e a pessoa achava que o registro não funcionou.
 *
 * `useDeleteDeal` já faz o caminho inverso (apagar negócio invalida atividades);
 * faltava o simétrico.
 */
function invalidarAtividadeENegocios(
  qc: ReturnType<typeof useQueryClient>,
  orgId: string | null | undefined,
) {
  qc.invalidateQueries({ queryKey: activitiesKeys.all(orgId ?? "") });
  qc.invalidateQueries({ queryKey: ["deals"] });
}

export const activitiesKeys = {
  all: (orgId: string) => ["activities", orgId] as const,
  byDeal: (dealId: string) => ["activities", "deal", dealId] as const,
};

export function useDealActivities(dealId: string | undefined) {
  return useQuery({
    queryKey: activitiesKeys.byDeal(dealId ?? ""),
    queryFn: () => activitiesApi.listByDeal(dealId!),
    enabled: !!dealId,
  });
}

export function useActivities(type?: Parameters<typeof activitiesApi.list>[1]) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: type
      ? ([...activitiesKeys.all(orgId ?? ""), type] as const)
      : activitiesKeys.all(orgId ?? ""),
    queryFn: () => activitiesApi.list(orgId!, type),
    enabled: !!orgId,
  });
}

export function useCreateActivity() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return useMutation({
    mutationFn: (activity: ActivityInsert) => activitiesApi.create(activity),
    onSuccess: () => invalidarAtividadeENegocios(qc, orgId),
  });
}

export function useUpdateActivity() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return useMutation({
    mutationFn: ({ id, activity }: { id: string; activity: ActivityUpdate }) =>
      activitiesApi.update(id, activity),
    onSuccess: () => invalidarAtividadeENegocios(qc, orgId),
  });
}

export function useDeleteActivities() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return useMutation({
    mutationFn: (ids: string[]) => activitiesApi.deleteMany(ids),
    onSuccess: () => invalidarAtividadeENegocios(qc, orgId),
  });
}
