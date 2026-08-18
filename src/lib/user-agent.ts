/**
 * Traduz o user agent cru de `auth.sessions` para algo legível.
 *
 * Não é detecção perfeita — user agent é declarado pelo cliente e pode mentir.
 * Serve para a pessoa reconhecer o próprio dispositivo numa lista, que é o uso
 * real: "esse Safari no Mac sou eu; esse Chrome no Windows não conheço".
 */
export type Dispositivo = {
  navegador: string;
  sistema: string;
  tipo: "computador" | "celular" | "tablet" | "desconhecido";
  rotulo: string;
};

const NAVEGADORES: Array<[RegExp, string]> = [
  // Ordem importa: Edge e Opera também se declaram Chrome; Chrome também se
  // declara Safari. O primeiro que casar ganha.
  [/Edg\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Chrome\/\d+.*Mobile/, "Chrome (celular)"],
  [/CriOS/, "Chrome (iPhone)"],
  [/Chrome\//, "Chrome"],
  [/FxiOS/, "Firefox (iPhone)"],
  [/Firefox\//, "Firefox"],
  [/Version\/.*Safari/, "Safari"],
  [/Safari\//, "Safari"],
  [/PostmanRuntime|curl|python-requests|node-fetch|axios/, "Script / API"],
];

const SISTEMAS: Array<[RegExp, string]> = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Mac OS X|Macintosh/, "Mac"],
  [/Windows NT 10|Windows NT 11/, "Windows"],
  [/Windows/, "Windows"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

export function lerUserAgent(ua: string | null | undefined): Dispositivo {
  if (!ua || !ua.trim()) {
    return { navegador: "Desconhecido", sistema: "Desconhecido", tipo: "desconhecido", rotulo: "Dispositivo não identificado" };
  }

  const navegador = NAVEGADORES.find(([re]) => re.test(ua))?.[1] ?? "Navegador desconhecido";
  const sistema = SISTEMAS.find(([re]) => re.test(ua))?.[1] ?? "Sistema desconhecido";

  const tipo: Dispositivo["tipo"] =
    /iPad|Tablet/.test(ua) ? "tablet"
    : /iPhone|Android.*Mobile|Mobile/.test(ua) ? "celular"
    : /Macintosh|Windows|Linux|CrOS/.test(ua) ? "computador"
    : "desconhecido";

  return { navegador, sistema, tipo, rotulo: `${navegador} · ${sistema}` };
}

/** "agora", "há 5 min", "há 3 h", "há 2 dias" — sem biblioteca de data. */
export function tempoRelativo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const seg = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seg < 0) return "agora";
  if (seg < 90) return "agora";
  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ontem";
  if (d < 30) return `há ${d} dias`;
  const m = Math.floor(d / 30);
  return m === 1 ? "há 1 mês" : `há ${m} meses`;
}
