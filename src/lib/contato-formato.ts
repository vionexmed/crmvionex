/**
 * Como nome e telefone de contato APARECEM na tela.
 *
 * O problema é de dados, não de layout: a mesma lista mostra
 * "CLAUDIA MOSCHEN ANTUNES" ao lado de "Claudia Nascentes Soares", e telefones
 * em quatro formatos -- "5511985427007", "41 99974-8426", "44991790710" e
 * vazio. Vem de planilha: cada pessoa que preencheu digitou do seu jeito, e o
 * CRM guardava exatamente o que recebeu.
 *
 * A normalização é de EXIBIÇÃO, não de gravação. O que está no banco continua
 * como veio, de propósito:
 *
 *  - reescrever telefone alheio corre o risco de corromper número estrangeiro,
 *    ramal e o que ainda não sabemos que existe na base;
 *  - e a busca precisa achar o que a pessoa digitou. Quem procura
 *    "5511985427007" tem de encontrar, mesmo que a tela mostre "(11) 98542-7007".
 *
 * Então o dado é preservado e a tela padroniza.
 */

/**
 * Particulas que ficam em minúscula no meio do nome.
 *
 * "MARIA DE SOUZA" tem de virar "Maria de Souza", não "Maria De Souza" -- que é
 * o resultado de um title-case ingênuo e o motivo de ele parecer errado em
 * português. No começo do nome elas sobem: "Da Silva" existe como sobrenome.
 */
const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e", "di", "du", "del", "van", "von", "y"]);

/**
 * "CLAUDIA MOSCHEN ANTUNES" -> "Claudia Moschen Antunes".
 *
 * Só age quando o texto está TODO em maiúscula. Nome com caixa mista foi escrito
 * por alguém que sabia o que queria -- "McCarthy", "d'Ávila", "LinkedIn" num
 * campo errado -- e reescrever seria supor que sei melhor.
 */
export function normalizarCaixa(texto: string): string {
  const t = texto.trim();
  if (!t) return "";

  // Tem minúscula? Então já foi escrito com intenção.
  if (/\p{Ll}/u.test(t)) return t;

  return t
    .toLocaleLowerCase("pt-BR")
    .split(/(\s+)/)
    .map((parte, i) => {
      if (/^\s+$/.test(parte)) return parte;
      if (i > 0 && PARTICULAS.has(parte)) return parte;
      // Cada segmento entre hífen e apóstrofo sobe: "maria-clara" -> "Maria-Clara",
      // "d'avila" -> "D'Avila".
      return parte.replace(/(^|[-'’])(\p{Ll})/gu, (_, antes, letra) => antes + letra.toLocaleUpperCase("pt-BR"));
    })
    .join("");
}

/** Nome completo do contato, em caixa padronizada. */
export function nomeDoContato(
  first: string | null | undefined,
  last?: string | null,
): string {
  const nome = `${first ?? ""} ${last ?? ""}`.replace(/\s+/g, " ").trim();
  return normalizarCaixa(nome) || "Sem nome";
}

/**
 * Telefone em um formato só: "(11) 98542-7007".
 *
 * Aceita o que a base tem hoje -- com e sem +55, com e sem máscara -- porque
 * decide pela CONTAGEM DE DÍGITOS, não pelo que veio escrito:
 *
 *   13  55 + DDD + 9 dígitos    5511985427007  -> (11) 98542-7007
 *   12  55 + DDD + 8 dígitos    551133334444   -> (11) 3333-4444
 *   11  DDD + 9 dígitos         11985427007    -> (11) 98542-7007
 *   10  DDD + 8 dígitos         1133334444     -> (11) 3333-4444
 *    9  9 dígitos, sem DDD      985427007      -> 98542-7007
 *    8  8 dígitos, sem DDD      33334444       -> 3333-4444
 *
 * Qualquer outra contagem volta como veio. É a decisão importante deste arquivo:
 * número estrangeiro, ramal e o que a base tem de estranho aparecem intactos em
 * vez de mutilados por uma máscara que não os descreve. Uma máscara errada é
 * pior que nenhuma -- ela AFIRMA um formato.
 */
export function formatarTelefone(valor: string | null | undefined): string {
  const bruto = String(valor ?? "").trim();
  if (!bruto) return "—";

  // `+` é DECLARAÇÃO DE PAÍS, e um país que não é o Brasil sai intacto.
  //
  // Sem esta linha, "+1 415 555 2671" virava "(14) 15555-2671": onze dígitos
  // caem no ramo de DDD brasileiro, e o código dos EUA foi lido como DDD. O
  // número ficava irreconhecível E parecia válido, que é o pior par possível.
  if (bruto.startsWith("+") && !bruto.replace(/\D/g, "").startsWith("55")) return bruto;

  const d = bruto.replace(/\D/g, "");

  const comDdd = (ddd: string, numero: string) => {
    const corte = numero.length === 9 ? 5 : 4;
    return `(${ddd}) ${numero.slice(0, corte)}-${numero.slice(corte)}`;
  };

  if (d.length === 13 && d.startsWith("55")) return comDdd(d.slice(2, 4), d.slice(4));
  if (d.length === 12 && d.startsWith("55")) return comDdd(d.slice(2, 4), d.slice(4));
  if (d.length === 11) return comDdd(d.slice(0, 2), d.slice(2));
  if (d.length === 10) return comDdd(d.slice(0, 2), d.slice(2));
  if (d.length === 9) return `${d.slice(0, 5)}-${d.slice(5)}`;
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`;

  return bruto;
}

/**
 * E-mail em minúscula.
 *
 * "Crisrisso2018@gmail.com" e "crisrisso2018@gmail.com" são o MESMO endereço --
 * a parte do domínio é insensível a caixa por RFC, e nenhum provedor de verdade
 * distingue a parte local. Exibir como foi digitado faz a lista parecer ter duas
 * pessoas quando tem uma.
 */
export function formatarEmail(valor: string | null | undefined): string {
  const e = String(valor ?? "").trim();
  return e ? e.toLowerCase() : "—";
}
