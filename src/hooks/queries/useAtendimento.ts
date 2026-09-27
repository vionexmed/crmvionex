import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { emailsApi } from "@/lib/api/emails";
import { mensagemErro } from "@/lib/erro-supabase";
import { emailsKeys } from "@/hooks/queries/useEmails";
import {
  atendimentoApi,
  type CanalAtendimento,
  type ContatoDoAtendimento,
  type MensagemUnificada,
} from "@/lib/api/atendimento";

/**
 * A leitura da tela de Atendimento: os três canais numa consulta só.
 *
 * UMA chave e não três porque a tela mostra UMA lista. Com uma consulta por
 * canal, `isLoading` e `isError` seriam três — e a tela teria de escolher entre
 * mostrar parte da lista enquanto o resto carrega (ordem errada, itens pulando
 * de lugar) ou inventar a combinação dos três estados. Aqui a lista chega
 * pronta, ou não chega.
 */

export const atendimentoKeys = {
  tudo: (orgId: string) => ["atendimento", orgId] as const,
  canais: (orgId: string) => ["atendimento-canais", orgId] as const,
};

export type DadosDoAtendimento = {
  mensagens: MensagemUnificada[];
  contatos: Record<string, ContatoDoAtendimento>;
};

export function useAtendimento() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: atendimentoKeys.tudo(orgId ?? ""),
    queryFn: async (): Promise<DadosDoAtendimento> => {
      const [doMeta, deEmail] = await Promise.all([
        atendimentoApi.listarMensagens(orgId!),
        atendimentoApi.listarEmails(orgId!),
      ]);
      const mensagens = [...doMeta, ...deEmail].sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      );

      const ids = mensagens.map((m) => m.contact_id).filter((id): id is string => !!id);
      const contatos: Record<string, ContatoDoAtendimento> = {};
      for (const c of await atendimentoApi.listarContatos(ids)) contatos[c.id] = c;

      return { mensagens, contatos };
    },
    enabled: !!orgId,
  });
}

/** WhatsApp e Instagram conectados? Dois booleanos, sem tocar na credencial. */
export function useCanaisConectados() {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: atendimentoKeys.canais(orgId ?? ""),
    queryFn: () => atendimentoApi.canaisConectados(orgId!),
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Converte a linha CRUA de `whatsapp_messages`/`instagram_messages` na forma da
 * view.
 *
 * `postgres_changes` escuta replicação, que é de TABELA -- view não emite
 * evento. Assinar `mensagens_do_atendimento` não daria erro: simplesmente nunca
 * chegaria nada, e o sintoma seria "mensagem nova só aparece se eu recarregar".
 */
function mensagemDaLinha(
  canal: Exclude<CanalAtendimento, "email">,
  linha: Record<string, unknown>,
): MensagemUnificada {
  const entrada = linha.direction === "inbound";
  const de = (canal === "whatsapp" ? linha.from_number : linha.from_igsid) as string | null;
  const para = (canal === "whatsapp" ? linha.to_number : linha.to_igsid) as string | null;
  return {
    id: linha.id as string,
    canal,
    contact_id: (linha.contact_id as string | null) ?? null,
    deal_id: (linha.deal_id as string | null) ?? null,
    direction: entrada ? "inbound" : "outbound",
    identidade: (entrada ? de : para) ?? "",
    texto: (linha.body as string | null) ?? null,
    html: null,
    assunto: null,
    message_type: (linha.message_type as string | null) ?? "text",
    status: (linha.status as string | null) ?? "",
    created_at: linha.created_at as string,
    lido: true,
  };
}

/**
 * Tempo real dos dois canais da Meta.
 *
 * DUAS assinaturas, uma por tabela, e as duas agora valem ao mesmo tempo: a
 * tela mostra os dois canais juntos. Enquanto era uma tela por canal, assinar a
 * outra tabela trazia mensagem que a tela filtrava fora.
 *
 * A mensagem entra no cache por `setQueryData` em vez de invalidar a consulta:
 * invalidar refaria a leitura paginada dos três canais a cada mensagem
 * recebida.
 */
export function useAtendimentoAoVivo() {
  const { orgId } = useOrg();
  const qc = useQueryClient();

  useEffect(() => {
    if (!orgId) return;

    const aplicar = (m: MensagemUnificada) => {
      qc.setQueryData<DadosDoAtendimento>(atendimentoKeys.tudo(orgId), (antes) => {
        if (!antes) return antes;
        const i = antes.mensagens.findIndex((x) => x.id === m.id);
        const mensagens = i === -1
          ? [...antes.mensagens, m]
          : antes.mensagens.map((x, j) => (j === i ? m : x));
        return { ...antes, mensagens };
      });
    };

    const assinar = (canal: Exclude<CanalAtendimento, "email">, tabela: string) =>
      supabase
        .channel(`atendimento-${canal}-${orgId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: tabela, filter: `org_id=eq.${orgId}` },
          (payload) => {
            if (payload.eventType === "DELETE") return;
            aplicar(mensagemDaLinha(canal, payload.new as Record<string, unknown>));
          },
        )
        .subscribe();

    const canais = [
      assinar("whatsapp", "whatsapp_messages"),
      assinar("instagram", "instagram_messages"),
    ];
    return () => { for (const c of canais) supabase.removeChannel(c); };
  }, [orgId, qc]);
}

/**
 * Marca o e-mail como lido ao abrir a conversa, como a caixa completa faz.
 *
 * Grava nos DOIS caches: esta tela e `/inbox` leem a mesma tabela por chaves
 * diferentes, e sem isto o mesmo e-mail apareceria lido aqui e não lido lá até
 * alguém recarregar.
 */
export function useMarcarEmailLido() {
  const { orgId } = useOrg();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => emailsApi.update(id, { is_read: true }),
    onMutate: (id) => {
      if (!orgId) return;
      qc.setQueryData<DadosDoAtendimento>(atendimentoKeys.tudo(orgId), (antes) =>
        antes
          ? {
            ...antes,
            mensagens: antes.mensagens.map((m) => (m.id === id ? { ...m, lido: true } : m)),
          }
          : antes,
      );
    },
    /*
     * Erro aqui NÃO vira alarme na tela.
     *
     * Marcar como lido é efeito de ter aberto a conversa, não algo que a pessoa
     * pediu -- e a rede de segurança do `MutationCache` mostraria "Erro ao
     * salvar" por uma falha que não atrapalha a leitura de nada. Declarar
     * `onError` é o que tira esta mutação de lá.
     */
    onError: (e) => console.warn("[Atendimento] não consegui marcar como lido", mensagemErro(e)),
    onSettled: () => {
      if (orgId) void qc.invalidateQueries({ queryKey: emailsKeys.all(orgId) });
    },
  });
}
