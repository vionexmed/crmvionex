/**
 * A linguagem visual nova: raio, respiro e densidade.
 *
 * O CRM era denso e de canto pouco arredondado, e cada tela redesenhada ficava
 * parecendo de outro produto — porque não havia uma linguagem compartilhada
 * para seguir, só classes decididas tela a tela.
 *
 * O que este arquivo tranca é o oposto de uma regra de estilo: são três coisas
 * que já falharam em SILÊNCIO neste projeto — um controle que não controlava
 * nada, e cores que furam a troca de tema.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const semComentarios = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const CSS = readFileSync("src/index.css", "utf8");
const TEMA = readFileSync("src/contexts/ThemeContext.tsx", "utf8");
const CARD = semComentarios(readFileSync("src/components/ui/card.tsx", "utf8"));

const TSX = (function varrer(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) varrer(caminho, saida);
    else if (nome.endsWith(".tsx")) saida.push(caminho);
  }
  return saida;
})("src");

describe("a densidade deixou de ser controle morto", () => {
  /**
   * O TESTE QUE MAIS IMPORTA aqui.
   *
   * `density` era guardada no localStorage e desenhada em Configurações →
   * Aparência com três opções, e **nada no CSS lia o valor**. Escolher
   * "compacto" ou "confortável" não mudava um pixel — e não havia como
   * descobrir isso a não ser medindo.
   *
   * A regressão é silenciosa nos dois sentidos: some o `data-density` e o
   * controle volta a não fazer nada, sem erro; some o bloco do CSS e o mesmo.
   * Por isso o teste cobra as DUAS pontas.
   */
  it("o tema escreve data-density na raiz", () => {
    expect(TEMA).toContain("document.documentElement.dataset.density");
    expect(TEMA).toMatch(/useEffect\(\(\) => \{ applyDensity\(density\); \}, \[density\]\)/);
  });

  it("o CSS responde às três opções", () => {
    for (const d of ["compact", "comfortable"]) {
      expect(CSS, `data-density="${d}" sem bloco no CSS`).toContain(`[data-density="${d}"]`);
    }
    // `normal` é o valor do :root — não precisa de bloco, mas precisa existir
    // como opção na tela de Aparência.
    const aparencia = readFileSync("src/components/settings/AppearanceTab.tsx", "utf8");
    for (const d of ["compact", "normal", "comfortable"]) {
      expect(aparencia, `${d} sumiu de Aparência`).toContain(d);
    }
  });

  /** O respiro do cartão tem de VIR do token, senão a densidade muda o token e
   *  o cartão continua igual — o controle volta a ser enfeite. */
  it("o cartão respira pelo token, não por px cravado", () => {
    expect(CSS).toContain("--respiro:");
    expect(CSS).toContain(".vx-respiro { padding: var(--respiro); }");
    expect(CARD).toContain("vx-respiro");
    expect(CARD).not.toMatch(/cn\("[^"]*\bp-4\b/);
  });

  /**
   * O tile de métrica também. Ele tinha `p-4` cravado, e um cartão que ignora a
   * densidade no meio de uma grade de cartões que a respeitam é exatamente o
   * desalinhamento que o token existe para evitar.
   */
  it("o tile de métrica segue o mesmo respiro", () => {
    const TILE = semComentarios(
      readFileSync("src/components/dashboard/StatCard.tsx", "utf8"),
    );
    expect(TILE).toContain("vx-respiro");
  });
});

describe("a escala de raio não colapsa", () => {
  const CFG = readFileSync("tailwind.config.ts", "utf8");

  /**
   * O TESTE QUE MAIS IMPORTA nesta leva, porque a falha é INVISÍVEL no código.
   *
   * A escala era `--radius - 2px` e `- 4px`. Com o token em 10px dava 10/8/6 e
   * ninguém notava; quando ele subiu para 16px virou 16/14/12 -- os três
   * praticamente iguais. E o estrago é nos elementos pequenos, que são a
   * maioria: 106 usos de `rounded-md`, 14 de `rounded-sm`.
   *
   * Um raio de 14px num botão de 32px é quase pílula, e no quadrado de 24px do
   * ícone do StatCard vira bolha -- exatamente o que `visual-do-painel` proíbe.
   * Aquele teste continuou passando porque confere o NOME da classe, não o
   * valor computado. Nenhum teste da base pegaria isso; este pega.
   */
  it("os degraus menores acompanham por fator, não por subtração", () => {
    const escala = CFG.slice(CFG.indexOf("borderRadius:"), CFG.indexOf("keyframes:"));
    expect(escala, "subtração fixa achata a escala quando o raio cresce")
      .not.toMatch(/calc\(var\(--radius\) - \d+px\)/);
    expect(escala).toMatch(/md: "calc\(var\(--radius\) \* 0\.\d+\)"/);
    expect(escala).toMatch(/sm: "calc\(var\(--radius\) \* 0\.\d+\)"/);
  });

  /** E os fatores têm de ser crescentes: sm < md < lg, senão a escala inverte
   *  sem que nada quebre. */
  it("sm é menor que md", () => {
    const fator = (nome: string) =>
      Number(CFG.match(new RegExp(`${nome}: "calc\\(var\\(--radius\\) \\* ([\\d.]+)\\)"`))?.[1]);
    expect(fator("sm")).toBeLessThan(fator("md"));
    expect(fator("md")).toBeLessThan(1);
  });
});

