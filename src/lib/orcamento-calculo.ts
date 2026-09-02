/**
 * A aritmética do orçamento, sem banco.
 *
 * Estava dentro de `api/orcamentos.ts`, e o custo apareceu no teste: importar
 * aquele módulo arrasta o cliente do Supabase, que exige `localStorage` e não
 * carrega no ambiente de teste. Ou seja, a conta que produz o número que o
 * cliente aprova era a única parte NÃO testável do fluxo.
 *
 * Aqui não há import de nada. O módulo é puro, e por isso pode ser exercitado
 * com valor de verdade em vez de conferido por varredura de texto.
 *
 * E é UM lugar de propósito: a soma aparece no construtor, na lista, no painel
 * e na página do cliente. Duas implementações divergindo por arredondamento é a
 * diferença entre o total que ele viu e o que o CRM registrou.
 */

/** O item como qualquer tela o representa — do banco ou em edição. */
export type ItemCalculavel = {
  preco_unit: number;
  quantidade: number;
  desconto: number;
};

/** Piso em zero: desconto maior que a linha não vira crédito. */
export function totalDoItem(i: ItemCalculavel): number {
  return Math.max(0, Number(i.preco_unit) * Number(i.quantidade) - Number(i.desconto));
}

export function totaisDoOrcamento(
  itens: ItemCalculavel[],
  descontoGeral = 0,
): { subtotal: number; desconto: number; total: number } {
  const subtotal = itens.reduce((s, i) => s + totalDoItem(i), 0);
  /*
    O desconto não pode virar total negativo.

    "Tiro 500" num orçamento de 300 é erro de digitação -- e sem este limite o
    total negativo iria para a PÁGINA DO CLIENTE, que é o pior lugar possível
    para um número impossível aparecer.
  */
  const desconto = Math.min(Number(descontoGeral) || 0, subtotal);
  return { subtotal, desconto, total: subtotal - desconto };
}

/**
 * O token do link público.
 *
 * 32 bytes de `crypto.getRandomValues`, em hex. Sequencial ou curto deixaria
 * adivinhar o orçamento do vizinho -- e com ele o preço que você cobra dele.
 */
export function novoToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * O estado real, com a validade levada em conta.
 *
 * `expirado` é DERIVADO e não gravado: um orçamento enviado que passou da data
 * não é "enviado" na prática -- o cliente não pode mais aprovar, e a edge
 * function recusa a decisão. Mostrá-lo como enviado faria a lista prometer uma
 * resposta que não pode chegar.
 *
 * Derivar evita a alternativa pior: um cron mudando status à meia-noite, que
 * erra em fuso e deixa o CRM discordando da função.
 */
export function estadoDoOrcamento(o: { status: string; valido_ate: string | null }): string {
  if (o.status === "aprovado" || o.status === "recusado") return o.status;
  if (o.valido_ate && venceu(o.valido_ate)) return "expirado";
  return o.status;
}

/** Fim do dia da validade: válido "até 16/09" vale o dia 16 todo. Comparar por
 *  instante faria o orçamento vencer à zero hora do próprio dia. */
export function venceu(validoAte: string | null): boolean {
  if (!validoAte) return false;
  return Date.now() > new Date(`${validoAte}T23:59:59`).getTime();
}
