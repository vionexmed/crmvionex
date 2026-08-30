import { formatarMesAno } from "@/lib/formato";

/**
 * A previsão de fechamento, calculada em um lugar só.
 *
 * Existiam DUAS implementações — `crm/DealsForecast` (aba Previsão em Negócios)
 * e `reports/ForecastReport` (aba Previsão em Relatórios). Usavam os MESMOS
 * limiares e nomes DIFERENTES para a mesma coisa:
 *
 *     prob ≥ 80    "Comprometido"   ·   "Pessimista"
 *     prob ≥ 50    "Melhor caso"    ·   "Realista"
 *     prob ≥ 30    (não existia)    ·   "Otimista"
 *
 * O mesmo R$ 50.000 aparecia como "Comprometido" numa tela e "Pessimista" na
 * outra, e nada dizia que era o mesmo número. Pior: "Pessimista" para a faixa
 * MAIS confiável é contraintuitivo — soa como o pior caso, e é a estimativa que
 * tem mais chance de se confirmar.
 *
 * Vocabulário adotado: o padrão de previsão de vendas — Comprometido, Provável,
 * Possível. Cada nome diz a CONFIANÇA, não o humor de quem olha.
 */

/** Uma faixa de confiança: o piso de probabilidade e como ela se chama. */
export type FaixaPrevisao = {
  chave: "comprometido" | "provavel" | "possivel";
  rotulo: string;
  /** Probabilidade mínima do negócio para entrar nesta faixa. */
  minimo: number;
  /** Classe de cor, na ordem do mais confiável para o menos. */
  cor: string;
  descricao: string;
};

export const FAIXAS_PREVISAO: FaixaPrevisao[] = [
  {
    chave: "comprometido",
    rotulo: "Comprometido",
    minimo: 80,
    cor: "text-success",
    descricao: "Negócios com 80% ou mais de probabilidade",
  },
  {
    chave: "provavel",
    rotulo: "Provável",
    minimo: 50,
    cor: "text-primary",
    descricao: "Negócios com 50% ou mais",
  },
  {
    chave: "possivel",
    rotulo: "Possível",
    minimo: 30,
    cor: "text-warning",
    descricao: "Negócios com 30% ou mais",
  },
];

export type NegocioParaPrevisao = {
  value?: number | string | null;
  probability?: number | string | null;
  close_date?: string | null;
};

export type MesDePrevisao<T> = {
  /** "2026-09" — serve de chave e de critério de ordenação. */
  chave: string;
  /** "setembro de 2026" */
  rotulo: string;
  comprometido: number;
  provavel: number;
  possivel: number;
  /** Todos os negócios abertos do mês, independente da probabilidade. */
  pipeline: number;
  negocios: T[];
};

/** "2026-09", a partir de uma data. */
function chaveDoMes(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Lê `close_date` sem deslocar o mês.
 *
 * `close_date` é uma coluna DATE: o PostgREST devolve "2026-09-01", sem hora.
 * `new Date("2026-09-01")` interpreta isso como meia-noite **UTC** — e no
 * Brasil, UTC−3, isso vira 31 de agosto às 21h. `getMonth()` então devolve
 * agosto.
 *
 * O efeito: TODO negócio que fecha no primeiro dia do mês era contado no mês
 * anterior. As duas implementações originais tinham o defeito, então as duas
 * erravam igual e ninguém comparou.
 *
 * String com hora ("2026-09-01T10:00:00Z") é um instante de verdade e passa
 * direto — nesse caso a conversão para o fuso local é o que se quer.
 */
function lerData(valor: string): Date {
  const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (soData) {
    return new Date(Number(soData[1]), Number(soData[2]) - 1, Number(soData[3]));
  }
  return new Date(valor);
}

/**
 * Agrupa os negócios por mês de fechamento e soma cada faixa.
 *
 * `meses` limita a janela a partir do mês corrente. Sem ele, devolve todos os
 * meses em que há negócio — que é o que a aba de Negócios mostra. O relatório
 * pede 3.
 *
 * Negócio sem `close_date` cai no mês corrente: é o que as duas implementações
 * já faziam, e descartá-lo esconderia valor da soma.
 */
export function calcularPrevisao<T extends NegocioParaPrevisao>(
  negocios: T[],
  opcoes: { meses?: number; hoje?: Date } = {},
): MesDePrevisao<T>[] {
  const hoje = opcoes.hoje ?? new Date();
  const porMes = new Map<string, MesDePrevisao<T>>();

  // Com janela fixa, os meses existem mesmo vazios — senão o gráfico pula de
  // setembro para novembro quando outubro não tem negócio, e a lacuna parece
  // dado em vez de ausência.
  if (opcoes.meses) {
    for (let i = 0; i < opcoes.meses; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
      const chave = chaveDoMes(d);
      porMes.set(chave, {
        chave, rotulo: formatarMesAno(d),
        comprometido: 0, provavel: 0, possivel: 0, pipeline: 0, negocios: [],
      });
    }
  }

  for (const n of negocios) {
    const data = n.close_date ? lerData(n.close_date) : hoje;
    if (isNaN(data.getTime())) continue;
    const chave = chaveDoMes(data);

    let mes = porMes.get(chave);
    if (!mes) {
      // Fora da janela pedida, o negócio é descartado — e é intencional: o
      // relatório de 3 meses não deve somar um fechamento previsto para o ano
      // que vem.
      if (opcoes.meses) continue;
      mes = {
        chave, rotulo: formatarMesAno(data),
        comprometido: 0, provavel: 0, possivel: 0, pipeline: 0, negocios: [],
      };
      porMes.set(chave, mes);
    }

    const valor = Number(n.value) || 0;
    const prob = Number(n.probability) || 0;
    mes.pipeline += valor;
    if (prob >= 80) mes.comprometido += valor;
    if (prob >= 50) mes.provavel += valor;
    if (prob >= 30) mes.possivel += valor;
    mes.negocios.push(n);
  }

  return [...porMes.values()].sort((a, b) => a.chave.localeCompare(b.chave));
}

/** Soma de todos os meses, para os cartões do topo. */
export function totaisDaPrevisao<T>(meses: MesDePrevisao<T>[]) {
  return meses.reduce(
    (acc, m) => ({
      comprometido: acc.comprometido + m.comprometido,
      provavel: acc.provavel + m.provavel,
      possivel: acc.possivel + m.possivel,
      pipeline: acc.pipeline + m.pipeline,
    }),
    { comprometido: 0, provavel: 0, possivel: 0, pipeline: 0 },
  );
}
