import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { dealsApi } from "@/lib/api/deals";
import { useOrg } from "@/hooks/useOrg";
import type { DealInsert, DealUpdate, DealListParams, DealWithRelations } from "@/lib/api/deals";
import type { Database } from "@/integrations/supabase/types";
import { invalidarPainel } from "@/lib/invalidar-painel";

type DealStatus = Database["public"]["Enums"]["deal_status"];

// Re-export so pages don't need to import from the api layer directly
export type { DealListParams, DealWithRelations };

export const dealsKeys = {
  all: (orgId: string) => ["deals", orgId] as const,
  list: (orgId: string, params: DealListParams) => ["deals", orgId, params] as const,
  detail: (id: string) => ["deals", "detail", id] as const,
};

export function useDeal(id: string | undefined) {
  return useQuery({
    queryKey: dealsKeys.detail(id ?? ""),
    queryFn: () => dealsApi.getById(id!),
    enabled: !!id,
  });
}

export function useDeals(params: DealListParams = {}) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: dealsKeys.list(orgId ?? "", params),
    queryFn: () => dealsApi.list(orgId!, params),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });
}

export function useCreateDeal() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return useMutation({
    mutationFn: (deal: DealInsert) => dealsApi.create(deal),
    onSuccess: () => qc.invalidateQueries({ queryKey: dealsKeys.all(orgId ?? "") }),
  });
}

export function useUpdateDeal() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return useMutation({
    mutationFn: ({ id, deal }: { id: string; deal: DealUpdate }) => dealsApi.update(id, deal),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: dealsKeys.all(orgId ?? "") });
      qc.invalidateQueries({ queryKey: dealsKeys.detail(id) });
    },
  });
}

export function useUpdateDealStage() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) =>
      dealsApi.updateStage(id, stageId),
    onMutate: async ({ id, stageId }) => {
      await qc.cancelQueries({ queryKey: dealsKeys.all(orgId ?? "") });
      const keys = qc
        .getQueryCache()
        .findAll({ queryKey: dealsKeys.all(orgId ?? "") });
      const snapshots: Array<{ key: readonly unknown[]; data: unknown }> = [];
      keys.forEach((q) => {
        snapshots.push({ key: q.queryKey, data: q.state.data });
        qc.setQueryData<{ data: DealWithRelations[]; count: number }>(q.queryKey, (old) =>
          old
            ? { ...old, data: old.data.map((d) => (d.id === id ? { ...d, stage_id: stageId } : d)) }
            : old
        );
      });
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots?.forEach(({ key, data }) => qc.setQueryData(key, data));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: dealsKeys.all(orgId ?? "") }),
  });
}

export function useUpdateDealStatus() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return useMutation({
    mutationFn: ({
      id,
      status,
      lossReason,
    }: {
      id: string;
      status: DealStatus;
      lossReason?: string;
    }) => dealsApi.updateStatus(id, status, lossReason),
    onSuccess: () => qc.invalidateQueries({ queryKey: dealsKeys.all(orgId ?? "") }),
  });
}

export function useBatchUpdateDeals() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: "won" | "lost" | "delete" }) => {
      if (action === "delete") return dealsApi.deleteMany(ids);
      return dealsApi.batchUpdateStatus(ids, action);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dealsKeys.all(orgId ?? "") }),
  });
}

export function useDeleteDeal() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return useMutation({
    mutationFn: ({ id, comVinculos }: { id: string; comVinculos?: boolean }) =>
      dealsApi.delete(id, comVinculos),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: dealsKeys.all(orgId ?? "") });
      qc.removeQueries({ queryKey: dealsKeys.detail(id) });
      // A exclusão em cascata apaga atividades: sem invalidar, a tela de
      // Atividades continuaria listando registro de negócio que não existe mais.
      qc.invalidateQueries({ queryKey: ["activities"] });
      // O painel conta contatos, negócios e atividades: qualquer um deles
      // mudando torna os números dele velhos.
      invalidarPainel(qc, orgId);
    },
  });
}

// Re-export types expected by pages/components
export type { DealInsert, DealUpdate };
