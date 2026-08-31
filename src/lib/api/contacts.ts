import { supabase } from "@/integrations/supabase/client";
import { TABLES, DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { type LifecycleStage } from "@/lib/contact-options";
import type { Database } from "@/integrations/supabase/types";
import { buscarEmBlocos } from "@/lib/paginar";

type Contact = Database["public"]["Tables"]["contacts"]["Row"];
type ContactInsert = Database["public"]["Tables"]["contacts"]["Insert"];
type ContactUpdate = Database["public"]["Tables"]["contacts"]["Update"];

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
  /**
   * Filtro por origem: cadastro_likawave | landing | manual | import.
   *
   * Lê `metadata.source`, exceto em `import`, que lê a marca
   * `metadata.importado_em` -- desde que a importação passou a gravar o NOME DO
   * ARQUIVO em `source`, o texto deixou de ser previsível.
   */
  origin?: string;
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
      // `importado_em` é a MARCA, e `source` virou o nome do arquivo.
      //
      // O casamento exato em `csv_import` continua para os contatos importados
      // ANTES dessa mudança -- tirá-lo faria eles sumirem deste filtro. Os
      // novos entram pela marca de data, que independe do nome do arquivo: sem
      // ela, uma planilha chamada "Congresso 2026" não seria reconhecida como
      // importação por nada.
      query = query.or(
        "metadata->>importado_em.not.is.null," +
        "metadata->>source.eq.csv_import,metadata->>source.eq.import,metadata->>source.eq.importacao",
      );
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
  listAll: async (orgId: string, params: ContactListParams = {}): Promise<Contact[]> =>
    buscarEmBlocos<Contact>((inicio, fim) => buildListQuery(orgId, params).range(inicio, fim)),

  /**
   * Lista leve para pickers (selects de contato em Negócios/Tarefas).
   * Inclui leads também — tarefas/negócios podem referenciar leads.
   */
  listForPicker: async (
    orgId: string,
  ): Promise<Pick<Contact, "id" | "first_name" | "last_name" | "email" | "lifecycle_stage">[]> =>
    // `lifecycle_stage`, não `status`: a coluna legada tem 4 valores contra 6 e
    // o mapa entre elas perde `contacted` e `opportunity`.
    buscarEmBlocos((inicio, fim) =>
      supabase
        .from(TABLES.CONTACTS)
        .select("id, first_name, last_name, email, lifecycle_stage")
        .eq("org_id", orgId)
        .order("first_name", { ascending: true })
        .range(inicio, fim),
    ),

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

  /**
   * O que impede a exclusão destes contatos.
   *
   * `deals.contact_id` e `activities.contact_id` foram criados sem cláusula
   * ON DELETE, então valem NO ACTION: o Postgres recusa apagar o contato. Já
   * `emails.contact_id` e `whatsapp_messages.contact_id` são ON DELETE SET NULL
   * -- as mensagens sobrevivem sem dono, e por isso não travam nada.
   *
   * Contar antes serve para a tela dizer o que vai acontecer em vez de deixar o
   * banco recusar com "violates foreign key constraint".
   */
  contarVinculos: async (ids: string[]): Promise<{ negocios: number; atividades: number }> => {
    const [d, a] = await Promise.all([
      supabase.from(TABLES.DEALS).select("id", { count: "exact", head: true }).in("contact_id", ids),
      supabase.from("activities").select("id", { count: "exact", head: true }).in("contact_id", ids),
    ]);
    if (d.error) throw d.error;
    if (a.error) throw a.error;
    return { negocios: d.count ?? 0, atividades: a.count ?? 0 };
  },

  /**
   * Exclui contatos e, quando `comVinculos`, os negócios e atividades deles.
   *
   * A ordem importa: os filhos primeiro, senão o Postgres recusa. E não há
   * transação aqui -- o PostgREST não expõe uma. Se o passo do contato falhar
   * depois de apagar negócios, o resultado é um contato sem negócios, não uma
   * exclusão pela metade que se possa desfazer. É o motivo de a tela pedir
   * confirmação nomeando o que será apagado.
   */
  deleteMany: async (ids: string[], comVinculos = false): Promise<void> => {
    if (comVinculos) {
      const { error: eDeals } = await supabase.from(TABLES.DEALS).delete().in("contact_id", ids);
      if (eDeals) throw eDeals;
      const { error: eAct } = await supabase.from("activities").delete().in("contact_id", ids);
      if (eAct) throw eAct;
    }
    const { error } = await supabase.from(TABLES.CONTACTS).delete().in("id", ids);
    if (error) throw error;
  },

  // `updateStatus` saiu. Era o ÚLTIMO caminho da aplicação para escrever na
  // coluna legada `contacts.status`, e o último consumidor -- o "Aprovar" em
  // lote de Leads -- passou a chamar `qualify_lead`. O gatilho continua
  // mantendo a coluna em dia para quem a leia fora do CRM.

  updateOwner: async (id: string, ownerId: string | null): Promise<void> => {
    const { error } = await supabase.from(TABLES.CONTACTS).update({ owner_id: ownerId }).eq("id", id);
    if (error) throw error;
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
