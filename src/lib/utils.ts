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
