/**
 * Escolha do provedor de WhatsApp — o único lugar que conhece os dois.
 */
import type { ProvedorWhatsApp } from "./types.ts";
import { provedorMeta } from "./meta.ts";
import { provedorEvolution } from "./evolution.ts";

export * from "./types.ts";
export * from "./credencial.ts";

export function resolverProvedor(provider: string | null | undefined): ProvedorWhatsApp {
  // Default é a Meta: é o provedor implementado, e coluna nula não deve
  // derrubar um envio.
  return provider === "evolution" ? provedorEvolution : provedorMeta;
}
