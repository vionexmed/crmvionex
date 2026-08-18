/**
 * Texto e limites do drill-down dos KPIs.
 *
 * Fora do componente porque são constantes, não UI: exportá-las de um arquivo
 * de componente quebra o fast refresh, e elas são lidas tanto pela prévia do
 * hover quanto pelo painel lateral.
 */
import type { MetricDrilldownKey } from "@/hooks/useSdrMetricLeads";

/** Quantas linhas a prévia do hover mostra, e quantas o painel lateral busca. */
export const PREVIA = 5;
export const COMPLETO = 200;

export const COPY: Record<MetricDrilldownKey, { titulo: string; vazio: string; nota?: string }> = {
  leadsRecebidos: { titulo: "Quem chegou", vazio: "Nenhum lead no período." },
  abordagens: { titulo: "Quem foi abordado", vazio: "Nenhuma abordagem no período." },
  taxaResposta: {
    titulo: "Abordados no período",
    vazio: "Ninguém foi abordado por WhatsApp no período.",
    // A ordem não é cronológica de propósito: numa taxa de resposta, o que gera
    // ação é a lista de quem falta cobrar.
    nota: "sem resposta primeiro",
  },
  oportunidades: { titulo: "Negócios criados", vazio: "Nenhum negócio no período." },
};
