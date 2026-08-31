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
  day: string;         // rótulo dd/MM
  /** Investimento TOTAL do dia (Meta + Google), em reais. */
  spend: number;
  /**
   * Por plataforma, e é o que o gráfico usa.
   *
   * `spend` sozinho não bastava: o gráfico de evolução desenha uma linha por
   * plataforma, e colapsar as duas somas daria a impressão de um orçamento só
   * -- perdendo justamente a comparação que a tela existe para fazer.
   */
  spendMeta: number;
  spendGoogle: number;
  leads: number;       // leads (contatos) criados no dia
  conversions: number; // conversões do dia, somando as plataformas
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

    /**
     * Cliente com forma SOLTA, para as tabelas do Google Ads.
     *
     * `types.ts` é um retrato do banco no momento da geração, e essas tabelas
     * nascem numa migração que ainda não foi aplicada — então o nome não existe
     * na união de literais que o `from()` aceita.
     *
     * O cast é na FORMA da chamada, e a leitura do dado adiante é explícita:
     * não há `any` no caminho do valor, e o `unknown[]` obriga a checagem.
     */
    const solto = supabase as unknown as {
      from(tabela: string): {
        select(colunas: string): {
          eq(coluna: string, valor: string): {
            gte(coluna: string, valor: string): PromiseLike<{ data: unknown[] | null; error: unknown }>;
          } & PromiseLike<{ data: unknown[] | null; error: unknown }>;
        };
      };
    };

    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const [
          campRes, insightsRes, contactsRes, dealsCreatedRes, dealsWonRes, visitorsRes,
          gCampRes, gInsightsRes,
        ] = await Promise.all([
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

          // ── Google Ads ──
          // As tabelas podem não existir ainda (migração não aplicada) ou vir
          // vazias (sem sync). Os dois casos são tratados como "não integrado"
          // adiante, e nenhum derruba o painel do Meta.
          solto
            .from("google_ads_campaigns")
            .select("id, google_campaign_id, name, status, channel_type, daily_budget")
            .eq("org_id", orgId),
          solto
            .from("google_ads_insights")
            .select("campaign_id, dia, spend, impressions, clicks, conversions, conversion_value")
            .eq("org_id", orgId)
            .gte("dia", sinceStr),
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

        // ── Google Ads ──
        //
        // Espelha o mapeamento do Meta de propósito: o painel soma os dois lado
        // a lado, e formas diferentes obrigariam a tela a saber de qual
        // plataforma cada número veio para poder lê-lo.
        //
        // Os valores JÁ vêm em reais: a divisão por 1.000.000 (micros) acontece
        // na edge function, não aqui. Fazer duas vezes dividiria de novo.
        type LinhaGCamp = {
          id: string; google_campaign_id: string; name: string;
          status: string | null; channel_type: string | null; daily_budget: number | null;
        };
        type LinhaGIns = {
          campaign_id: string; dia: string; spend: number | null;
          impressions: number | null; clicks: number | null;
          conversions: number | null; conversion_value: number | null;
        };

        const gCamps = (gCampRes.data ?? []) as LinhaGCamp[];
        const gIns = (gInsightsRes.data ?? []) as LinhaGIns[];

        const gAgg = new Map<string, { spend: number; imp: number; clicks: number; conv: number; receita: number }>();
        for (const r of gIns) {
          const a = gAgg.get(r.campaign_id) ?? { spend: 0, imp: 0, clicks: 0, conv: 0, receita: 0 };
          a.spend += Number(r.spend ?? 0);
          a.imp += Number(r.impressions ?? 0);
          a.clicks += Number(r.clicks ?? 0);
          a.conv += Number(r.conversions ?? 0);
          a.receita += Number(r.conversion_value ?? 0);
          gAgg.set(r.campaign_id, a);
        }

        const googleCampaigns: Campaign[] = gCamps.map((c) => {
          const a = gAgg.get(c.google_campaign_id) ?? { spend: 0, imp: 0, clicks: 0, conv: 0, receita: 0 };
          const ctr = a.imp ? (a.clicks / a.imp) * 100 : 0;
          const cpc = a.clicks ? a.spend / a.clicks : 0;
          return {
            id: c.id,
            nome: c.name || c.google_campaign_id,
            plataforma: "google" as const,
            // O tipo de canal é a informação que o Google dá e o Meta não:
            // Search, Display e YouTube têm comportamentos diferentes, e
            // chamar tudo de "Google Ads" jogaria isso fora.
            tipo: c.channel_type
              ? c.channel_type.replace(/_/g, " ").toLowerCase().replace(/^./, (m) => m.toUpperCase())
              : "Google Ads",
            status: (c.status?.toUpperCase() === "ENABLED"
              ? "ativo"
              : c.status?.toUpperCase() === "PAUSED"
              ? "pausado"
              : "pausado") as Campaign["status"],
            formato: "Google",
            investido: Math.round(a.spend),
            impressoes: a.imp,
            // O Google Ads NÃO reporta alcance por campanha na consulta básica.
            // Zero aqui significa "não medido", e é por isso que a tela mostra
            // frequência zero em vez de inventar uma divisão.
            alcance: 0,
            frequencia: 0,
            cpm: a.imp ? (a.spend / a.imp) * 1000 : 0,
            cliques: a.clicks,
            cpc,
            ctr,
            conversoes: a.conv,
            cvr: a.clicks ? (a.conv / a.clicks) * 100 : 0,
            cpl: a.conv ? a.spend / a.conv : 0,
            // Aqui o Google É melhor que o Meta: `conversions_value` vem da
            // própria plataforma, então há receita atribuída de verdade.
            receita_atrib: Math.round(a.receita),
            roas: a.spend ? a.receita / a.spend : 0,
          };
        });

        // ── Série diária real: investimento/conversões (Meta) + leads (CRM) ──
        const vazio = () => ({ meta: 0, google: 0, conv: 0 });
        const spendByDay = new Map<string, ReturnType<typeof vazio>>();
        insights.forEach((r: any) => {
          const d = String(r.date_start).slice(0, 10);
          const cur = spendByDay.get(d) ?? vazio();
          cur.meta += Number(r.spend || 0);
          cur.conv += Number(r.conversions || 0);
          spendByDay.set(d, cur);
        });
        // O Google acumula SEPARADO, na mesma chave de dia: o gráfico desenha
        // uma linha por plataforma, e somar aqui perderia a comparação.
        for (const r of gIns) {
          const d = String(r.dia).slice(0, 10);
          const cur = spendByDay.get(d) ?? vazio();
          cur.google += Number(r.spend ?? 0);
          cur.conv += Number(r.conversions ?? 0);
          spendByDay.set(d, cur);
        }
        const leadsByDay = new Map<string, number>();
        contacts.forEach((c: any) => {
          const d = String(c.created_at).slice(0, 10);
          leadsByDay.set(d, (leadsByDay.get(d) || 0) + 1);
        });
        const centavos = (v: number) => Math.round(v * 100) / 100;
        const daily: DailyPoint[] = lastDaysISO(days).map((iso) => {
          const d = spendByDay.get(iso) ?? { meta: 0, google: 0, conv: 0 };
          return {
            day: dayLabel(iso),
            spend: centavos(d.meta + d.google),
            spendMeta: centavos(d.meta),
            spendGoogle: centavos(d.google),
            conversions: d.conv,
            leads: leadsByDay.get(iso) || 0,
          };
        });

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
          // `real` só quando há campanha sincronizada. Sem isso o painel
          // anunciaria "integrado" com tudo zerado, que foi exatamente o
          // defeito anterior: `campaigns: []` com `source: "real"`.
          google: googleCampaigns.length > 0
            ? { campaigns: googleCampaigns, source: "real" as const }
            : { campaigns: [], source: "nao-integrado" as const },
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
