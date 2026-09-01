/**
 * O que a tela de login baixa.
 *
 * Eram 1,32 MB (370 KB comprimidos) para exibir um formulário de e-mail e
 * senha — porque `AppLayout` importava estaticamente o copiloto de IA, a paleta
 * de comandos e o wizard de onboarding, e porque o `manualChunks` jogava todo
 * pacote sem regra própria dentro de `vendor`, que é pré-carregado inteiro.
 *
 * Cinco bibliotecas de UM ou DOIS importadores respondiam por 87% do vendor:
 * validação de telefone (156 KB), renderizador de markdown (117 KB), paleta de
 * comandos (44 KB), sanitizador de HTML (26 KB) e confete (11 KB). Nenhuma é
 * usada na tela de login.
 *
 * Este teste lê a configuração, não o build: rodar `vite build` dentro do teste
 * levaria segundos e tornaria a suíte lenta o bastante para alguém desligá-la.
 * O que ele guarda é a REGRA — se a separação sumir do config, o peso volta.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const VITE = readFileSync("vite.config.ts", "utf8");
const LAYOUT = readFileSync("src/components/layout/AppLayout.tsx", "utf8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("as bibliotecas pesadas têm chunk próprio", () => {
  /**
   * Sem regra própria elas caem no catch-all `vendor`, e o vendor é
   * pré-carregado na entrada — então a tela de login baixa todas.
   */
  const pesadas: [string, string][] = [
    ["libphonenumber", "telefone"],
    ["react-markdown", "markdown"],
    ["/cmdk", "paleta"],
    ["dompurify", "sanitizador"],
    ["canvas-confetti", "confete"],
    ["date-fns", "datas"],
    ["read-excel-file", "planilha"],
  ];

  it.each(pesadas)("%s vai para o chunk %s", (pacote, chunk) => {
    // Sem janela de proximidade: a regra do markdown tem vinte condições
    // encadeadas antes do `return`, e exigir vizinhança falharia por formatação
    // em vez de por comportamento.
    const iPacote = VITE.indexOf(`id.includes("${pacote}")`);
    const iChunk = VITE.indexOf(`return "${chunk}"`);
    expect(iPacote, `regra para ${pacote} não encontrada`).toBeGreaterThan(-1);
    expect(iChunk, `chunk ${chunk} não encontrado`).toBeGreaterThan(-1);
    expect(iPacote).toBeLessThan(iChunk);
  });

  /**
   * O markdown arrasta um pipeline inteiro (micromark, mdast, hast, unified…).
   * Separar só o pacote de entrada deixaria as dependências no vendor, e o
   * ganho seria quase nenhum.
   */
  it("o pipeline do markdown acompanha o pacote", () => {
    for (const dep of ["/micromark", "/mdast", "/hast", "/unified"]) {
      expect(VITE).toContain(`id.includes("${dep}")`);
    }
  });

  /**
   * Mesmo caso: separar só `read-excel-file` deixou as dependências dela no
   * vendor, e o vendor é pré-carregado. Medido na entrada: 233,1 kB sem a
   * biblioteca, 238,4 kB com ela só no pacote de entrada, 233,2 kB depois de as
   * quatro dependências acompanharem.
   */
  it("as dependências do leitor de planilha acompanham o pacote", () => {
    for (const dep of ["/fflate", "/saxen", "unzipper-esm", "/worker-f"]) {
      expect(VITE).toContain(`id.includes("${dep}")`);
    }
  });

  /**
   * A regra específica tem de vir ANTES do `return "vendor"`, senão o catch-all
   * reivindica primeiro e a separação não acontece.
   */
  it("as regras vêm antes do catch-all", () => {
    expect(VITE.indexOf('return "telefone"')).toBeLessThan(VITE.indexOf('return "vendor"'));
    expect(VITE.indexOf('return "markdown"')).toBeLessThan(VITE.indexOf('return "vendor"'));
  });
});

