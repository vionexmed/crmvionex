/**
 * Formatadores de dinheiro e data, em um lugar só.
 *
 * `formatCurrency` estava reescrito em **13 arquivos**, e em 12 deles o
 * `Intl.NumberFormat` era construído DENTRO da função — ou seja, um formatador
 * novo por célula renderizada. Construir `Intl.NumberFormat` é caro; numa tabela
 * de 50 linhas com 3 colunas de valor, são 150 construções por render.
 *
 * Data era pior: `toLocaleDateString` inline em **18 arquivos**, com formatos
 * que não combinavam entre telas vizinhas.
 *
 * Os formatadores aqui são criados uma vez e reusados. O cache por moeda existe
 * porque `deals.currency` é por registro — uma lista pode misturar BRL e USD.
 */

const cacheMoeda = new Map<string, Intl.NumberFormat>();

/**
 * A chave aceita o sufixo ":0" para a variante sem centavos -- `"BRL"` e
 * `"BRL:0"` são formatadores diferentes e precisam de entradas diferentes no
 * cache, senão o segundo devolveria o primeiro.
 */
function formatadorDe(chave: string): Intl.NumberFormat {
  let f = cacheMoeda.get(chave);
  if (!f) {
    const [moeda, semCentavos] = chave.split(":");
    f = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: moeda,
      ...(semCentavos === "0" ? { maximumFractionDigits: 0 } : {}),
    });
    cacheMoeda.set(chave, f);
  }
  return f;
}

/** "R$ 1.234,50". Aceita null para não obrigar cada chamador a tratar. */
export function formatarMoeda(valor: number | null | undefined, moeda = "BRL"): string {
  return formatadorDe(moeda || "BRL").format(Number(valor) || 0);
}

/**
 * "R$ 1.235" — sem centavos.
 *
 * Para faturamento de empresa e total de relatório, onde os centavos são ruído
 * e a largura da coluna importa. Existia duplicado em `reports/types.ts` (como
 * `fmt`) e em `Companies.formatRevenue`.
 */
export function formatarMoedaInteira(valor: number | null | undefined, moeda = "BRL"): string {
  return formatadorDe(`${moeda || "BRL"}:0`).format(Number(valor) || 0);
}

/** "1.234" — número simples com separador de milhar. */
export function formatarNumero(valor: number | null | undefined): string {
  return numeroSimples.format(Number(valor) || 0);
}

const numeroSimples = new Intl.NumberFormat("pt-BR");

/**
 * "R$ 1,2 mil" / "R$ 3,4 mi" — para eixo de gráfico e cabeçalho de coluna, onde
 * o valor exato não cabe e não é o ponto.
 */
export function formatarMoedaCurta(valor: number | null | undefined, moeda = "BRL"): string {
  const n = Number(valor) || 0;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${formatarMoeda(n / 1_000_000, moeda)} mi`.replace(",00", "");
  if (abs >= 1_000) return `${formatarMoeda(n / 1_000, moeda)} mil`.replace(",00", "");
  return formatarMoeda(n, moeda);
}

const dataCurta = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" });
const dataLonga = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const dataDia = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

/** "12 set" — dentro de linha e de chip, onde o ano é ruído. */
export function formatarDataCurta(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const data = typeof d === "string" ? new Date(d) : d;
  return isNaN(data.getTime()) ? "—" : dataCurta.format(data);
}

/** "12/09/2026" — quando o ano importa. */
export function formatarData(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const data = typeof d === "string" ? new Date(d) : d;
  return isNaN(data.getTime()) ? "—" : dataDia.format(data);
}

/** "12/09/2026 14:30" — para registro e auditoria, onde a hora é o dado. */
export function formatarDataHora(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const data = typeof d === "string" ? new Date(d) : d;
  return isNaN(data.getTime()) ? "—" : dataLonga.format(data);
}

const dataHoraCurta = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
});
const mesAno = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
const horaMinuto = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * "12 set, 14:30" — para linha do tempo e registro de execução, onde a HORA é o
 * dado e o ano é ruído. Era o formato mais repetido do projeto: seis arquivos
 * escreviam as quatro opções à mão.
 */
export function formatarDataHoraCurta(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const data = typeof d === "string" ? new Date(d) : d;
  return isNaN(data.getTime()) ? "—" : dataHoraCurta.format(data);
}

/**
 * "14:30" — só a hora.
 *
 * Para "atualizado às", e para mensagem do dia de hoje, onde repetir a data
 * seria ruído. Três arquivos escreviam as duas opções à mão.
 */
export function formatarHora(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const data = typeof d === "string" ? new Date(d) : d;
  return isNaN(data.getTime()) ? "—" : horaMinuto.format(data);
}

/** "setembro de 2026" — cabeçalho de navegador de mês. */
export function formatarMesAno(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const data = typeof d === "string" ? new Date(d) : d;
  return isNaN(data.getTime()) ? "—" : mesAno.format(data);
}

const relativo = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

/**
 * "há 3 dias", "em 2 meses".
 *
 * `Intl.RelativeTimeFormat` é nativo e custa zero byte. `formatDistanceToNow` do
 * date-fns dá o mesmo resultado ao preço de trazer o locale pt-BR inteiro no
 * pacote — e ainda é mais verboso: "há menos de um minuto" tem 21 caracteres, e
 * foi o que quebrou o layout do card do kanban.
 */
export function formatarTempoRelativo(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const data = typeof d === "string" ? new Date(d) : d;
  if (isNaN(data.getTime())) return "—";

  const segundos = (data.getTime() - Date.now()) / 1000;
  const escala: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unidade, tamanho] of escala) {
    if (Math.abs(segundos) >= tamanho) {
      return relativo.format(Math.round(segundos / tamanho), unidade);
    }
  }
  return "agora";
}

/** Quantos dias inteiros separam a data de hoje. Negativo = passado. */
export function diasAte(d: string | Date | null | undefined): number | null {
  if (!d) return null;
  const data = typeof d === "string" ? new Date(d) : d;
  if (isNaN(data.getTime())) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(data);
  alvo.setHours(0, 0, 0, 0);
  return Math.round((alvo.getTime() - hoje.getTime()) / 86_400_000);
}

/**
 * "1 contato" / "340 contatos" — só a palavra, sem o número.
 *
 * O plural sai do singular com "s", o que cobre contato, empresa, atividade,
 * template e sequência. O parâmetro `plural` existe para o que não segue a
 * regra: "negócio no funil" vira "negócios no funil", não "negócio no funils",
 * e "automação" vira "automações".
 *
 * Estava escrito à mão em nove cabeçalhos de página, cada um com o seu ternário
 * dentro de template string -- que é exatamente o que misturava contagem viva
 * com texto fixo no mesmo campo.
 */
export function pluralizar(n: number, singular: string, plural?: string): string {
  return n === 1 ? singular : plural ?? `${singular}s`;
}
