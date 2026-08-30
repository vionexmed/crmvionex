import { formatarMoedaInteira, formatarNumero } from "@/lib/formato";
/**
 * Utilitários e tipos do módulo de marketing.
 * Substitui o antigo marketingMockData.ts — que misturava utilitários com
 * dados de demonstração inventados exibidos como se fossem reais.
 */

export const fmtBRL = (n: number) =>
  formatarMoedaInteira(n);

export const fmtNum = (n: number) => formatarNumero(n);
export const fmtPct = (n: number) => `${n.toFixed(2)}%`;

export type Campaign = {
  id: string;
  nome: string;
  plataforma: "meta" | "google";
  tipo: string;
  status: "ativo" | "pausado" | "aprendendo";
  formato: string;
  investido: number;
  impressoes: number;
  alcance: number;
  frequencia: number;
  cpm: number;
  cliques: number;
  cpc: number;
  ctr: number;
  conversoes: number;
  cvr: number;
  cpl: number;
  receita_atrib: number;
  roas: number;
  quality_score?: number;
  impression_share?: number;
};

export const sumBy = <T,>(arr: T[], key: keyof T) =>
  arr.reduce((acc, item) => acc + (Number(item[key]) || 0), 0);

export type PeriodKey = "7d" | "30d" | "90d" | "custom";

export const periodDays = (key: PeriodKey, customDays = 30) =>
  key === "7d" ? 7 : key === "30d" ? 30 : key === "90d" ? 90 : Math.max(1, customDays);

/** Rótulo curto dd/MM para eixos de gráficos */
export const dayLabel = (iso: string) => {
  const d = new Date(iso + "T12:00:00");
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** Lista de dias (ISO yyyy-mm-dd) do período, do mais antigo ao mais recente */
export const lastDaysISO = (days: number): string[] => {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

export type FunnelStage = { num: string; nome: string; desc: string };
export type LeadSource = { name: string; color: string; count: number; pct: number };

/** Classificação de origem do lead (metadata.source) em canais do gráfico */
export const SOURCE_BUCKETS: { name: string; color: string; match: (s: string) => boolean }[] = [
  { name: "Meta Ads", color: "#1877F2", match: (s) => /meta|facebook|instagram|fb_|ig_/.test(s) },
  { name: "Google Ads", color: "#EA4335", match: (s) => /google|gads|adwords/.test(s) },
  { name: "Orgânico / SEO", color: "#0A6640", match: (s) => /organico|orgânico|seo|site|landing/.test(s) },
  { name: "Email", color: "#007B8A", match: (s) => /email|newsletter/.test(s) },
  { name: "Indicação", color: "#5B21B6", match: (s) => /indicacao|indicação|referral/.test(s) },
];
export const SOURCE_FALLBACK: Omit<LeadSource, "count" | "pct"> = { name: "Direto / Outros", color: "#9AA3B0" };
