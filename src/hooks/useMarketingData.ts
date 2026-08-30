import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import {
  periodDays, dayLabel, lastDaysISO,
  SOURCE_BUCKETS, SOURCE_FALLBACK,
  type PeriodKey, type Campaign, type FunnelStage, type LeadSource,
} from "@/lib/marketing-utils";

/**
 * De onde vêm os números de um canal.
 *
 * Era um tipo de UM valor -- `"real"` -- e os dois canais o usavam, inclusive o
 * Google, cujo `campaigns` é `[]` CRAVADO no código. Um tipo que só tem um
 * valor não distingue nada, e aqui ele estava afirmando que dado inexistente
 * era real.
 */
export type MarketingSource =
  /** Vem de tabela sincronizada. */
  | "real"
  /** A integração não existe ainda -- não é "sem dados no período". */
  | "nao-integrado";

export interface DailyPoint {
  day: string;       // rótulo dd/MM
  spend: number;     // investimento Meta no dia
  leads: number;     // leads (contatos) criados no dia
  conversions: number; // conversões Meta no dia
}

export interface MarketingPayload {
  meta: { campaigns: Campaign[]; source: MarketingSource };
  google: { campaigns: Campaign[]; source: MarketingSource };
  /** Série diária REAL do período (investimento Meta + leads do CRM) */
  daily: DailyPoint[];
  /** Origem dos leads REAL (contacts.metadata.source no período) */
  sources: LeadSource[];
  /** Funil REAL: visitantes → leads → MQL → em negociação → ganhos */
  funnel: FunnelStage[];
  loading: boolean;
  updatedAt: Date;
}

const emptyFunnel: FunnelStage[] = [
  { num: "0", nome: "Visitantes rastreados", desc: "Eventos do pixel do site no período" },
  { num: "0", nome: "Leads captados", desc: "Contatos criados no período" },
  { num: "0", nome: "MQLs qualificados", desc: "Lead scoring ≥ 70" },
  { num: "0", nome: "Negócios abertos", desc: "Criados no período" },
  { num: "0", nome: "Clientes fechados", desc: "Negócios ganhos no período" },
];

/**
 * Busca dados REAIS de marketing: campanhas/insights do Meta Ads,
 * origem dos leads e funil a partir do próprio CRM. Sem mock:
 * quando não há dados, retorna zeros honestos.
 * Google Ads ainda não tem backend → array vazio até integrar.
 */
