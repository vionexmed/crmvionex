/**
 * Trava contra uma divergência que chegou ao cliente por e-mail.
 *
 * O construtor da assinatura existia DUAS vezes: um em src/lib para a prévia da
 * tela, outro embutido no gmail-send para a assinatura da organização. Eu
 * melhorei o primeiro e esqueci o segundo — e o resultado apareceu num e-mail
 * real: a tela mostrava um desenho e o enviado saía com os ícones ✆ e 🌐, que
 * não renderizam em cliente nenhum, e com o azul de framework em vez do teal
 * da marca.
 *
 * Copiar é pior que importar. Mas a tela é empacotada pelo Vite e a função roda
 * em Deno, e arquivo fora de supabase/functions/ não entra no bundle de forma
 * confiável. Então: duplica, e o teste garante que continuam idênticos.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const TELA = "src/lib/email-signature.ts";
const FUNCAO = "supabase/functions/_shared/email-signature.ts";

/** Do primeiro export em diante — os cabeçalhos explicam coisas diferentes. */
function corpo(caminho: string): string {
  const txt = readFileSync(caminho, "utf8");
  const i = txt.indexOf("export type DadosAssinatura");
  expect(i, `${caminho} não tem o tipo esperado`).toBeGreaterThan(-1);
  return txt.slice(i).trim();
}

describe("assinatura: uma implementação, duas cópias", () => {
  it("as duas cópias são idênticas do primeiro export em diante", () => {
    expect(
      corpo(FUNCAO),
      `${FUNCAO} está diferente de ${TELA}. Edite a da tela e copie — senão a ` +
        "prévia deixa de corresponder ao que é enviado.",
    ).toBe(corpo(TELA));
  });

  it("a cópia avisa que não deve ser editada direto", () => {
    expect(readFileSync(FUNCAO, "utf8")).toContain("NÃO EDITE AQUI");
  });

  it("o gmail-send usa o construtor compartilhado, não um próprio", () => {
    const envio = readFileSync("supabase/functions/gmail-send/index.ts", "utf8");
    expect(envio).toContain("montarAssinaturaHtml");
    // A marca do template antigo: ele montava as linhas à mão num array `rows`.
    expect(envio, "template próprio de volta dentro do gmail-send").not.toContain(
      "const rows: string[] = []",
    );
  });
});
