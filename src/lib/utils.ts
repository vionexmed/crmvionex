import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Iniciais para avatar, a partir de um nome já montado.
 *
 * Duas letras quando há nome e sobrenome, uma quando há só um termo, "?" quando
 * não há nada aproveitável. Ignora termo vazio, então "  Ana   Prado " e
 * "Ana Prado" dão o mesmo resultado.
 */
export function initials(name?: string | null): string {
  const termos = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (termos.length === 0) return "?";
  if (termos.length === 1) return termos[0].charAt(0).toUpperCase();
  return (termos[0].charAt(0) + termos[termos.length - 1].charAt(0)).toUpperCase();
}

/**
 * Indexa uma lista por id, para consulta em tempo constante.
 *
 * O projeto tinha 22 lugares com `.find()` DENTRO de `.map()` -- para cada
 * negócio, varrer a lista de etapas; para cada contato, varrer a de empresas.
 * Isso é O(n×m), e roda a cada render, não só quando os dados mudam.
 *
 * Onde os dois lados crescem -- contatos × empresas, inscrições × contatos,
 * histórico × contatos -- é O(n²) de verdade: mil contatos e mil empresas dão um
 * milhão de comparações por render.
 *
 * Sempre dentro de `useMemo`: construir o índice a cada render trocaria uma
 * varredura por outra.
 */
export function indexarPorId<T extends { id: string }>(itens: readonly T[] | null | undefined): Map<string, T> {
  const indice = new Map<string, T>();
  for (const item of itens ?? []) indice.set(item.id, item);
  return indice;
}

/** Como `indexarPorId`, mas para chave que não se chama `id`. */
export function indexarPor<T, K>(itens: readonly T[] | null | undefined, chave: (item: T) => K): Map<K, T> {
  const indice = new Map<K, T>();
  for (const item of itens ?? []) indice.set(chave(item), item);
  return indice;
}