describe("a cor de destaque continua trocável", () => {
  /**
   * A referência é roxa, e `violet` já é uma das seis cores de destaque. Cravar
   * o roxo em vez de escolher a opção quebraria duas coisas de uma vez: a troca
   * de cor pelo usuário e o tema escuro, que tem um roxo próprio.
   *
   * O CLAUDE.md registra isto como armadilha conhecida — os hex `--vx-*` não
   * têm valor para o tema escuro e quebram o dark em silêncio.
   */
  it("nenhuma tela crava o roxo da referência", () => {
    const infratores: string[] = [];
    for (const arquivo of TSX) {
      if (arquivo.endsWith("ThemeContext.tsx")) continue;
      const src = semComentarios(readFileSync(arquivo, "utf8"));
      /*
       * Só o roxo EXATO da referência e o HSL do acento.
       *
       * A primeira versão varria hex roxo em geral e reprovou
       * `onboarding/PipelineStep.tsx`, que tem `#8b5cf6` numa paleta de cor de
       * ETAPA de funil -- valor que o usuário escolhe por etapa, não acento de
       * tema. Paleta de dado e cor de marca são coisas diferentes, e uma
       * varredura por matiz não distingue as duas.
       */
      if (/#6[cC]5[cC][eE]7|262 83% 58%/.test(src)) infratores.push(arquivo);
    }
    expect(infratores, infratores.join("\n")).toEqual([]);
  });

  it("violet segue disponível como escolha", () => {
    expect(TEMA).toMatch(/violet: \{ light: "262 83% 58%"/);
  });
});

describe("o painel mantém as métricas que tem", () => {
  const PAINEL = semComentarios(readFileSync("src/pages/Dashboard.tsx", "utf8"));

  /** Uma segunda lista das quatro em destaque divergiria da primeira no dia em
   *  que alguém trocasse uma delas. */
  it("o destaque vem de DESTAQUE, não de uma lista solta", () => {
    expect(PAINEL).toMatch(/const DESTAQUE: MetricKey\[\]/);
    // A faixa é DERIVADA da constante: `DESTAQUE.map(...)` sobre os tiles dos
    // grupos, e não uma segunda lista de quatro métricas escrita à mão.
    expect(PAINEL).toMatch(/const tilesDestaque = DESTAQUE\s*\n?\s*\.map/);
  });

  /**
   * As dezesseis continuam renderizadas — inclusive as cinco sem fonte, que
   * ficam de propósito: o tooltip de cada uma registra o que falta gravar no
   * banco, e apagar o cartão apagaria o registro junto.
   */
  it("as dezesseis chaves seguem na grade", () => {
    const chaves = [
      "leadsRecebidos", "abordagens", "taxaEntrega", "taxaResposta",
      "conversasIniciadas", "qualificadosIA", "transferidosHumano", "reunioes",
      "oportunidades", "vendasSdr", "tempoRespostaMin", "aguardandoHumano",
      "leadsInstagram", "leadsWhatsapp", "leadsGoogle", "leadsLinkedin",
    ];
    for (const k of chaves) {
      expect(PAINEL, `${k} sumiu do painel`).toContain(`key: "${k}"`);
    }
  });

  /**
   * O assistente do painel é o `DashboardAIChat`, que RECEBE as métricas — e
   * não o Copilot flutuante, que só conhece a rota. Trocar por ele faria o
   * assistente do painel deixar de saber os números que está ao lado.
   */
  it("o assistente do painel é o que conhece as métricas", () => {
    expect(PAINEL).toContain("<DashboardAIChat");
    expect(PAINEL).toContain("crmData={{");
  });
});
