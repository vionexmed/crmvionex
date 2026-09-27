import { useQuery } from "@tanstack/react-query";
import { lossReasonsApi } from "@/lib/api/loss-reasons";
import { useOrg } from "@/hooks/useOrg";

export const lossReasonsKeys = {
  all: (orgId: string, apenasAtivas: boolean) => ["loss-reasons", orgId, apenasAtivas] as const,
};

/**
 * O catálogo de motivos de perda desta organização.
 *
 * Módulo único para os dois modais de "Motivo da Perda" (Deals.tsx e
 * DealDetail.tsx) lerem -- exatamente para que não voltem a divergir com uma
 * lista hardcoded própria cada um, como antes.
 *
 * `apenasAtivas` entra na CHAVE do cache, não só no filtro: o modal de perda
 * (que só pode oferecer motivo ativo) e a exibição de um negócio já perdido
 * (que precisa achar o rótulo mesmo se a org desativou o motivo depois) pedem
 * listas diferentes, e compartilhar a entrada faria quem abrisse uma tela
 * primeiro ditar o que a outra vê.
 */
export function useLossReasons(apenasAtivas = false) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: lossReasonsKeys.all(orgId ?? "", apenasAtivas),
    queryFn: () => lossReasonsApi.list(orgId!, apenasAtivas),
    enabled: !!orgId,
    // Muda quando alguém mexe em Configurações → Funis; minuto a minuto basta.
    staleTime: 60_000,
  });
}
