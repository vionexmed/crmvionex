/**
 * Componente declarado DENTRO do render é um tipo novo a cada render.
 *
 * O React compara tipos por identidade para decidir entre atualizar e remontar.
 * Uma função criada no corpo do render nunca é a mesma referência, então a
 * subárvore inteira é DESMONTADA e remontada a cada atualização de estado do
 * pai — perdendo foco, rolagem, animação e estado interno.
 *
 * Havia 8 no projeto. Os três `SortHeader` remontavam o cabeçalho da tabela a
 * cada tecla digitada na busca; o `Toggle` de notificações remontava o `Switch`
 * do Radix a cada preferência alterada; o `CodeBlock` zerava a rolagem do
 * trecho de código ao copiar.
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

/**
 * Um `const Nome = (...) =>` ou `function Nome(` com INDENTAÇÃO, começando com
 * maiúscula. A indentação é o sinal: no escopo do módulo a declaração começa na
 * coluna zero.
 */
function componentesAninhados(src: string): { linha: number; nome: string }[] {
  const achados: { linha: number; nome: string }[] = [];
  src.split("\n").forEach((l, i) => {
    const m = l.match(/^\s+(?:const|function)\s+([A-Z]\w*)\s*[=(]/);
    if (!m) return;
    // Só conta se de fato é uma função: `const Foo = algumaCoisa` não é.
    if (!l.includes("=>") && !l.trimStart().startsWith("function")) return;
    achados.push({ linha: i + 1, nome: m[1] });
  });
  return achados;
}

describe("nenhum componente é declarado dentro do render", () => {
  const arquivos = arquivosTsx("src");

  it("varre a árvore inteira", () => {
    const restantes: string[] = [];
    for (const arquivo of arquivos) {
      for (const { linha, nome } of componentesAninhados(readFileSync(arquivo, "utf8"))) {
        // `MetricIcon` em RiskRulesManager devolve o TIPO do ícone (um
        // LucideIcon), não JSX -- é busca em tabela, não componente, e não
        // remonta nada. O nome com maiúscula é que confunde o detector.
        if (nome === "MetricIcon") continue;
        restantes.push(`${arquivo}:${linha} ${nome}`);
      }
    }
    expect(restantes, `componentes aninhados:\n${restantes.join("\n")}`).toEqual([]);
  });
});

describe("os sete que foram içados continuam fora do render", () => {
  const casos: [string, string][] = [
    ["src/components/crm/AtRiskPanel.tsx", "RiskCard"],
    ["src/components/crm/AtRiskPanel.tsx", "metricIcon"],
    ["src/components/crm/ContactDrawer.tsx", "EstadoLista"],
    ["src/components/settings/NotificationsTab.tsx", "Toggle"],
    ["src/components/integrations/LeadCaptureTab.tsx", "CodeBlock"],
  ];

  it.each(casos)("%s: %s no escopo do módulo", (arquivo, nome) => {
    const src = readFileSync(arquivo, "utf8");
    expect(src).toMatch(new RegExp(`^function ${nome}\\(`, "m"));
  });

  /**
   * Os três `SortHeader` eram byte a byte iguais e nenhum mostrava QUAL coluna
   * estava ordenada -- `ArrowUpDown` fixo em todas.
   */
  it.each([
    "src/pages/Contacts.tsx",
    "src/pages/Companies.tsx",
    "src/components/crm/DealsList.tsx",
  ])("%s usa o SortHeader compartilhado", (arquivo) => {
    const src = readFileSync(arquivo, "utf8");
    expect(src).toContain('from "@/components/layout/SortHeader"');
    expect(src).toMatch(/useOrdenacao<SortKey>/);
    expect(src).not.toMatch(/^\s+const SortHeader/m);
  });
});

/**
 * `React.memo` sem props estáveis não pula nada.
 *
 * O projeto tinha ZERO `memo`, e a resposta óbvia seria espalhá-lo pelas listas.
 * Só que `memo` compara props: se o pai passa `onClick={() => algo(item)}`, a
 * arrow tem identidade NOVA a cada render, a comparação sempre falha, e o
 * componente renderiza igual -- pagando a comparação sem pular nada.
 *
 * A pré-condição vem primeiro. Foi feita no card do kanban, que é onde importa:
 * o dnd-kit atualiza a posição a cada movimento do ponteiro, então arrastar um
 * card renderiza o quadro CONTINUAMENTE, e sem `memo` renderiza os duzentos.
 */
describe("memo só onde a prop é estável", () => {
  // Sem comentários: os comentários que EXPLICAM por que a arrow inline saiu
  // contêm a arrow, e reprovariam a regra que documentam. Terceira vez nesta
  // base que isso acontece -- está no CLAUDE.md por isso.
  const semComentarios = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const KANBAN = semComentarios(readFileSync("src/components/crm/DealsKanban.tsx", "utf8"));
  const DEALS = semComentarios(readFileSync("src/pages/Deals.tsx", "utf8"));

  it("o card do kanban é memoizado", () => {
    expect(KANBAN).toMatch(/const DealCard = memo\(function DealCard/);
  });

  /**
   * `onClick={() => onDealClick(deal)}` era a arrow inline que tornava o memo
   * inútil. Passar `deal` + o callback estável é o que permite a comparação dar
   * igual.
   */
  it("o clique não é montado por arrow inline no laço", () => {
    // Recorta só a montagem do card, até o `/>` que a fecha.
    const i = KANBAN.indexOf("<DealCard");
    const laco = KANBAN.slice(i, KANBAN.indexOf("/>", i));
    expect(laco).not.toMatch(/onClick=\{\(\) =>/);
    expect(laco).toContain("onDealClick={onDealClick}");
  });

  /**
   * A instabilidade subia até a página: `onDealClick={(d) => navigate(...)}`.
   * Estabilizar só o elo de baixo não adiantaria -- a prop continuaria mudando
   * a cada render do topo.
   */
  it("a estabilidade vem da página, não só do kanban", () => {
    expect(DEALS).toMatch(/const abrirNegocio = useCallback\(/);
    expect(DEALS).toContain("onDealClick={abrirNegocio}");
    expect(DEALS).not.toMatch(/onDealClick=\{\(d\) => navigate/);
  });
});