export function useMarketingData(period: PeriodKey, customDays = 30): MarketingPayload {
  const { orgId } = useOrg();
  const [state, setState] = useState<MarketingPayload>({
    meta: { campaigns: [], source: "real" },
    google: { campaigns: [], source: "nao-integrado" },
    daily: [],
    sources: [],
    funnel: emptyFunnel,
    loading: false,
    updatedAt: new Date(),
  });

  useEffect(() => {
    const days = periodDays(period, customDays);

    if (!orgId) return;

    let cancelled = false;
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);
    const sinceIso = since.toISOString();

    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const [campRes, insightsRes, contactsRes, dealsCreatedRes, dealsWonRes, visitorsRes] = await Promise.all([
          supabase
            .from("meta_campaigns")
            .select("id, meta_campaign_id, name, status, daily_budget")
            .eq("org_id", orgId),
          supabase
            .from("meta_insights")
            .select("campaign_id, date_start, spend, impressions, clicks, conversions, reach")
            .eq("org_id", orgId)
            .eq("level", "campaign")
            .gte("date_start", sinceStr),
          supabase
            .from("contacts")
            .select("created_at, lead_score, metadata")
            .eq("org_id", orgId)
            .gte("created_at", sinceIso)
            .limit(5000),
          supabase
            .from("deals")
            .select("id", { count: "exact", head: true })
            .eq("org_id", orgId)
            .gte("created_at", sinceIso),
          supabase
            .from("deals")
            .select("id", { count: "exact", head: true })
            .eq("org_id", orgId)
            .eq("status", "won")
            .gte("updated_at", sinceIso),
          supabase
            .from("tracking_events")
            .select("id", { count: "exact", head: true })
            .eq("org_id", orgId)
            .gte("created_at", sinceIso),
        ]);

        if (cancelled) return;

        const campRows = campRes.data ?? [];
        const insights = insightsRes.data ?? [];
        const contacts = contactsRes.data ?? [];

        // ── Campanhas Meta agregadas no período ──
        const agg = new Map<string, { spend: number; imp: number; clicks: number; conv: number; reach: number }>();
        insights.forEach((r: any) => {
          const k = r.campaign_id;
          if (!k) return;
          const cur = agg.get(k) || { spend: 0, imp: 0, clicks: 0, conv: 0, reach: 0 };
          cur.spend += Number(r.spend || 0);
          cur.imp += Number(r.impressions || 0);
          cur.clicks += Number(r.clicks || 0);
          cur.conv += Number(r.conversions || 0);
          cur.reach += Number(r.reach || 0);
          agg.set(k, cur);
        });

        const mapped: Campaign[] = campRows.map((c: any) => {
          const a = agg.get(c.id) || { spend: 0, imp: 0, clicks: 0, conv: 0, reach: 0 };
          const ctr = a.imp ? (a.clicks / a.imp) * 100 : 0;
          const cpc = a.clicks ? a.spend / a.clicks : 0;
          const cpm = a.imp ? (a.spend / a.imp) * 1000 : 0;
          const cpl = a.conv ? a.spend / a.conv : 0;
          const cvr = a.clicks ? (a.conv / a.clicks) * 100 : 0;
          return {
            id: c.id,
            nome: c.name || c.meta_campaign_id,
            plataforma: "meta" as const,
            tipo: "Meta Ads",
            status: (c.status?.toLowerCase().includes("paus")
              ? "pausado"
              : c.status?.toLowerCase().includes("learn")
              ? "aprendendo"
              : "ativo") as Campaign["status"],
            formato: "Meta",
            investido: Math.round(a.spend),
            impressoes: a.imp,
            alcance: a.reach,
            frequencia: a.reach ? a.imp / a.reach : 0,
            cpm,
            cliques: a.clicks,
            cpc,
            ctr,
            conversoes: a.conv,
            cvr,
            cpl,
            receita_atrib: 0, // sem atribuição de receita até integrar conversão de pipeline
            roas: 0,
          };
        });

        // ── Série diária real: investimento/conversões (Meta) + leads (CRM) ──
        const spendByDay = new Map<string, { spend: number; conv: number }>();
        insights.forEach((r: any) => {
          const d = String(r.date_start).slice(0, 10);
          const cur = spendByDay.get(d) || { spend: 0, conv: 0 };
          cur.spend += Number(r.spend || 0);
          cur.conv += Number(r.conversions || 0);
          spendByDay.set(d, cur);
        });
        const leadsByDay = new Map<string, number>();
        contacts.forEach((c: any) => {
          const d = String(c.created_at).slice(0, 10);
          leadsByDay.set(d, (leadsByDay.get(d) || 0) + 1);
        });
        const daily: DailyPoint[] = lastDaysISO(days).map((iso) => ({
          day: dayLabel(iso),
          spend: Math.round((spendByDay.get(iso)?.spend || 0) * 100) / 100,
          conversions: spendByDay.get(iso)?.conv || 0,
          leads: leadsByDay.get(iso) || 0,
        }));

        // ── Origem dos leads real (metadata.source) ──
        const counts = new Map<string, number>();
        contacts.forEach((c: any) => {
          const raw = String((c.metadata as any)?.source || "").toLowerCase();
          const bucket = SOURCE_BUCKETS.find((b) => raw && b.match(raw));
          const name = bucket?.name ?? SOURCE_FALLBACK.name;
          counts.set(name, (counts.get(name) || 0) + 1);
        });
        const totalLeads = contacts.length;
        const sources: LeadSource[] = [...SOURCE_BUCKETS.map(({ name, color }) => ({ name, color })), SOURCE_FALLBACK]
          .map((b) => ({
            ...b,
            count: counts.get(b.name) || 0,
            pct: totalLeads ? Math.round(((counts.get(b.name) || 0) / totalLeads) * 100) : 0,
          }))
          .filter((s) => s.count > 0);

        // ── Funil real ──
        const mqls = contacts.filter((c: any) => Number(c.lead_score || 0) >= 70).length;
        const funnel: FunnelStage[] = [
          { num: String(visitorsRes.count ?? 0), nome: "Visitantes rastreados", desc: "Eventos do pixel do site no período" },
          { num: String(totalLeads), nome: "Leads captados", desc: "Contatos criados no período" },
          { num: String(mqls), nome: "MQLs qualificados", desc: "Lead scoring ≥ 70" },
          { num: String(dealsCreatedRes.count ?? 0), nome: "Negócios abertos", desc: "Criados no período" },
          { num: String(dealsWonRes.count ?? 0), nome: "Clientes fechados", desc: "Negócios ganhos no período" },
        ];

        setState({
          meta: { campaigns: mapped, source: "real" },
          google: { campaigns: [], source: "nao-integrado" },
          daily,
          sources,
          funnel,
          loading: false,
          updatedAt: new Date(),
        });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orgId, period, customDays]);

  return state;
}
