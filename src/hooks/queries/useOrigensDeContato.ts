import { useQuery } from "@tanstack/react-query";
import { contactsApi } from "@/lib/api/contacts";
import { useOrg } from "@/hooks/useOrg";

export const origensKeys = {
  all: (orgId: string) => ["origens-de-contato", orgId] as const,
};

/**
 * As origens que EXISTEM na base, com contagem.
 *
 * Em cache e compartilhada: o filtro da tela de Contatos e o seletor da ficha
 * pedem a mesma lista, e abrir uma ficha não precisa de consulta nova.
 *
 * Falhar aqui nunca pode derrubar quem chama -- sem a lista dinâmica, o seletor
 * volta a oferecer só os quatro grupos conhecidos, que é o comportamento
 * anterior, e o filtro segue funcionando.
 */
export function useOrigensDeContato() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: origensKeys.all(orgId ?? ""),
    queryFn: () => contactsApi.listarOrigens(orgId!),
    enabled: !!orgId,
    // A lista muda quando alguém cadastra ou importa; de minuto em minuto basta.
    staleTime: 60_000,
  });
}
