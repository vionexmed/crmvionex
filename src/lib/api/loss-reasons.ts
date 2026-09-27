import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type LossReason = Database["public"]["Tables"]["loss_reasons"]["Row"];

/**
 * Catálogo de motivos de perda, por organização.
 *
 * Existia desde sempre uma tela de gestão (`PipelinesTab`) e uma migração que
 * semeia os sete motivos que os modais de "Motivo da Perda" tinham
 * HARDCODED -- e os modais nunca liam a tabela. Uma org que cadastrasse motivo
 * próprio jamais o via aparecer ao marcar um negócio como perdido.
 */
export const lossReasonsApi = {
  /**
   * `apenasAtivas` faz parte da escolha de quem chama, não um padrão fixo:
   *
   * - os modais de perda SÓ podem oferecer motivo ativo -- oferecer um
   *   desativado deixaria a organização reintroduzi-lo em silêncio;
   * - quem EXIBE o motivo de um negócio já perdido (DealDetail, relatório)
   *   precisa da lista inteira, porque a org pode ter desativado depois o
   *   motivo que aquele negócio usa -- e some do catálogo ativo o rótulo do
   *   próprio motivo, não o vínculo do negócio com ele.
   */
  list: async (orgId: string, apenasAtivas = false): Promise<LossReason[]> => {
    let q = supabase.from("loss_reasons").select("*").eq("org_id", orgId).order("label");
    if (apenasAtivas) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },
};
