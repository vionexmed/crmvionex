import { supabase } from "@/integrations/supabase/client";
import { TABLES, DEFAULT_PAGE_SIZE } from "@/lib/constants";
import type { Database } from "@/integrations/supabase/types";

type Deal = Database["public"]["Tables"]["deals"]["Row"];
export type DealInsert = Database["public"]["Tables"]["deals"]["Insert"];
export type DealUpdate = Database["public"]["Tables"]["deals"]["Update"];
type DealStatus = Database["public"]["Enums"]["deal_status"];
type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type Company = Database["public"]["Tables"]["companies"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/** Nota do negócio, no formato reduzido que a listagem embute. */
export type NotaDoNegocio = {
  id: string;
  title: string | null;
  body: string | null;
  created_at: string | null;
};

export type DealWithRelations = Deal & {
  contact?: Contact | null;
  company?: Company | null;
  owner?: Profile | null;
  /** Só na listagem: atividades do tipo 'note', para o card mostrar a última. */
  notas?: NotaDoNegocio[] | null;
};

export interface DealListParams {
  /** Pass for List view — omit to fetch all (Kanban/Forecast) */
  page?: number;
  pageSize?: number;
  ownerId?: string;
  stageIds?: string[];
  minValue?: number;
  maxValue?: number;
  closeDateFrom?: string;
  closeDateTo?: string;
}

export interface DealListResult {
  data: DealWithRelations[];
  count: number;
}

export const dealsApi = {
  list: async (orgId: string, params: DealListParams = {}): Promise<DealListResult> => {
    const {
      page,
      pageSize = DEFAULT_PAGE_SIZE,
      ownerId,
      stageIds,
      minValue,
      maxValue,
      closeDateFrom,
      closeDateTo,
    } = params;

    let query = supabase
      .from(TABLES.DEALS)
      .select(
        // As notas entram aqui para o card do kanban poder mostrar a última.
        // Filtradas por tipo no `.eq` abaixo: sem isso viriam também ligações,
        // reuniões e tarefas, e o payload cresceria sem ninguém usar.
        //
        // O nome da constraint é explícito de propósito -- `activities` tem FK
        // para contacts, companies e organizations além de deals, e nomear evita
        // depender da desambiguação automática do PostgREST. Há teste conferindo
        // cada nome contra os tipos gerados (src/test/api/embed-com-fk.test.ts).
        "*, contact:contacts!deals_contact_id_fkey(*), company:companies!deals_company_id_fkey(*), notas:activities!activities_deal_id_fkey(id,title,body,created_at)",
        { count: "exact" }
      )
      .eq("org_id", orgId)
      .eq("notas.type", "note");

    if (ownerId && ownerId !== "all") query = query.eq("owner_id", ownerId);
    if (stageIds?.length) query = query.in("stage_id", stageIds);
    if (minValue !== undefined) query = query.gte("value", minValue);
    if (maxValue !== undefined) query = query.lte("value", maxValue);
    if (closeDateFrom) query = query.gte("close_date", closeDateFrom);
    if (closeDateTo) query = query.lte("close_date", closeDateTo);

    // Only paginate in list mode; Kanban/Forecast need all records
    if (page !== undefined) {
      const from = page * pageSize;
      query = query.range(from, from + pageSize - 1);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: (data ?? []) as DealWithRelations[], count: count ?? 0 };
  },

  create: async (deal: DealInsert): Promise<Deal> => {
    const { data, error } = await supabase.from(TABLES.DEALS).insert(deal).select().single();
    if (error) throw error;
    return data;
  },

  update: async (id: string, deal: DealUpdate): Promise<Deal> => {
    const { data, error } = await supabase.from(TABLES.DEALS).update(deal).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  updateStage: async (id: string, stageId: string): Promise<void> => {
    const { error } = await supabase.from(TABLES.DEALS).update({ stage_id: stageId }).eq("id", id);
    if (error) throw error;
  },

  updateStatus: async (id: string, status: DealStatus, lossReason?: string): Promise<void> => {
    const payload: DealUpdate = { status };
    if (lossReason) payload.loss_reason = lossReason;
    const { error } = await supabase.from(TABLES.DEALS).update(payload).eq("id", id);
    if (error) throw error;
  },

  batchUpdateStatus: async (ids: string[], status: DealStatus): Promise<void> => {
    const { error } = await supabase.from(TABLES.DEALS).update({ status }).in("id", ids);
    if (error) throw error;
  },

  deleteMany: async (ids: string[]): Promise<void> => {
    const { error } = await supabase.from(TABLES.DEALS).delete().in("id", ids);
    if (error) throw error;
  },

  /**
   * ATENÇÃO ao mexer no select: `owner` NÃO pode vir por embed.
   *
   * `deals.owner_id` referencia `auth.users(id)`, e não existe chave estrangeira
   * de `deals` para `profiles`. O PostgREST não atravessa `auth.users` (schema
   * não exposto), então `owner:profiles!deals_owner_id_fkey(*)` devolve PGRST200
   * — e como a dica de constraint existe de verdade (só aponta para outro lugar),
   * o erro não parece um erro de nome.
   *
   * Esse embed estava aqui e fazia a consulta falhar SEMPRE. Efeito na tela:
   * clicar num negócio girava ~7s (3 tentativas com backoff) e devolvia o
   * usuário para a lista, como se o clique não tivesse acontecido. O `list`
   * abaixo já resolvia o dono no cliente; só o detalhe ficou para trás.
   *
   * O responsável é resolvido em DealDetail com useMembers(), o mesmo join
   * cliente-side de Deals.tsx.
   */
  getById: async (id: string): Promise<DealWithRelations> => {
    const { data, error } = await supabase
      .from(TABLES.DEALS)
      .select(
        "*, contact:contacts!deals_contact_id_fkey(*), company:companies!deals_company_id_fkey(*)"
      )
      .eq("id", id)
      .maybeSingle(); // negócio inexistente → null, não erro
    if (error) throw error;
    // O embed de contact/company não é inferível pelo tipo gerado, então a forma
    // do retorno não se sobrepõe o bastante para um cast direto.
    return data as unknown as DealWithRelations;
  },

  /**
   * O que impede a exclusão deste negócio.
   *
   * `activities.deal_id` foi criado sem cláusula ON DELETE, então vale NO ACTION
   * e o Postgres recusa apagar o negócio. Já `emails.deal_id` e
   * `whatsapp_messages.deal_id` são ON DELETE SET NULL -- as mensagens
   * sobrevivem sem vínculo, e por isso não travam nada.
   *
   * Mesmo padrão da exclusão de contato: contar antes para a tela dizer o que
   * vai acontecer, em vez de deixar o banco recusar com "violates foreign key
   * constraint".
   */
  contarVinculos: async (id: string): Promise<{ atividades: number }> => {
    const { count, error } = await supabase
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", id);
    if (error) throw error;
    return { atividades: count ?? 0 };
  },

  /**
   * Exclui o negócio e, quando `comVinculos`, as atividades dele.
   *
   * Sem transação: o PostgREST não expõe uma. As atividades vão primeiro, senão
   * o Postgres recusa. Se o passo do negócio falhar depois, sobra um negócio sem
   * histórico -- é o motivo de a tela pedir confirmação nomeando o que será
   * apagado.
   */
  delete: async (id: string, comVinculos = false): Promise<void> => {
    if (comVinculos) {
      const { error: eAct } = await supabase.from("activities").delete().eq("deal_id", id);
      if (eAct) throw eAct;
    }
    const { error } = await supabase.from(TABLES.DEALS).delete().eq("id", id);
    if (error) throw error;
  },
};
