import { supabase } from "@/integrations/supabase/client";
import { TABLES } from "@/lib/constants";
import type { Database } from "@/integrations/supabase/types";

type Activity = Database["public"]["Tables"]["activities"]["Row"];
type ActivityInsert = Database["public"]["Tables"]["activities"]["Insert"];
type ActivityUpdate = Database["public"]["Tables"]["activities"]["Update"];

export type { Activity, ActivityInsert, ActivityUpdate };

export const activitiesApi = {
  listByDeal: async (dealId: string): Promise<Activity[]> => {
    const { data, error } = await supabase
      .from(TABLES.ACTIVITIES)
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  lastPerContact: async (orgId: string): Promise<Map<string, Date>> => {
    const { data, error } = await supabase
      .from(TABLES.ACTIVITIES)
      .select("contact_id,created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const map = new Map<string, Date>();
    (data || []).forEach((a) => {
      if (a.contact_id && a.created_at) {
        const d = new Date(a.created_at);
        const existing = map.get(a.contact_id);
        if (!existing || d > existing) map.set(a.contact_id, d);
      }
    });
    return map;
  },

  list: async (orgId: string, type?: Activity["type"]): Promise<Activity[]> => {
    let query = supabase
      .from(TABLES.ACTIVITIES)
      .select("*")
      .eq("org_id", orgId)
      .order("due_date", { ascending: true, nullsFirst: false });
    if (type) query = query.eq("type", type); // filtra no servidor (Tarefas não precisa baixar tudo)
    // Teto explícito.
    //
    // Sem ele o PostgREST corta em 1000 EM SILÊNCIO -- a atividade some da tela
    // e não há como saber por quê. Já mordeu duas vezes neste projeto (a lista
    // de contatos e o seletor de Atividades). Declarar 1000 não muda o
    // resultado; muda o fato de o corte ser uma DECISÃO em vez de um efeito
    // colateral, e deixa o lugar certo para paginar quando a base pedir.
    const { data, error } = await query.limit(1000);
    if (error) throw error;
    return data ?? [];
  },

  create: async (activity: ActivityInsert): Promise<Activity> => {
    const { data, error } = await supabase
      .from(TABLES.ACTIVITIES)
      .insert(activity)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  update: async (id: string, activity: ActivityUpdate): Promise<Activity> => {
    const { data, error } = await supabase
      .from(TABLES.ACTIVITIES)
      .update(activity)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  delete: async (id: string): Promise<void> => {
    const { error } = await supabase
      .from(TABLES.ACTIVITIES)
      .delete()
      .eq("id", id);
    if (error) throw error;
  },

  deleteMany: async (ids: string[]): Promise<void> => {
    const { error } = await supabase
      .from(TABLES.ACTIVITIES)
      .delete()
      .in("id", ids);
    if (error) throw error;
  },
};
