import { supabase } from "@/integrations/supabase/client";
import { TABLES, DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { LEAD_STAGES, type LifecycleStage } from "@/lib/contact-options";
import type { Database } from "@/integrations/supabase/types";

type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type ContactInsert = Database["public"]["Tables"]["contacts"]["Insert"];
type ContactUpdate = Database["public"]["Tables"]["contacts"]["Update"];
type ContactStatus = Database["public"]["Enums"]["contact_status"];

export const PAGE_SIZE = DEFAULT_PAGE_SIZE;

export interface ContactListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  /**
   * Filtro por ciclo de vida. Substituiu o filtro por `status`, que apontava
   * para a coluna LEGADA e por isso oferecia só metade dos estágios -- não
   * existia opção para lead nem para "em negociação".
   */
  lifecycleStage?: string;
  ownerId?: string;
  companyId?: string;
  createdFrom?: string;
  createdTo?: string;
  origin?: string; // filtro por origem (metadata.source): cadastro_likawave | landing | manual | import
  sortKey?: "name" | "email" | "status" | "created_at" | "title";  // "status" mantido: é a coluna de ordenação do cabeçalho da tabela
  sortDir?: "asc" | "desc";
}

export interface ContactListResult {
  data: Contact[];
  count: number;
}

/**
 * Sanitiza o termo de busca para uso em filtros .or() do PostgREST.
 * Vírgulas, parênteses, aspas e barras quebram (ou alteram) a sintaxe do filtro.
 */
