import { formatarMoedaInteira } from "@/lib/formato";
// ── Types ─────────────────────────────────────
export type Stage = { id: string; name: string; order: number; color: string | null; win_probability: number | null; pipeline_id: string };
export type Deal = {
  id: string; title: string; value: number | null; stage_id: string | null;
  status: string | null; loss_reason: string | null; owner_id: string | null;
  created_at: string | null; updated_at: string | null; close_date: string | null;
  probability: number | null; company_id: string | null; contact_id: string | null;
  currency: string | null;
};
export type Profile = { id: string; name: string | null; email: string | null };
export type Pipeline = { id: string; name: string; is_default: boolean | null };
export type ActivityRow = {
  id: string; type: string; title: string; due_date: string | null;
  completed_at: string | null; created_at: string | null; user_id: string | null;
};
/**
 * `lifecycle_stage`, não `status`.
 *
 * A coluna `status` é LEGADO, tem 4 valores contra os 6 de `lifecycle_stage`, e
 * o gatilho que sincroniza as duas mapeia com PERDA: `contacted` colapsa em
 * `lead`, `opportunity` colapsa em `prospect`. Relatório lendo `status` conta
 * quatro grupos onde a tela de Contatos mostra seis.
 *
 * Fora do tipo de propósito: enquanto `status` estiver aqui, alguém volta a ler.
 */
export type Contact = { id: string; first_name: string; last_name: string | null; lifecycle_stage: string | null; lead_score: number | null; created_at: string | null; owner_id: string | null; };
export type Company = { id: string; name: string };

export type PeriodFilter = "all" | "this_month" | "last_month" | "this_quarter" | "this_year";

// ── Helpers ───────────────────────────────────
/**
 * Mantido como `fmt` porque nove componentes de relatório importam este nome.
 * O que muda é a implementação: era o décimo `Intl.NumberFormat` construído a
 * cada chamada, agora usa o formatador em cache do módulo compartilhado.
 */
export const fmt = (v: number) => formatarMoedaInteira(v);

export const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export const CHART_COLORS = [
  "hsl(217, 91%, 60%)", "hsl(142, 76%, 36%)", "hsl(38, 92%, 50%)",
  "hsl(0, 84%, 60%)", "hsl(262, 83%, 58%)", "hsl(190, 95%, 39%)",
  "hsl(326, 78%, 55%)", "hsl(25, 95%, 53%)",
];

export const tooltipStyle = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "var(--radius)",
  color: "hsl(var(--popover-foreground))",
  fontSize: 11,
};

export const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function getPeriodRange(period: PeriodFilter): { start: Date | null; end: Date | null } {
  const now = new Date();
  switch (period) {
    case "this_month": return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null };
    case "last_month": return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 0) };
    case "this_quarter": return { start: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1), end: null };
    case "this_year": return { start: new Date(now.getFullYear(), 0, 1), end: null };
    default: return { start: null, end: null };
  }
}

export function inPeriod(dateStr: string | null, range: { start: Date | null; end: Date | null }): boolean {
  if (!dateStr) return !range.start;
  const d = new Date(dateStr);
  if (range.start && d < range.start) return false;
  if (range.end && d > range.end) return false;
  return true;
}

export function downloadCSV(rows: Record<string, any>[], filename: string) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))
  ].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `${filename}.csv`; a.click();
  URL.revokeObjectURL(url);
}
