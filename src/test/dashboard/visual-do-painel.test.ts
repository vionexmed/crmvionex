/**
 * O visual do painel.
 *
 * O tile de métrica tinha barra colorida de 3px no topo, bolha circular para o
 * ícone, sombra, e o valor competindo com tudo isso. Quatro tiles lado a lado
 * viravam quatro objetos DECORADOS, e para ler os quatro números era preciso
 * atravessar a decoração de cada um.
 *
 * O estilo escolhido (Attio/Linear) resolve por tipografia: rótulo pequeno,
 * número grande, variação pequena. E por faixa em vez de cartões soltos.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const TILE = semComentarios(readFileSync("src/components/dashboard/StatCard.tsx", "utf8"));
const PAINEL = semComentarios(readFileSync("src/pages/Dashboard.tsx", "utf8"));
const GRAFICOS = semComentarios(readFileSync("src/components/dashboard/SdrCharts.tsx", "utf8"));

describe("o tile de métrica tem presença sem competir", () => {
  /**
   * A versão original tinha barra colorida de 3px no topo, bolha circular no
   * ícone e sombra -- três coisas dizendo "sou importante", e o número
   * competindo com as três.
   *
   * Cheguei a tirar tudo, inclusive a elevação, e ficou chapado demais: sem
   * barra e sem sombra o cartão deixava de ser um objeto e virava um retângulo
   * desenhado. O meio-termo mantém a elevação e o ícone, e larga a barra.
   */
  it("sem barra colorida no topo", () => {
    expect(TILE).not.toMatch(/h-\[3px\]/);
  });

  it("o cartão se levanta do fundo", () => {
    expect(TILE).toContain("vx-elevado");
  });

  /**
   * A bolha circular dava ao ícone o contorno de um botão -- e ele não é
   * clicável. Quadrado com raio o assenta sem fingir que se pode tocar.
   */
  it("o ícone tem fundo quadrado, não bolha", () => {
    // A regex casava a lista de classes na ordem exata, então acrescentar um
    // `shrink-0` reprovava sem que nada da INTENÇÃO tivesse mudado. Agora ela
    // cobra o que importa: caixa de 24px e raio, não círculo.
    expect(TILE).toMatch(/h-6 w-6[^"]*rounded-md/);
    expect(TILE).not.toMatch(/rounded-full[\s\S]{0,60}<Icon/);
  });

  /**
   * `sem fonte` era um selo. Um tile sem fonte já está apagado a 60%; o selo
   * por cima chamava atenção justamente para o que não tem o que mostrar.
   */
  it("o estado sem fonte é texto, não selo", () => {
    expect(TILE).not.toMatch(/<Badge[\s\S]{0,120}sem fonte/);
    expect(TILE).toContain("sem fonte de dado");
  });
});