describe("as sobreposições globais não entram no primeiro acesso", () => {
  /**
   * `AppLayout` monta as três em toda página autenticada, e importá-las
   * estaticamente colocava o grafo inteiro no pacote da entrada — inclusive na
   * tela de login, onde nenhuma delas existe.
   */
  const adiadas = ["CommandPalette", "AICopilot", "OnboardingModal"];

  it.each(adiadas)("%s é carregado sob demanda", (nome) => {
    const codigo = semComentarios(LAYOUT);
    expect(codigo).toMatch(new RegExp(`const ${nome} = lazy\\(`));
    expect(codigo).not.toMatch(new RegExp(`^import \\{ ${nome} \\}`, "m"));
  });

  it("há Suspense em volta", () => {
    expect(semComentarios(LAYOUT)).toContain("<Suspense");
  });

  /**
   * A paleta só existe depois do ⌘K. Montá-la sempre, mesmo fechada, faria o
   * cmdk ser baixado no primeiro acesso apesar do lazy.
   */
  it("a paleta só monta depois de aberta", () => {
    expect(semComentarios(LAYOUT)).toMatch(/\{searchOpen && <CommandPalette/);
  });
});

describe("as dependências mortas não voltam", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const todas = { ...pkg.dependencies, ...pkg.devDependencies };

  // Removidas por terem ZERO importadores — não por preferência.
  it.each([
    "sonner",
    "@dnd-kit/sortable",
    "@dnd-kit/utilities",
    "@types/dompurify",
    "lovable-tagger",
    "@playwright/test",
  ])("%s continua fora", (nome) => {
    expect(todas).not.toHaveProperty(nome);
  });
});

describe("as fontes pedem só os pesos usados", () => {
  const HTML = readFileSync("index.html", "utf8");

  /**
   * O `<link>` do Google Fonts é BLOQUEANTE de renderização: cada peso a mais é
   * uma requisição a mais no caminho crítico. Eram 12 pedidos e 8 usados.
   */
  /**
   * UMA FAMÍLIA, e não duas.
   *
   * Eram Nunito (corpo) e Poppins (títulos). A referência da lateral usa a mesma
   * em tudo, e misturar Plus Jakarta com Poppins daria dois geométricos
   * discutindo: parecidos demais para contrastar, diferentes demais para não
   * incomodar.
   *
   * Cinco pesos, todos com uso: 400 corpo, 500 item de menu, 600 título e
   * rótulo, 700 número grande do painel, 800 o "404" e o wordmark. Sem 300 --
   * não há um `font-light` no projeto.
   */
  it("pede Plus Jakarta Sans com os cinco pesos usados", () => {
    expect(HTML).toMatch(/Plus\+Jakarta\+Sans:wght@400;500;600;700;800/);
  });

  it("as famílias antigas não voltam pelo <link>", () => {
    // Duas famílias carregadas e uma usada é peso morto no caminho crítico --
    // e a segunda entraria em silêncio, porque nada quebra ao pedir uma fonte.
    expect(HTML).not.toMatch(/family=Nunito/);
    expect(HTML).not.toMatch(/family=Poppins/);
  });

  it("JetBrains não pede o peso 600", () => {
    expect(HTML).toMatch(/JetBrains\+Mono:wght@400;500(&|")/);
  });
});

describe("a suíte não monta DOM onde não precisa", () => {
  const CONFIG = readFileSync("vitest.config.ts", "utf8");

  /**
   * `environment: "jsdom"` global custava um DOM inteiro por ARQUIVO. Dos 30
   * arquivos de teste, 4 tocam em DOM; os outros 26 leem código-fonte ou
   * exercitam função pura.
   *
   * Medido: tempo de `environment` de 6,47s para 0,88s, relógio de parede de
   * 1,68s para 0,94s.
   */
  it("o padrão é node", () => {
    expect(CONFIG).toMatch(/environment: "node"/);
  });

  /**
   * Quem precisa declara no topo do próprio arquivo. É local e visível, ao
   * contrário de uma lista de globs no config que ninguém lembra de atualizar.
   */
  it.each([
    "src/test/chunk-reload.test.ts",
    "src/test/hooks/queries/useContacts.test.tsx",
    "src/test/hooks/useDebounce.test.ts",
    "src/test/dashboard/metric-drilldown.test.ts",
    "src/test/lib/csv.test.ts",
  ])("%s pede jsdom no próprio arquivo", (arquivo) => {
    expect(readFileSync(arquivo, "utf8")).toMatch(/^\/\/ @vitest-environment jsdom/);
  });

  /**
   * O setup roda para TODOS os arquivos, inclusive os que rodam em `node` e não
   * têm `window` -- sem a guarda, `defineProperty` lançaria antes do primeiro
   * teste do arquivo.
   */
  it("o setup não assume window", () => {
    expect(readFileSync("src/test/setup.ts", "utf8")).toContain('typeof window !== "undefined"');
  });
});

/**
 * O recharts saiu.
 *
 * Eram 328 kB (89 kB comprimidos) num chunk próprio, e cinco arquivos o
 * importavam. Os primitivos SVG que o substituem já existiam em
 * `dashboard/svg` -- foram escritos quando o painel saiu do recharts. O que
 * faltava era o par que cada relatório remontava por cima deles.
 *
 * Medido, somando o gzip de todos os arquivos do build:
 *
 *     antes   656,9 kB
 *     depois  543,2 kB
 */
describe("recharts não volta", () => {
  const arquivos = (function varrer(dir: string, saida: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) varrer(caminho, saida);
      else if (/\.tsx?$/.test(nome)) saida.push(caminho);
    }
    return saida;
  })("src");

  it("nenhum arquivo importa", () => {
    const infratores = arquivos.filter((f) =>
      /from ["']recharts["']/.test(readFileSync(f, "utf8")),
    );
    expect(infratores, infratores.join("\n")).toEqual([]);
  });

  it("saiu do package.json", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty("recharts");
  });

  /**
   * A regra de chunk existia só para ele. `d3-*` e `victory-vendor` vinham
   * como dependências suas -- se voltarem por outro caminho, devem cair no
   * `vendor` e aparecer na medição, não num chunk que finge ser de gráfico.
   */
  it("a regra de chunk saiu junto", () => {
    const vite = readFileSync("vite.config.ts", "utf8").replace(/\/\/.*$/gm, "");
    expect(vite).not.toMatch(/return "recharts"/);
    expect(vite).not.toMatch(/"recharts",/);
  });
});

