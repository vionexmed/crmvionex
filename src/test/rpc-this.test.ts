/**
 * Trava contra um bug que já aconteceu duas vezes.
 *
 * `supabase.rpc` precisa do `this` para alcançar `this.rest`. Destacado numa
 * variável — `const chamar = supabase.rpc` — a chamada estoura de forma
 * SÍNCRONA, antes de qualquer await. O efeito prático foi um botão preso em
 * "Removendo…" para sempre, porque o `finally` nunca era alcançado.
 *
 * Nem typecheck nem lint pegam: o `as unknown as` some com o tipo real.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function arquivos(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivos(p, out);
    else if (/\.tsx?$/.test(nome)) out.push(p);
  }
  return out;
}

describe("supabase.rpc nunca destacado do cliente", () => {
  it("nenhum arquivo atribui supabase.rpc a uma variável", () => {
    const culpados: string[] = [];

    for (const f of arquivos("src")) {
      // Este próprio arquivo cita o padrão para explicá-lo e para provar o
      // comportamento — não é uso real.
      if (f.endsWith("rpc-this.test.ts")) continue;
      const txt = readFileSync(f, "utf8");
      // `const x = supabase.rpc` em qualquer forma, com ou sem cast na frente.
      if (/(?:const|let|var)\s+\w+\s*(?::[^=]+)?=\s*\(?\s*supabase\.rpc\b(?!\s*\()/.test(txt)) {
        culpados.push(f);
      }
    }

    expect(culpados, `perde o \`this\` e estoura antes do await — use (supabase.rpc as ...).call(supabase, ...)`).toEqual([]);
  });

  it("prova o comportamento: destacado estoura, método funciona", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const c = createClient("https://exemplo.supabase.co", "chave-de-teste");

    // Chamada de método: devolve um builder, sem estourar.
    expect(() => c.rpc("qualquer" as never, {} as never)).not.toThrow();

    // Destacada: estoura na hora.
    const destacada = c.rpc;
    expect(() => (destacada as typeof c.rpc)("qualquer" as never, {} as never)).toThrow();
  });
});