describe("cartão solto no destaque, faixa no detalhe", () => {
  /**
   * Duas decisões OPOSTAS, e as duas deliberadas.
   *
   * Nos quatro do destaque, cada métrica é um objeto que se levanta do fundo --
   * a elevação separa, e não precisa de moldura comum. Cheguei a juntá-los numa
   * faixa com divisória de 1px e ali os quatro liam como linha de tabela.
   *
   * Nos DEZESSEIS de Indicadores é o contrário: cartões soltos seriam dezesseis
   * objetos flutuando, e a elevação deixaria de significar "isto importa" para
   * significar "isto é um cartão". Ali a moldura por grupo é o que faz o grupo
   * se ler como grupo.
   */
  it("o destaque usa cartões separados", () => {
    const i = PAINEL.indexOf('value="visao"');
    const bloco = PAINEL.slice(i, i + 700);
    expect(bloco).toMatch(/grid grid-cols-2 gap-3[^"]*lg:grid-cols-4/);
    expect(bloco).not.toContain("gap-px");
  });

  it("os indicadores usam a faixa", () => {
    const i = PAINEL.indexOf('value="indicadores"');
    const bloco = PAINEL.slice(i, i + 900);
    // Uma moldura só por grupo, e as células dentro dela.
    expect(bloco).toMatch(/overflow-hidden rounded-lg border border-border/);
    expect(bloco).toMatch(/grid grid-cols-2[^"]*xl:grid-cols-5/);
  });

  /**
   * A DIVISÓRIA É DA CÉLULA, NÃO DO ESPAÇO ENTRE ELAS.
   *
   * A faixa era `gap-px` sobre um contêiner `bg-border`: a cor da linha aparecia
   * pelos vãos de 1px. Funciona enquanto TODA célula tem cartão -- e nunca teve.
   * Os grupos têm 5, 4, 4 e 3 métricas numa grade de 5, 3 ou 2 colunas, então em
   * quase todo tamanho de tela sobra célula, e cada célula vazia mostrava o
   * fundo do contêiner inteiro: um retângulo cinza sólido do tamanho de um
   * cartão. Em `xl` o grupo "Operação", de três métricas, desenhava DOIS.
   *
   * Este teste trava as duas metades da correção, porque uma sem a outra
   * reintroduz o defeito: se a linha volta a ser o vão, ela precisa de
   * `bg-border`, e o vazio volta a ser cinza.
   */
  it("célula vazia não vira bloco cinza", () => {
    const i = PAINEL.indexOf('value="indicadores"');
    const bloco = PAINEL.slice(i, i + 900);
    // O fundo do contêiner é o do cartão: é ele que aparece onde não há métrica.
    expect(bloco).toContain("bg-card");
    expect(bloco).not.toMatch(/bg-border/);
    expect(bloco).not.toContain("gap-px");

    // E a linha é desenhada pela célula, que só existe quando há métrica.
    const cartao = semComentarios(
      readFileSync("src/components/dashboard/StatCard.tsx", "utf8"),
    );
    const j = cartao.indexOf("emFaixa ?");
    expect(cartao.slice(j, j + 160)).toMatch(/border-l border-t border-border/);
  });

  /**
   * DE QUE LADO A CÉLULA DESENHA, e é o que fechou o problema.
   *
   * A primeira correção usou `border-b border-r`: cada célula desenhava para
   * baixo e para a direita. Numa linha INCOMPLETA -- que é a regra aqui, com
   * grupos de 5, 4, 4 e 3 numa grade de 5, 3 ou 2 colunas -- a última célula
   * desenhava uma divisória apontando para o vazio, e a linha de cima desenhava
   * um trecho horizontal por baixo de célula que não existe. Contando por
   * tamanho de tela: até 3 traços verticais soltos e até 5 trechos horizontais
   * sobrando. Traço de 1px separando nada de nada é o que faz a tela parecer
   * quebrada.
   *
   * `border-t border-l` desenha em direção a vizinhos que SEMPRE existem -- a
   * primeira linha e a primeira coluna ficam escondidas sob a moldura pela
   * margem negativa. Célula que falta não tem quem desenhe para ela.
   *
   * As duas metades andam juntas: borda no topo/esquerda exige margem negativa
   * no topo/esquerda. Trocar uma sem a outra dobra a moldura de um lado e deixa
   * o outro sem divisória.
   */
  it("a célula desenha para cima e para a esquerda, nunca para o vazio", () => {
    const cartao = semComentarios(
      readFileSync("src/components/dashboard/StatCard.tsx", "utf8"),
    );
    const j = cartao.indexOf("emFaixa ?");
    const emFaixa = cartao.slice(j, j + 160);
    expect(emFaixa).toContain("border-l");
    expect(emFaixa).toContain("border-t");
    expect(emFaixa, "border-b/border-r desenham para o vazio em linha incompleta")
      .not.toMatch(/border-[br]\b/);

    const i = PAINEL.indexOf('value="indicadores"');
    const bloco = PAINEL.slice(i, i + 1400);
    expect(bloco).toContain("-ml-px");
    expect(bloco).toContain("-mt-px");
    expect(bloco, "a margem negativa tem de ser do mesmo lado da borda")
      .not.toMatch(/-m[br]-px/);
  });

  /**
   * O esqueleto tem a mesma forma da célula.
   *
   * Sem isso a grade nascia sem divisória nenhuma e com dezesseis retângulos
   * arredondados, e ao terminar de carregar saltava para uma grade de fio de
   * cabelo: duas telas diferentes para o mesmo conteúdo.
   */
  it("o esqueleto leva as bordas da célula", () => {
    const i = PAINEL.indexOf('value="indicadores"');
    const bloco = PAINEL.slice(i, i + 1400);
    const iEsqueleto = bloco.indexOf("isLoading ? (");
    expect(iEsqueleto).toBeGreaterThan(-1);
    expect(bloco.slice(iEsqueleto, iEsqueleto + 400)).toMatch(/border-l border-t border-border/);
  });

  /**
   * Canto arredondado dentro de grade de fio de cabelo deixa o fundo vazar --
   * quatro mordidas cinzas por célula. O arredondamento é do contêiner, que
   * recorta as células dos cantos com `overflow-hidden`.
   */
  it("na faixa a célula é quadrada", () => {
    const cartao = semComentarios(
      readFileSync("src/components/dashboard/StatCard.tsx", "utf8"),
    );
    const j = cartao.indexOf("emFaixa ?");
    expect(cartao.slice(j, j + 160)).toContain("rounded-none");
  });

  it("a faixa não depende de nth-child", () => {
    // `divide-x` divide numa direção só, e com colunas responsivas a conta de
    // quais células levam borda muda a cada quebra.
    expect(PAINEL).not.toMatch(/nth-child/);
  });
});

describe("o funil é um tom em intensidades", () => {
  /**
   * `CHART_COLORS[i]` dava uma cor da paleta por etapa -- e na ordem,
   * "Clientes", que é o OBJETIVO do funil, caía no vermelho: a cor de erro.
   *
   * Um funil é uma coisa avançando, não quatro coisas distintas.
   */
  it("a cor vem do token de destaque, não da paleta por índice", () => {
    const src = semComentarios(
      readFileSync("src/components/dashboard/SdrCharts.tsx", "utf8"),
    );
    const i = src.indexOf("backgroundColor:");
    expect(src.slice(i, i + 120)).toContain("var(--primary)");
    expect(src.slice(i, i + 120)).not.toContain("CHART_COLORS");
  });
});


describe("os gráficos usam o cartão padrão", () => {
  /**
   * Os quatro usavam `border-0 shadow-sm` -- compensação de quando o Card vinha
   * com borda E sombra e o gráfico queria só a sombra. Sem a sombra no
   * primitivo, `border-0` deixaria o bloco sem separação nenhuma.
   */
  it("sem border-0 shadow-sm", () => {
    expect(GRAFICOS).not.toContain("border-0 shadow-sm");
  });
});

describe("os grupos de indicador usam o primitivo de seção", () => {
  it("Secao em vez de section com título à mão", () => {
    expect(PAINEL).toContain("<Secao");
    expect(PAINEL).not.toMatch(/<section[\s\S]{0,200}vx-titulo-secao/);
  });
});

/**
 * O layout do painel: coluna principal e lateral, não pilha.
 *
 * Os quatro gráficos ficavam empilhados, todos com o mesmo peso, e nada dizia
 * qual olhar primeiro. Mas eles respondem perguntas de níveis diferentes:
 * "o que aconteceu" é acompanhamento diário, "onde está travando" é consulta
 * pontual.
 */
describe("os gráficos têm hierarquia", () => {
  const PANEL = semComentarios(
    readFileSync("src/components/dashboard/SdrChartsPanel.tsx", "utf8"),
  );

  it("duas colunas, a principal com o dobro", () => {
    expect(PANEL).toMatch(/lg:grid-cols-\[minmax\(0,2fr\)_minmax\(0,1fr\)\]/);
  });

  /**
   * `minmax(0, …)` em vez de `2fr 1fr` puro: sem ele a coluna não pode encolher
   * abaixo do conteúdo, e um rótulo longo empurra a grade para fora da tela.
   */
  it("as colunas podem encolher abaixo do conteúdo", () => {
    expect(PANEL).toContain("minmax(0,2fr)");
    expect(PANEL).toContain("minmax(0,1fr)");
  });

  /**
   * No celular vira uma coluna, e a ordem do DOM passa a ser a ordem de
   * leitura. Evolução primeiro; funil e canais depois.
   */
  it("a evolução vem antes do funil na ordem do DOM", () => {
    expect(PANEL.indexOf("GraficoEvolucao")).toBeLessThan(PANEL.indexOf("GraficoFunil"));
  });

  it("o esqueleto tem a mesma forma do conteúdo", () => {
    // Esqueleto empilhado seguido de conteúdo em duas colunas faz a tela
    // pular quando os dados chegam.
    expect(PANEL).toMatch(/carregando[\s\S]{0,400}lg:grid-cols-\[minmax/);
  });
});

describe("a rosca cabe na coluna estreita", () => {
  const ROSCA = semComentarios(
    readFileSync("src/components/dashboard/svg/RoscaComLegenda.tsx", "utf8"),
  );

  /**
   * Rosca de 168px mais a legenda não cabem lado a lado numa coluna de ~340px.
   * Sem quebrar, a legenda esmagaria até "WhatsApp" virar "Wha…".
   */
  it("quebra em vez de esmagar", () => {
    expect(ROSCA).toContain("flex-wrap");
    expect(ROSCA).toMatch(/min-w-\[180px\]/);
  });
});