const sanitizeSearch = (s: string) => s.replace(/[,()"\\]/g, " ").trim();

const buildListQuery = (orgId: string, params: ContactListParams) => {
  const { search, lifecycleStage, ownerId, companyId, createdFrom, createdTo, origin, sortKey = "created_at", sortDir = "desc" } = params;

  // Contatos é a lista de TODAS as pessoas da organização.
  //
  // Havia aqui um `.neq("status", "lead")`, e ele criava uma exclusão mútua com
  // a tela de Leads (que mostra só lifecycle lead/contacted): quem entrava no
  // funil desaparecia da lista de pessoas, e vice-versa. O efeito colateral foi
  // pior que o filtro: para os contatos importados não sumirem daqui, os
  // caminhos de criação passaram a gravar status 'prospect' -- o que fazia o
  // trigger marcá-los como 'qualified' sem ninguém ter qualificado, e aí eles
  // nunca apareciam no funil. A tela escondia gente sem dizer, e a contagem no
  // topo não era o total de pessoas.
  let query = supabase
    .from(TABLES.CONTACTS)
    .select("*", { count: "exact" })
    .eq("org_id", orgId);

  // Ciclo de vida: a coluna que vale. `status` é legado.
  if (lifecycleStage && lifecycleStage !== "all") {
    query = query.eq("lifecycle_stage", lifecycleStage as LifecycleStage);
  }
  if (ownerId && ownerId !== "all") query = query.eq("owner_id", ownerId);
  if (companyId && companyId !== "all") query = query.eq("company_id", companyId);
  if (createdFrom) query = query.gte("created_at", createdFrom);
  if (createdTo) query = query.lte("created_at", createdTo);
  // Filtro por origem (metadata.source). Agrupa valores em buckets amigáveis.
  if (origin && origin !== "all") {
    if (origin === "cadastro_likawave") {
      query = query.eq("metadata->>source", "cadastro_likawave");
    } else if (origin === "import") {
      query = query.or("metadata->>source.eq.csv_import,metadata->>source.eq.import,metadata->>source.eq.importacao");
    } else if (origin === "landing") {
      query = query.or("metadata->>source.ilike.%landing%,metadata->>source.ilike.%site%,metadata->>source.ilike.%form%,metadata->>source.ilike.%web%,metadata->>source.ilike.%utm%");
    } else if (origin === "manual") {
      // manual = sem origem gravada (contatos antigos/manuais/CSV legados) ou explicitamente "manual"
      query = query.or("metadata->>source.is.null,metadata->>source.eq.manual,metadata->>source.eq.");
    }
  }
  if (search) {
    const term = sanitizeSearch(search);
    if (term) {
      query = query.or(
        `first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`
      );
    }
  }

  const ascending = sortDir === "asc";
  if (sortKey === "name") {
    query = query.order("first_name", { ascending }).order("last_name", { ascending });
  } else {
    query = query.order(sortKey, { ascending });
  }

  return query;
};

export const contactsApi = {
  list: async (orgId: string, params: ContactListParams = {}): Promise<ContactListResult> => {
    const { page = 0, pageSize = PAGE_SIZE } = params;
    const from = page * pageSize;
    const query = buildListQuery(orgId, params).range(from, from + pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], count: count ?? 0 };
  },

  /**
   * Busca TODOS os contatos (com os filtros atuais), paginando em blocos de
   * 1000 para contornar o max-rows do PostgREST. Usado na exportação CSV e
   * na visão kanban por vendedor.
   */
  listAll: async (orgId: string, params: ContactListParams = {}): Promise<Contact[]> => {
    const CHUNK = 1000;
    const all: Contact[] = [];
    for (let page = 0; ; page++) {
      const from = page * CHUNK;
      const { data, error } = await buildListQuery(orgId, params).range(from, from + CHUNK - 1);
      if (error) throw error;
      all.push(...(data ?? []));
      if (!data || data.length < CHUNK) break;
    }
    return all;
  },

  /**
   * Lista leve para pickers (selects de contato em Negócios/Tarefas).
   * Inclui leads também — tarefas/negócios podem referenciar leads.
   */
  listForPicker: async (orgId: string): Promise<Pick<Contact, "id" | "first_name" | "last_name" | "email" | "status">[]> => {
    const CHUNK = 1000;
    const all: Pick<Contact, "id" | "first_name" | "last_name" | "email" | "status">[] = [];
    for (let page = 0; ; page++) {
      const from = page * CHUNK;
      const { data, error } = await supabase
        .from(TABLES.CONTACTS)
        .select("id, first_name, last_name, email, status")
        .eq("org_id", orgId)
        .order("first_name", { ascending: true })
        .range(from, from + CHUNK - 1);
      if (error) throw error;
      all.push(...(data ?? []));
      if (!data || data.length < CHUNK) break;
    }
    return all;
  },

  create: async (contact: ContactInsert): Promise<Contact> => {
    const { data, error } = await supabase.from(TABLES.CONTACTS).insert(contact).select().single();
    if (error) throw error;
    return data;
  },

  update: async (id: string, contact: ContactUpdate): Promise<Contact> => {
    const { data, error } = await supabase
      .from("contacts")
      .update(contact)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  deleteMany: async (ids: string[]): Promise<void> => {
    const { error } = await supabase.from(TABLES.CONTACTS).delete().in("id", ids);
    if (error) throw error;
  },

  updateStatus: async (ids: string[], status: ContactStatus): Promise<void> => {
    const { error } = await supabase.from(TABLES.CONTACTS).update({ status }).in("id", ids);
    if (error) throw error;
  },

  updateOwner: async (id: string, ownerId: string | null): Promise<void> => {
    const { error } = await supabase.from(TABLES.CONTACTS).update({ owner_id: ownerId }).eq("id", id);
    if (error) throw error;
  },

  /**
   * Leads = ciclo de vida ainda antes da qualificação. Filtra por
   * lifecycle_stage, não por status: 'status' é legado e faz papel duplo.
   */
  listLeads: async (orgId: string): Promise<Contact[]> => {
    // Paginado em blocos porque o PostgREST corta em 1000 linhas EM SILÊNCIO.
    //
    // Sem isto o cabeçalho "N leads aguardando qualificação" mentiria a partir
    // do lead 1001 -- diria exatamente 1000, para sempre, e os leads seguintes
    // simplesmente não existiriam na tela. Antes da correção do ciclo de vida
    // quase nada chegava aqui, então o teto nunca aparecia; agora toda pessoa
    // nova entra na fila.
    const CHUNK = 1000;
    const all: Contact[] = [];
    for (let page = 0; ; page++) {
      const from = page * CHUNK;
      const { data, error } = await supabase
        .from(TABLES.CONTACTS)
        .select("*, companies:companies(name)")
        .eq("org_id", orgId)
        .in("lifecycle_stage", LEAD_STAGES)
        .order("created_at", { ascending: false })
        .range(from, from + CHUNK - 1);
      if (error) throw error;
      all.push(...((data ?? []) as Contact[]));
      if (!data || data.length < CHUNK) break;
    }
    return all;
  },

  /** Move o contato no ciclo de vida. O trigger no banco cuida da auditoria. */
  updateLifecycleStage: async (ids: string[], stage: LifecycleStage): Promise<void> => {
    const { error } = await supabase
      .from(TABLES.CONTACTS)
      .update({ lifecycle_stage: stage })
      .in("id", ids);
    if (error) throw error;
  },
};
