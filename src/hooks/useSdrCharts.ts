/**
 * Dados dos gráficos do painel de SDR.
 *
 * Mesma regra do useSdrMetrics: nada de ler linha. Cada gráfico vem de uma
 * função de agregação SECURITY DEFINER, porque é isso que permite o painel ser
 * compartilhado enquanto contatos, e-mails e conversas continuam privados.
 *
 * Uma consulta só para os quatro gráficos, em Promise.all — e a série alimenta
 * também os minigráficos dos tiles, sem chamada extra.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useAuth } from "@/contexts/AuthContext";
import { getSdrRanges, type SdrPeriod } from "@/hooks/useSdrMetrics";

export type PontoSerie = { dia: string; leads: number; abordagens: number; respostas: number };
export type EtapaFunil = { etapa: string; ordem: number; total: number };
export type FatiaCanal = { canal: string; total: number };
export type LinhaPessoa = {
  pessoa: string; leads: number; abordagens: number; reunioes: number; vendas: number;
};

export type SdrCharts = {
  serie: PontoSerie[];
  funil: EtapaFunil[];
  canais: FatiaCanal[];
  /** null quando quem está olhando não é admin — desempenho individual é restrito. */
  pessoas: LinhaPessoa[] | null;
};

export const sdrChartsKeys = {
  all: (orgId: string) => ["sdr-charts", orgId] as const,
  period: (orgId: string, period: SdrPeriod, admin: boolean) =>
    ["sdr-charts", orgId, period, admin] as const,
};

export function useSdrCharts(period: SdrPeriod) {
  const { orgId } = useOrg();
  const { isAdmin } = useAuth();

  return useQuery<SdrCharts>({
    queryKey: sdrChartsKeys.period(orgId ?? "", period, isAdmin),
    enabled: !!orgId,
    /**
     * SEMPRE revalida ao abrir o painel.
     *
     * O `staleTime` global é de 5 minutos, então importar 93 contatos e navegar
     * para o painel mostrava o número de ANTES -- e o sintoma engana: parece que
     * a importação não funcionou. A pessoa reimporta, e aí produz duplicata ou
     * "já estavam cadastrados", dois caminhos ruins a partir de um número velho.
     *
     * O custo é uma ida ao banco por visita ao painel. Aceito: número de painel
     * desatualizado é pior que uma consulta a mais, porque decisão se toma
     * olhando ele.
     */
    refetchOnMount: "always",
    queryFn: async () => {
      const { current } = getSdrRanges(period);
      const args = {
        _org_id: orgId!,
        _from: current.start ? current.start.toISOString() : undefined,
        _to: current.end ? current.end.toISOString() : undefined,
      };

      const [serie, funil, canais, pessoas] = await Promise.all([
        supabase.rpc("sdr_series", args),
        supabase.rpc("sdr_funnel", args),
        supabase.rpc("sdr_by_channel", args),
        isAdmin ? supabase.rpc("sdr_by_owner", args) : Promise.resolve({ data: null, error: null }),
      ]);

      if (serie.error) throw serie.error;
      if (funil.error) throw funil.error;
      if (canais.error) throw canais.error;
      // Desempenho por pessoa pode falhar por permissão sem derrubar o painel.
      if (pessoas.error) console.warn("[useSdrCharts] desempenho por pessoa indisponível", pessoas.error);

      return {
        serie: (serie.data ?? []) as PontoSerie[],
        funil: (funil.data ?? []) as EtapaFunil[],
        canais: (canais.data ?? []) as FatiaCanal[],
        pessoas: pessoas.error ? null : ((pessoas.data ?? null) as LinhaPessoa[] | null),
      };
    },
  });
}
