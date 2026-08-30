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

function formatadorDe(moeda: string): Intl.NumberFormat {
  let f = cacheMoeda.get(moeda);
  if (!f) {
    f = new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda });
    cacheMoeda.set(moeda, f);
  }
  return f;
}

/** "R$ 1.234,50". Aceita null para não obrigar cada chamador a tratar. */
export function formatarMoeda(valor: number | null | undefined, moeda = "BRL"): string {
  return formatadorDe(moeda || "BRL").format(Number(valor) || 0);
}

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
