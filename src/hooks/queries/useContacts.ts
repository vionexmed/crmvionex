import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { contactsApi } from "@/lib/api/contacts";
import { activitiesApi } from "@/lib/api/activities";
import { useOrg } from "@/hooks/useOrg";
import type { ContactListParams } from "@/lib/api/contacts";
import type { LifecycleStage } from "@/lib/contact-options";


export const contactsKeys = {
  all: (orgId: string) => ["contacts", orgId] as const,
  list: (orgId: string, params: ContactListParams) => ["contacts", orgId, params] as const,
  lastActivities: (orgId: string) => ["contacts", orgId, "lastActivities"] as const,
};

export function useContacts(params: ContactListParams = {}) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: contactsKeys.list(orgId ?? "", params),
    queryFn: () => contactsApi.list(orgId!, params),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });
}

/** Todos os contatos (sem paginação) — usado no kanban por vendedor e exportação */
export function useAllContacts(params: ContactListParams = {}, enabled = true) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: [...contactsKeys.all(orgId ?? ""), "unpaged", params] as const,
    queryFn: () => contactsApi.listAll(orgId!, params),
    enabled: !!orgId && enabled,
  });
}

/** Lista leve p/ selects de contato (Negócios, Tarefas) — inclui leads */
export function useContactsPicker() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: [...contactsKeys.all(orgId ?? ""), "picker"] as const,
    queryFn: () => contactsApi.listForPicker(orgId!),
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLastActivities() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: contactsKeys.lastActivities(orgId ?? ""),
    queryFn: () => activitiesApi.lastPerContact(orgId!),
    enabled: !!orgId,
    staleTime: 10 * 60 * 1000,
  });
}

export function useDeleteContacts() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return useMutation({
    mutationFn: ({ ids, comVinculos }: { ids: string[]; comVinculos?: boolean }) =>
      contactsApi.deleteMany(ids, comVinculos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: contactsKeys.all(orgId ?? "") });
      // A exclusão em cascata apaga negócios e atividades: sem invalidar, o
      // funil continuaria mostrando negócio de contato que não existe mais.
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["activities"] });
    },
  });
}

/**
 * Move contatos no ciclo de vida.
 *
 * Havia um `useUpdateContactsStatus` ao lado, escrevendo na coluna LEGADA. Ele
 * saiu junto com o último consumidor -- o "Aprovar" em lote de Leads.
 *
 * Escrever `status` é mexer no ciclo de vida com RESOLUÇÃO MENOR: são quatro
 * valores contra seis, e o gatilho deriva de volta escolhendo um. "prospect"
 * pode significar 'qualified' ou 'opportunity', e a derivação escolhe
 * 'qualified' -- rebaixando quem já estava em negociação.
 */
export function useUpdateContactsLifecycle() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return useMutation({
    mutationFn: ({ ids, stage }: { ids: string[]; stage: LifecycleStage }) =>
      contactsApi.updateLifecycleStage(ids, stage),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactsKeys.all(orgId ?? "") }),
  });
}

export function useUpdateContactOwner() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return useMutation({
    mutationFn: ({ id, ownerId }: { id: string; ownerId: string | null }) =>
      contactsApi.updateOwner(id, ownerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: contactsKeys.all(orgId ?? "") }),
  });
}
