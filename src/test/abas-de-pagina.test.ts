/**
 * A barra de abas.
 *
 * Havia dez barras no projeto e **seis tratamentos diferentes**:
 *
 *     nua                         Painel, Equipe, Segurança
 *     w-full                      ContactDrawer, CompanyDrawer
 *     mx-3 mt-2                   AtRiskPanel
 *     flex-wrap                   Integrações
 *     flex-wrap h-auto gap-1      Configurações
 *     grid w-full grid-cols-N     Relatórios, Login
 *
 * Só as duas últimas ocupavam a largura da tela; nas outras as abas ficavam
 * espremidas num canto, pequenas. Um mesmo controle com seis aparências.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function arquivosTsx(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivosTsx(caminho, saida);
    else if (nome.endsWith(".tsx")) saida.push(caminho);
  }
  return saida;
}

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("todas as abas usam a mesma barra", () => {
  /**
   * `<TabsList>` cru é o que permitia as seis aparências. Quem precisa de abas
   * monta `PageTabs`, que decide largura, colunas e tamanho de alvo.
   */
  it("ninguém monta TabsList à mão", () => {
    const infratores = arquivosTsx("src")
      .filter((f) => !f.endsWith("PageTabs.tsx") && !f.endsWith("ui/tabs.tsx"))
      .filter((f) => semComentarios(readFileSync(f, "utf8")).includes("<TabsList"));
    expect(infratores, infratores.join("\n")).toEqual([]);
  });

  const COM_ABAS = [
    "src/pages/Dashboard.tsx",
    "src/pages/Reports.tsx",
    "src/pages/Settings.tsx",
    "src/pages/Integrations.tsx",
    "src/pages/Team.tsx",
    "src/pages/SecuritySettings.tsx",
    "src/pages/Login.tsx",
    "src/components/crm/ContactDrawer.tsx",
    "src/components/crm/CompanyDrawer.tsx",
    "src/components/crm/AtRiskPanel.tsx",
  ];

  it.each(COM_ABAS)("%s monta PageTabs", (arquivo) => {
    const src = semComentarios(readFileSync(arquivo, "utf8"));
    expect(src).toContain('from "@/components/layout/PageTabs"');
    expect(src).toContain("<PageTabs");
  });
});

describe("o número de colunas é contado, não escrito", () => {
  const src = readFileSync("src/components/layout/PageTabs.tsx", "utf8");

  /**
   * `grid-cols-5` escrito à mão vira mentira no dia em que alguém acrescenta a
   * sexta aba -- e o erro é de LAYOUT, silencioso, não de tipo. Em
   * Configurações o problema já existiria hoje: as abas são condicionais, e o
   * número muda conforme quem está logado é admin ou não.
   */
  it("deriva do tamanho do array", () => {
    expect(src).toMatch(/const n = abas\.length/);
    expect(src).toMatch(/COLUNAS\[n\]/);
  });

  it("cobre de 1 a 8 abas", () => {
    // A maior barra do projeto tem 7 (Configurações, como admin).
    for (let n = 1; n <= 8; n++) {
      expect(src).toContain(`${n}: "sm:grid-cols-${n}"`);
    }
  });

  /**
   * Sete abas de 50px são sete alvos que ninguém acerta com o polegar. Acima de
   * quatro, o celular quebra em duas linhas em vez de espremer -- e por isso a
   * barra precisa de `h-auto`, já que a altura fixa de 40px do primitivo
   * cortaria a segunda linha.
   */
  it("o celular quebra em linhas em vez de espremer", () => {
    expect(src).toMatch(/5: "grid-cols-3"/);
    expect(src).toMatch(/7: "grid-cols-4"/);
    expect(src).toContain("h-auto");
  });

  it("nenhuma tela escreve grid-cols na barra de abas", () => {
    for (const arquivo of arquivosTsx("src").filter((f) => !f.endsWith("PageTabs.tsx"))) {
      const conteudo = semComentarios(readFileSync(arquivo, "utf8"));
      const i = conteudo.indexOf("<PageTabs");
      if (i < 0) continue;
      expect(conteudo.slice(i, i + 200), arquivo).not.toMatch(/grid-cols-\d/);
    }
  });
});

describe("as abas estão em português", () => {
  /**
   * A barra de Relatórios tinha "Forecast" e "Custom" ao lado de "Vendas" e
   * "Contatos"; a de Segurança tinha "Audit Log"; a tela de entrada -- a
   * primeira coisa que alguém vê no produto -- tinha "Magic Link".
   */
  it.each([
    ["src/pages/Reports.tsx", ["Forecast", "Custom"]],
    ["src/pages/SecuritySettings.tsx", ["Audit Log"]],
    ["src/pages/Login.tsx", ["Magic Link"]],
  ])("%s", (arquivo, termos) => {
    const src = semComentarios(readFileSync(arquivo, "utf8"));
    const i = src.indexOf("<PageTabs");
    const bloco = src.slice(i, src.indexOf("/>", i));
    for (const t of termos) expect(bloco, `"${t}" ainda na barra`).not.toContain(t);
  });
});
