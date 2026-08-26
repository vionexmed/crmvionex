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
  abordagens: {
    // Era "Quem foi abordado", e o título prometia o que a lista não entregava:
    // o número conta EVENTOS, então listar pessoas fazia 4 abordagens caberem em
    // 1 linha. Agora é uma abordagem por linha, com autor, canal e conteúdo.
    titulo: "Abordagens realizadas",
    vazio: "Nenhuma abordagem no período.",
    nota: "mais recentes primeiro",
  },
  taxaResposta: {
    titulo: "Abordados no período",
    vazio: "Ninguém foi abordado por WhatsApp no período.",
    // A ordem não é cronológica de propósito: numa taxa de resposta, o que gera
    // ação é a lista de quem falta cobrar.
    nota: "sem resposta primeiro",
  },
  oportunidades: { titulo: "Negócios criados", vazio: "Nenhum negócio no período." },
};
