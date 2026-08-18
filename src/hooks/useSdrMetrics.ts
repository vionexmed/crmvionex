/**
 * Métricas do painel de SDR.
 *
 * O painel é COMPARTILHADO — todos veem os números da empresa — enquanto as
 * linhas (contato, e-mail, conversa de WhatsApp) são privadas por pessoa via
 * RLS. As duas coisas juntas só são possíveis porque este hook não lê tabela:
 * ele chama a função `sdr_metrics`, que é SECURITY DEFINER e devolve apenas
 * números. Nenhuma linha, nenhum identificador, nada de quem é o quê.
 *
 * Contrato de valor:
 *  - number → valor real.
 *  - null   → não calculável: a métrica não tem fonte no banco (ver SEM_FONTE),
 *             ou o período não tem dado para uma razão/média. Nunca devolvemos
 *             0 para "não sei" — 0 é um zero de verdade.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";

// ── Período ───────────────────────────────────────────────────────────────────
// Vocabulário próprio (superset do PeriodFilter de reports/types.ts): um painel
// de SDR precisa de "hoje" e "esta semana", e precisa do período ANTERIOR para
// a comparação — que getPeriodRange não fornece.
export type SdrPeriod =
  | "today" | "this_week" | "this_month" | "last_month"
  | "this_quarter" | "this_year" | "all";

export const SDR_PERIOD_LABELS: Record<SdrPeriod, string> = {
  today: "Hoje",
  this_week: "Esta semana",
  this_month: "Este mês",
  last_month: "Mês passado",
  this_quarter: "Este trimestre",
  this_year: "Este ano",
  all: "Todo o período",
};

/** Intervalo semiaberto [start, end) — evita perder o último dia do período. */
export type Range = { start: Date | null; end: Date | null };

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function getSdrRanges(period: SdrPeriod): { current: Range; previous: Range | null } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (period) {
    case "today": {
      const start = startOfDay(now);
      const end = new Date(start.getTime() + DAY);
      return { current: { start, end }, previous: { start: new Date(start.getTime() - DAY), end: start } };
    }
    case "this_week": {
      // Semana comercial começa na segunda-feira.
      const offsetToMonday = (now.getDay() + 6) % 7;
      const start = startOfDay(new Date(y, m, now.getDate() - offsetToMonday));
      const end = new Date(start.getTime() + 7 * DAY);
      return { current: { start, end }, previous: { start: new Date(start.getTime() - 7 * DAY), end: start } };
    }
    case "this_month": {
      const start = new Date(y, m, 1);
      return { current: { start, end: new Date(y, m + 1, 1) }, previous: { start: new Date(y, m - 1, 1), end: start } };
    }
    case "last_month": {
      const start = new Date(y, m - 1, 1);
      return { current: { start, end: new Date(y, m, 1) }, previous: { start: new Date(y, m - 2, 1), end: start } };
    }
    case "this_quarter": {
      const q = Math.floor(m / 3) * 3;
      const start = new Date(y, q, 1);
      return { current: { start, end: new Date(y, q + 3, 1) }, previous: { start: new Date(y, q - 3, 1), end: start } };
    }
    case "this_year": {
      const start = new Date(y, 0, 1);
      return { current: { start, end: new Date(y + 1, 0, 1) }, previous: { start: new Date(y - 1, 0, 1), end: start } };
    }
    default:
      // "Todo o período" não tem período anterior com que comparar.
      return { current: { start: null, end: null }, previous: null };
  }
}

// ── Métricas ──────────────────────────────────────────────────────────────────
export type MetricKey =
  | "leadsRecebidos"
  | "abordagens"
  | "taxaEntrega"
  | "taxaResposta"
  | "conversasIniciadas"
  | "qualificadosIA"
  | "transferidosHumano"
  | "reunioes"
  | "oportunidades"
  | "vendasSdr"
  | "tempoRespostaMin"
  | "aguardandoHumano"
  | "leadsInstagram"
  | "leadsWhatsapp"
  | "leadsGoogle"
  | "leadsLinkedin";

export type MetricValue = { value: number | null; previous: number | null };

export type SdrMetrics = { metrics: Record<MetricKey, MetricValue> };

/** Métricas sem nenhuma fonte de dado no banco hoje. Sempre null. */
const SEM_FONTE: MetricKey[] = [
  "qualificadosIA",
  "transferidosHumano",
  "leadsInstagram",
  "leadsGoogle",
  "leadsLinkedin",
];

/** Fila do momento — o valor é "agora", então não há período anterior. */
const SEM_COMPARACAO: MetricKey[] = ["aguardandoHumano"];

/** Retorno da função sdr_metrics, em snake_case como vem do banco. */
type SdrMetricsRow = {
  leads_recebidos: number;
  abordagens: number;
  taxa_entrega: number | null;
  taxa_resposta: number | null;
  conversas_iniciadas: number;
  reunioes: number;
  oportunidades: number;
  vendas_sdr: number;
  tempo_resposta_min: number | null;
  aguardando_humano: number;
  leads_whatsapp: number;
};

/** De-para entre a chave do tile e a coluna devolvida pela função. */
const COLUNA: Partial<Record<MetricKey, keyof SdrMetricsRow>> = {
  leadsRecebidos: "leads_recebidos",
  abordagens: "abordagens",
  taxaEntrega: "taxa_entrega",
  taxaResposta: "taxa_resposta",
  conversasIniciadas: "conversas_iniciadas",
  reunioes: "reunioes",
  oportunidades: "oportunidades",
  vendasSdr: "vendas_sdr",
  tempoRespostaMin: "tempo_resposta_min",
  aguardandoHumano: "aguardando_humano",
  leadsWhatsapp: "leads_whatsapp",
};

async function fetchRange(orgId: string, range: Range): Promise<SdrMetricsRow | null> {
  const { data, error } = await supabase.rpc("sdr_metrics", {
    _org_id: orgId,
    _from: range.start ? range.start.toISOString() : undefined,
    _to: range.end ? range.end.toISOString() : undefined,
  });
  if (error) throw error;
  // RETURNS TABLE devolve array; a função sempre produz uma linha só.
  return (data as SdrMetricsRow[] | null)?.[0] ?? null;
}

export const sdrMetricsKeys = {
  all: (orgId: string) => ["sdr-metrics", orgId] as const,
  period: (orgId: string, period: SdrPeriod) => ["sdr-metrics", orgId, period] as const,
};

export function useSdrMetrics(period: SdrPeriod) {
  const { orgId } = useOrg();

  return useQuery<SdrMetrics>({
    queryKey: sdrMetricsKeys.period(orgId ?? "", period),
    enabled: !!orgId,
    queryFn: async () => {
      const { current, previous } = getSdrRanges(period);

      const [atual, anterior] = await Promise.all([
        fetchRange(orgId!, current),
        previous ? fetchRange(orgId!, previous) : Promise.resolve(null),
      ]);

      const metrics = {} as Record<MetricKey, MetricValue>;

      for (const key of Object.keys(COLUNA) as MetricKey[]) {
        const coluna = COLUNA[key]!;
        metrics[key] = {
          value: atual ? (atual[coluna] ?? null) : null,
          previous:
            anterior && !SEM_COMPARACAO.includes(key) ? (anterior[coluna] ?? null) : null,
        };
      }

      for (const key of SEM_FONTE) metrics[key] = { value: null, previous: null };

      return { metrics };
    },
  });
}
