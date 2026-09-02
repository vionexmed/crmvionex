import { supabase } from "@/integrations/supabase/client";
import { TABLES } from "@/lib/constants";
import type { Database } from "@/integrations/supabase/types";

export type Produto = Database["public"]["Tables"]["produtos"]["Row"];
type ProdutoInsert = Database["public"]["Tables"]["produtos"]["Insert"];
type ProdutoUpdate = Database["public"]["Tables"]["produtos"]["Update"];

export const produtosApi = {
  /**
   * O catálogo, em ordem alfabética.
   *
   * `apenasAtivos` existe para o construtor de orçamento: ninguém deve poder
   * acrescentar produto desativado a um orçamento novo. Na tela de Produtos o
   * padrão é o contrário -- mostrar todos, senão o desativado desaparece e não
   * há como reativá-lo.
   */
  list: async (orgId: string, apenasAtivos = false): Promise<Produto[]> => {
    let q = supabase
      .from(TABLES.PRODUTOS)
      .select("*")
      .eq("org_id", orgId)
      .order("nome");

    if (apenasAtivos) q = q.eq("ativo", true);

    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },

  create: async (produto: ProdutoInsert): Promise<Produto> => {
    const { data, error } = await supabase
      .from(TABLES.PRODUTOS).insert(produto).select().single();
    if (error) throw error;
    return data;
  },

  update: async (id: string, produto: ProdutoUpdate): Promise<Produto> => {
    const { data, error } = await supabase
      .from(TABLES.PRODUTOS)
      .update({ ...produto, updated_at: new Date().toISOString() })
      .eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  /**
   * Quantos orçamentos citam este produto.
   *
   * O mesmo padrão de `contactsApi.contarVinculos`, e pelo mesmo motivo: o
   * PostgREST não expõe transação, então a tela precisa dizer o que vai embora
   * ANTES de apagar. Aqui o item não vai embora -- `produto_id` é
   * `ON DELETE SET NULL` e a linha do orçamento guarda nome e preço próprios --
   * mas o vínculo some, e quem apaga merece saber quantos.
   */
  contarVinculos: async (id: string): Promise<number> => {
    const { count, error } = await supabase
      .from(TABLES.ORCAMENTO_ITENS)
      .select("id", { count: "exact", head: true })
      .eq("produto_id", id);
    if (error) throw error;
    return count ?? 0;
  },

  delete: async (id: string): Promise<void> => {
    const { error } = await supabase.from(TABLES.PRODUTOS).delete().eq("id", id);
    if (error) throw error;
  },
};
