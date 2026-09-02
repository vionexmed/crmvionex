import { supabase } from "@/integrations/supabase/client";
import { TABLES } from "@/lib/constants";
import type { Database } from "@/integrations/supabase/types";
import type { Produto } from "@/lib/api/produtos";

export type Orcamento = Database["public"]["Tables"]["orcamentos"]["Row"];
export type OrcamentoItem = Database["public"]["Tables"]["orcamento_itens"]["Row"];
type OrcamentoInsert = Database["public"]["Tables"]["orcamentos"]["Insert"];
type OrcamentoUpdate = Database["public"]["Tables"]["orcamentos"]["Update"];

type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type Company = Database["public"]["Tables"]["companies"]["Row"];

export type OrcamentoComRelacoes = Orcamento & {
  contact?: Contact | null;
  company?: Company | null;
  itens?: OrcamentoItem[] | null;
};

/** O item como a tela monta, antes de existir no banco. */
export type ItemNovo = {
  produto_id: string | null;
  nome: string;
  descricao?: string | null;
  unidade: string;
  preco_unit: number;
  quantidade: number;
  desconto: number;
};

/*
  A ARITMÉTICA MORA EM `orcamento-calculo.ts`, e é reexportada daqui.

  Ela estava neste arquivo, e o custo apareceu no teste: importar este módulo
  arrasta o cliente do Supabase, que exige `localStorage` e não carrega no
  ambiente de teste. A conta que produz o número que o cliente aprova era a
  única parte NÃO testável do fluxo.

  A reexportação existe para os call sites não precisarem saber da separação --
  quem já importava daqui continua funcionando.
*/
export { totalDoItem, totaisDoOrcamento, novoToken } from "@/lib/orcamento-calculo";
import { novoToken } from "@/lib/orcamento-calculo";

/** O que a tela precisa para montar um item a partir do catálogo. */
export function itemDeProduto(p: Produto): ItemNovo {
  return {
    produto_id: p.id,
    // CÓPIA, e é o ponto do modelo: o item guarda o que foi ofertado. Ler
    // `produtos.preco` na hora de exibir faria orçamento aprovado mudar de
    // valor quando alguém corrigisse o catálogo.
    nome: p.nome,
    descricao: p.descricao,
    unidade: p.unidade,
    preco_unit: Number(p.preco),
    quantidade: 1,
    desconto: 0,
  };
}

const SELECT_COM_RELACOES = `
  *,
  contact:contacts!orcamentos_contact_id_fkey(*),
  company:companies!orcamentos_company_id_fkey(*),
  itens:orcamento_itens(*)
`;

export const orcamentosApi = {
  /**
   * A listagem, com contato, empresa e itens.
   *
   * O embed é nomeado pela FK (`orcamentos_contact_id_fkey`) porque o CLAUDE.md
   * registra o custo de errar isso: um embed que o PostgREST não consegue
   * atravessar falha com PGRST200, e a tela gira em três tentativas com backoff
   * antes de devolver o usuário para a lista sem erro nenhum na cara.
   *
   * `owner_id` NÃO entra em embed: ele aponta para `auth.users`, schema que o
   * PostgREST não expõe. O responsável se resolve no cliente com `useMembers()`,
   * como `Deals.tsx` já faz.
   */
  list: async (orgId: string): Promise<OrcamentoComRelacoes[]> => {
    const { data, error } = await supabase
      .from(TABLES.ORCAMENTOS)
      .select(SELECT_COM_RELACOES)
      .eq("org_id", orgId)
      .order("numero", { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as OrcamentoComRelacoes[];
  },

  /** Os de um negócio, para a seção no detalhe dele. */
  doNegocio: async (dealId: string): Promise<OrcamentoComRelacoes[]> => {
    const { data, error } = await supabase
      .from(TABLES.ORCAMENTOS)
      .select(SELECT_COM_RELACOES)
      .eq("deal_id", dealId)
      .order("numero", { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as OrcamentoComRelacoes[];
  },

  obter: async (id: string): Promise<OrcamentoComRelacoes | null> => {
    const { data, error } = await supabase
      .from(TABLES.ORCAMENTOS)
      .select(SELECT_COM_RELACOES)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as unknown as OrcamentoComRelacoes | null;
  },

  /**
   * Cria o orçamento e os itens.
   *
   * Duas escritas, e o PostgREST NÃO expõe transação -- o mesmo limite que o
   * CLAUDE.md registra na exclusão de contato. Se os itens falharem, o
   * orçamento fica sem linha nenhuma; por isso o cabeçalho vem primeiro e a
   * falha dos itens apaga o cabeçalho, em vez de deixar um orçamento vazio na
   * lista com número gasto.
   */
  criar: async (
    orcamento: Omit<OrcamentoInsert, "token" | "numero"> & { numero?: number },
    itens: ItemNovo[],
  ): Promise<Orcamento> => {
    const { data: criado, error } = await supabase
      .from(TABLES.ORCAMENTOS)
      .insert({ ...orcamento, token: novoToken() })
      .select()
      .single();
    if (error) throw error;

    if (itens.length > 0) {
      const { error: erroItens } = await supabase.from(TABLES.ORCAMENTO_ITENS).insert(
        itens.map((i, ordem) => ({ ...i, orcamento_id: criado.id, ordem })),
      );
      if (erroItens) {
        await supabase.from(TABLES.ORCAMENTOS).delete().eq("id", criado.id);
        throw erroItens;
      }
    }

    return criado;
  },

  atualizar: async (id: string, patch: OrcamentoUpdate): Promise<Orcamento> => {
    const { data, error } = await supabase
      .from(TABLES.ORCAMENTOS)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  /** Troca os itens inteiros. Editar item a item exigiria diff, e o construtor
   *  entrega a lista final -- apagar e reinserir é o que corresponde ao gesto. */
  trocarItens: async (orcamentoId: string, itens: ItemNovo[]): Promise<void> => {
    const { error: erroApagar } = await supabase
      .from(TABLES.ORCAMENTO_ITENS).delete().eq("orcamento_id", orcamentoId);
    if (erroApagar) throw erroApagar;

    if (itens.length === 0) return;
    const { error } = await supabase.from(TABLES.ORCAMENTO_ITENS).insert(
      itens.map((i, ordem) => ({ ...i, orcamento_id: orcamentoId, ordem })),
    );
    if (error) throw error;
  },

  excluir: async (id: string): Promise<void> => {
    // Os itens vão com ele: `orcamento_itens.orcamento_id` é ON DELETE CASCADE.
    const { error } = await supabase.from(TABLES.ORCAMENTOS).delete().eq("id", id);
    if (error) throw error;
  },
};
