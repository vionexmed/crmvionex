/**
 * Buscar tudo, em blocos.
 *
 * O PostgREST corta em 1000 linhas **em silêncio**: sem erro, sem sinal, e o
 * registro simplesmente não aparece na tela. Já mordeu duas vezes neste projeto
 * — a lista de contatos e o seletor de Atividades.
 *
 * O laço que resolve isso estava escrito duas vezes em `api/contacts.ts`, e as
 * outras dez consultas que precisavam dele não o tinham.
 */

/** O corte do PostgREST. Pedir mais que isso num bloco não adianta. */
export const BLOCO = 1000;

/**
 * Chama `consulta(inicio, fim)` até vir um bloco incompleto.
 *
 * `teto` existe porque "tudo" nem sempre é o que se quer: um seletor não
 * precisa de 50 mil contatos na memória do navegador. Ao atingi-lo, para — e o
 * chamador sabe que parou, porque pediu.
 */
export async function buscarEmBlocos<T>(
  consulta: (inicio: number, fim: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  opcoes: { teto?: number } = {},
): Promise<T[]> {
  const teto = opcoes.teto ?? Infinity;
  const todos: T[] = [];

  for (let pagina = 0; ; pagina++) {
    const inicio = pagina * BLOCO;
    const { data, error } = await consulta(inicio, inicio + BLOCO - 1);
    if (error) throw error;
    todos.push(...(data ?? []));
    // Bloco incompleto significa fim: é o único sinal que o PostgREST dá.
    if (!data || data.length < BLOCO) break;
    if (todos.length >= teto) return todos.slice(0, teto);
  }
  return todos;
}