describe("os primitivos de gráfico cobrem o que o recharts fazia", () => {
  const PRIMITIVOS = [
    "src/components/dashboard/svg/AreaSeries.tsx",
    "src/components/dashboard/svg/Donut.tsx",
    "src/components/dashboard/svg/BarRow.tsx",
    "src/components/dashboard/svg/RoscaComLegenda.tsx",
    "src/components/dashboard/svg/BarrasAgrupadas.tsx",
  ];

  it.each(PRIMITIVOS)("%s existe", (arquivo) => {
    expect(readFileSync(arquivo, "utf8").length).toBeGreaterThan(0);
  });

  /**
   * Havia UM gradiente, com a cor da primeira série: duas séries preenchidas
   * ficavam com o mesmo fundo, e a segunda parecia pertencer à primeira. O
   * gráfico de Meta contra Google no Marketing é exatamente esse caso.
   */
  it("cada série tem gradiente próprio", () => {
    const src = readFileSync("src/components/dashboard/svg/AreaSeries.tsx", "utf8");
    expect(src).toMatch(/id=\{`g-\$\{idGrad\}-\$\{i\}`\}/);
  });

  /**
   * Séries de grandezas diferentes -- reais e contagem -- precisam de escalas
   * separadas. Numa escala comum a contagem vira uma linha colada no zero.
   */
  it("o eixo direito tem escala própria", () => {
    const src = readFileSync("src/components/dashboard/svg/AreaSeries.tsx", "utf8");
    expect(src).toContain("eixoDireito");
    expect(src).toMatch(/const maxDir = /);
  });

  /**
   * Sem escala compartilhada entre as LINHAS, a maior barra de cada linha teria
   * sempre a largura total e comparar linhas seria impossível.
   */
  it("as barras compartilham a escala entre linhas", () => {
    const src = readFileSync("src/components/dashboard/svg/BarrasAgrupadas.tsx", "utf8");
    expect(src).toMatch(/const max = Math\.max\(1, \.\.\.linhas\.flatMap/);
  });
});
