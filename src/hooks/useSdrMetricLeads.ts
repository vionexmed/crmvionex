/**
 * Quem está por trás do número de um KPI do painel.
 *
 * useSdrMetrics e useSdrCharts não leem linha nenhuma de propósito: as funções
 * de agregação devolvem só inteiros, e é isso que deixa o painel ser da
 * organização enquanto contato, e-mail e conversa continuam privados.
 *
 * Aqui a identidade sai, então quem chama precisa saber de duas coisas:
 *
 *  1. A lista é recortada pela carteira. Admin recebe a organização; os demais,
 *     só os próprios leads. Logo a lista pode somar MENOS que o card.
 *  2. "Abordagens" conta evento, não lead — 8 abordagens podem ser 3 leads.
 *     Por isso cada linha traz `toques`, e a diferença contra o total do card é
 *     explicada na tela por resumoDrilldown() em vez de ficar calada.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/contexts/AuthContext";
import { getSdrRanges, type SdrPeriod } from "@/hooks/useSdrMetrics";

/** Só estas quatro métricas têm ramo na função sdr_metric_leads. */
export type MetricDrilldownKey =
  | "leadsRecebidos"
  | "abordagens"
  | "taxaResposta"
  | "oportunidades";

export type LinhaDrilldown = {
  id: string;
  tipo: "contact" | "deal";
  titulo: string;
  subtitulo: string | null;
  detalhe: string | null;
  quando: string | null;
  /** Eventos que a linha representa. 1 nas métricas que contam linha. */
  toques: number;
  /** Só taxaResposta preenche. */
  respondeu: boolean | null;
  /** Só oportunidades preenche. */
  valor: number | null;
};

export const sdrMetricLeadsKeys = {
  all: (orgId: string) => ["sdr-metric-leads", orgId] as const,
  um: (orgId: string, metric: MetricDrilldownKey, period: SdrPeriod, limite: number, admin: boolean) =>
    ["sdr-metric-leads", orgId, metric, period, limite, admin] as const,
};

/**
 * @param ativo Só consulta quando true. É o que evita quatro consultas no
 *   carregamento do painel: a lista é buscada quando o hover ou o painel
 *   lateral abre, não antes.
 */
export function useSdrMetricLeads(
  metric: MetricDrilldownKey,
  period: SdrPeriod,
  limite: number,
  ativo: boolean,
) {
  const { orgId } = useOrg();
  const { isAdmin } = useAuth();

  return useQuery<LinhaDrilldown[]>({
    queryKey: sdrMetricLeadsKeys.um(orgId ?? "", metric, period, limite, isAdmin),
    enabled: !!orgId && ativo,
    queryFn: async () => {
      const { current } = getSdrRanges(period);

      // supabase.rpc precisa do `this` — nunca destacar em variável.
      const { data, error } = await supabase.rpc("sdr_metric_leads", {
        _org_id: orgId!,
        _metric: metric,
        _from: current.start ? current.start.toISOString() : undefined,
        _to: current.end ? current.end.toISOString() : undefined,
        _limite: limite,
      });
      if (error) throw error;

      return (data ?? []) as LinhaDrilldown[];
    },
  });
}

export type ResumoDrilldown = {
  /** Quanto do total do card as linhas visíveis representam. */
  visivel: number;
  /** Parte do total que não aparece na lista. Nunca negativo. */
  resto: number;
  /** Frase que explica o resto, ou null quando não há o que explicar. */
  textoResto: string | null;
  /** A lista bateu no limite, então existe mais para ver no painel lateral. */
  truncado: boolean;
};

/**
 * Fecha a conta entre o número do card e a lista.
 *
 * O total já está no card, então nada disso custa consulta extra.
 *
 * A distinção que importa: lista que bateu no limite está TRUNCADA — a
 * diferença é só paginação, e o rodapé "ver todos" já dá conta. Dizer
 * "de outros responsáveis" nesse caso seria mentira. Só quando veio tudo o que
 * é visível é que a diferença significa carteira alheia ou toque sem lead.
 */
export function resumoDrilldown(args: {
  metric: MetricDrilldownKey;
  total: number | null;
  linhas: LinhaDrilldown[];
  limite: number;
  admin: boolean;
}): ResumoDrilldown {
  const { metric, total, linhas, limite, admin } = args;

  const visivel = linhas.reduce((soma, l) => soma + (l.toques || 0), 0);
  const truncado = linhas.length >= limite;

  // Taxa de resposta é percentual: não há total contável para subtrair.
  // O cabeçalho mostra "X de Y responderam" e isso já é a conta completa.
  if (metric === "taxaResposta" || total === null || truncado) {
    return { visivel, resto: 0, textoResto: null, truncado };
  }

  const resto = Math.max(0, total - visivel);
  if (resto === 0) return { visivel, resto: 0, textoResto: null, truncado };

  // contact_id é anulável nas três tabelas de abordagem, então mesmo o admin
  // pode ter toque sem lead a que atribuir.
  const textoResto = admin
    ? `+${resto} sem lead vinculado`
    : `+${resto} de outros responsáveis ou sem lead vinculado`;

  return { visivel, resto, textoResto, truncado };
}
