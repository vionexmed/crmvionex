import { supabase } from "@/integrations/supabase/client";
import { buscarEmBlocos } from "@/lib/paginar";

export type Email = {
  id: string;
  org_id: string;
  user_id: string | null;
  contact_id: string | null;
  deal_id: string | null;
  company_id: string | null;
  direction: string;
  subject: string | null;
  body_html: string | null;
  from_email: string | null;
  to_emails: string[];
  cc_emails: string[];
  bcc_emails: string[];
  status: string;
  open_count: number;
  click_count: number;
  last_opened_at: string | null;
  last_clicked_at: string | null;
  thread_id: string | null;
  message_id: string | null;
  provider: string | null;
  is_read: boolean;
  snoozed_until: string | null;
  is_archived: boolean;
  is_starred?: boolean;
  is_spam?: boolean;
  is_trashed?: boolean;
  importance?: string | null;
  /** Conta da empresa de onde o e-mail veio/saiu (separa comercial × marketing) */
  synced_from?: string | null;
  sent_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  attachments?: Array<{ filename: string; mime_type: string; size: number; attachment_id: string }>;
};

export type InboxContact = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  avatar_url: string | null;
  lifecycle_stage: string | null;
  org_id: string;
};

export const emailsApi = {
  list: async (orgId: string): Promise<Email[]> => {
    const { data, error } = await supabase
      .from("emails")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(200); // carga inicial menor; paginação por pasta fica para iteração futura
    if (error) throw error;
    // O tipo local Email é um recorte da linha gerada; não se sobrepõe o
    // bastante para cast direto depois que a tabela ganhou colunas novas.
    return (data as unknown as Email[]) ?? [];
  },

  update: async (id: string, patch: Partial<Email>): Promise<void> => {
    const { error } = await supabase.from("emails").update(patch as any).eq("id", id);
    if (error) throw error;
  },

  deleteById: async (id: string): Promise<void> => {
    const { error } = await supabase.from("emails").delete().eq("id", id);
    if (error) throw error;
  },

  batchUpdate: async (ids: string[], patch: Partial<Email>): Promise<void> => {
    const { error } = await supabase.from("emails").update(patch as any).in("id", ids);
    if (error) throw error;
  },
};

export type EmailConnection = {
  id: string;
  org_id: string;
  user_id: string;
  provider: string;
  email_address: string;
  label?: string | null;
  purpose?: string | null;
  from_name?: string | null;
  signature_html?: string | null;
  last_synced_at?: string | null;
  is_active: boolean | null;
  connected_at: string | null;
};

export const emailConnectionsApi = {
  list: async (orgId: string): Promise<EmailConnection[]> => {
    const { data, error } = await supabase
      .from("email_connections")
      .select("*")
      .eq("org_id", orgId)
      .eq("is_active", true);
    if (error) throw error;
    return (data as unknown as EmailConnection[]) ?? [];
  },
};

export const inboxContactsApi = {
  list: async (orgId: string): Promise<InboxContact[]> => {
    // Baixava a organização INTEIRA e sem teto, então acima de mil contatos o
    // PostgREST cortava em silêncio e o destinatário sumia do seletor.
    //
    // `lifecycle_stage`, não `status`: a coluna legada tem 4 valores contra 6.
    return buscarEmBlocos<InboxContact>((inicio, fim) =>
      supabase
        .from("contacts")
        .select("id, first_name, last_name, email, avatar_url, lifecycle_stage, org_id")
        .eq("org_id", orgId)
        .order("first_name", { ascending: true })
        .range(inicio, fim),
    );
  },
};
