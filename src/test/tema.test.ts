/**
 * Sete defeitos de tema que ninguém tinha visto.
 *
 * Todos invisíveis em revisão de código e visíveis na tela — mas só se você
 * trocar de tema ou de cor de destaque, o que raramente se faz ao revisar. Por
 * isso viram teste.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const ler = (p: string) => readFileSync(p, "utf8");
const CSS = ler("src/index.css");
const HTML = ler("index.html");

describe("um sistema de aviso só", () => {
  /**
   * `sonner` era montado no App e tinha ZERO chamadas no projeto inteiro — os 56
   * arquivos que dão aviso usam o toast do Radix. Ainda por cima com
   * `theme = "dark"` cravado, então todo aviso dele sairia escuro no tema claro.
   */
  it("o sonner foi removido", () => {
    expect(existsSync("src/components/ui/sonner.tsx")).toBe(false);
    const app = ler("src/App.tsx");
    expect(app).not.toContain("<Sonner />");
    expect(app).not.toContain("ui/sonner");
  });

  it("não voltou como dependência", () => {
    const pkg = JSON.parse(ler("package.json"));
    expect(pkg.dependencies).not.toHaveProperty("sonner");
  });
});

describe("o tema é aplicado antes do primeiro pixel", () => {
  /**
   * O `<html>` vinha com `class="dark"` cravada e o `main.tsx` apenas ADICIONAVA
   * a classe salva, sem remover — com tema claro o documento ficava "dark light"
   * ao mesmo tempo, e a página renderizava escura até o React montar.
   */
  it("o html não crava mais um tema", () => {
    expect(HTML).not.toMatch(/<html[^>]*class="[^"]*dark/);
  });

  it("existe script síncrono no head", () => {
    // Arquivo externo chegaria tarde demais para evitar a piscada.
    const head = HTML.slice(0, HTML.indexOf("</head>"));
    expect(head).toContain('localStorage.getItem("fc-theme")');
    expect(head).toContain("prefers-color-scheme: dark");
  });

  it("o script tolera armazenamento bloqueado", () => {
    // Navegador com cookies/armazenamento desligado lançaria, e a página ficaria
    // sem classe nenhuma.
    const head = HTML.slice(0, HTML.indexOf("</head>"));
    expect(head).toMatch(/catch\s*\(/);
  });

  it("main.tsx não aplica tema de novo", () => {
    const main = ler("src/main.tsx");
    expect(main).not.toMatch(/classList\.add\(savedTheme\)/);
  });
});

describe("a cor de destaque chega em todo lugar", () => {
  /**
   * O botão primário tinha o teal cravado em cinco valores — dois gradientes e
   * três sombras. Trocar a cor em Configurações mudava tudo menos o botão mais
   * importante da tela.
   */
  it("o botão primário deriva de --primary", () => {
    const bloco = CSS.slice(CSS.indexOf(".vx-btn-primary"), CSS.indexOf(".vx-card"));
    expect(bloco).toContain("hsl(var(--primary))");
    expect(bloco).not.toMatch(/hsl\(187 \d+% \d+%\)/);
    expect(bloco).not.toMatch(/rgba\(0, ?123, ?138/);
  });

  /**
   * `teal` é o padrão do ThemeContext e a cor da marca, e estava ausente do
   * seletor: quem trocasse não voltava pela interface.
   */
  it("teal está no seletor de cor", () => {
    const aba = ler("src/components/settings/AppearanceTab.tsx");
    expect(aba).toMatch(/value: "teal"/);
  });
});

describe("os tokens --vx-* funcionam no tema escuro", () => {
  const raiz = CSS.slice(0, CSS.indexOf(".dark {"));
  const escuro = CSS.slice(CSS.indexOf(".dark {"));
  const nomes = (t: string) => new Set([...t.matchAll(/^\s*(--vx-[\w-]+):/gm)].map((m) => m[1]));

  /**
   * A página de Marketing consome estes tokens 115 vezes e é a única que os usa.
   * Sem variante escura, ela ignorava o tema inteiro — `--vx-navy` é quase preto,
   * então o título ficava invisível sobre fundo escuro.
   */
  it("todo token tem par no tema escuro", () => {
    const semPar = [...nomes(raiz)].filter((n) => !nomes(escuro).has(n));
    expect(semPar).toEqual([]);
  });

  /**
   * Eram 21 tokens `--vx-*`. Sobraram CINCO, e não por descuido: os outros
   * dezesseis duplicavam tokens que o sistema já tinha.
   *
   *   --vx-navy, --vx-grafite    →  --foreground
   *   --vx-text-2, --vx-text-3   →  --muted-foreground  (o text-3 era o MESMO
   *                                 valor: #9AA3B0)
   *   --vx-green                 →  --success       (#0A6640, idêntico)
   *   --vx-red                   →  --destructive   (#B02020, idêntico)
   *   --vx-amber                 →  --warning       (#92610A, idêntico)
   *   --vx-teal*                 →  --primary, que é TROCÁVEL -- o teal fixo
   *                                 ignorava a cor escolhida pelo usuário
   *
   * Os cinco que ficam são identidade de terceiros e não seguem tema nenhum:
   * o azul do Meta, o vermelho do Google e uma cor de série de gráfico.
   */
  it("os que restam são identidade de marca, não tema", () => {
    expect([...nomes(raiz)].sort()).toEqual([
      "--vx-google", "--vx-google-bg", "--vx-meta", "--vx-meta-bg", "--vx-purple",
    ]);
  });
});

describe("título usa o token de texto", () => {
  /**
   * Era `hsl(217 72% 14%)` cravado, com uma regra `.dark` compensando. O título
   * ignorava `--foreground`: mudar o token não mudava o título.
   */
  it("h1..h4 não têm cor própria", () => {
    const bloco = CSS.slice(CSS.indexOf("h1, h2, h3, h4 {"));
    const regra = bloco.slice(0, bloco.indexOf("}"));
    expect(regra).toContain("hsl(var(--foreground))");
    expect(regra).not.toMatch(/hsl\(217 72% 14%\)/);
  });

  it("a regra .dark que compensava saiu", () => {
    expect(CSS).not.toContain(".dark h1, .dark h2");
  });
});

/**
 * A lateral clara.
 *
 * Era navy `#0A1E3D` contra conteúdo claro -- o padrão de CRM de 2010–2020. O
 * peso visual da tela ia para o MENU em vez de ir para o trabalho.
 *
 * Agora a lateral é o mesmo plano do conteúdo, separada só pela linha. No tema
 * escuro ela continua escura: o que muda é deixar de ser um bloco diferente.
 */
describe("a lateral é o mesmo plano do conteúdo", () => {
  const bloco = (seletor: string) => {
    const i = CSS.indexOf(seletor);
    return CSS.slice(i, CSS.indexOf("}", i));
  };
  const valor = (escopo: string, token: string) => {
    const b = bloco(escopo);
    return b.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1]?.trim();
  };

  it("no tema claro, a lateral é clara", () => {
    const fundo = valor(":root {", "--sidebar-background");
    expect(fundo, "ainda é o navy").not.toMatch(/^217 72%/);
    // Luminosidade alta é o que faz ser "clara". O navy era 14%.
    const lum = Number(fundo?.match(/(\d+)%\s*$/)?.[1] ?? 0);
    expect(lum).toBeGreaterThan(90);
  });

  /**
   * `0 0% 60%` era cinza puro calibrado para o navy. Sobre fundo claro fica
   * ilegível -- é a primeira coisa que quebra ao inverter a lateral.
   */
  it("o texto da lateral é escuro no tema claro", () => {
    const lum = Number(valor(":root {", "--sidebar-foreground")?.match(/(\d+)%\s*$/)?.[1] ?? 100);
    expect(lum).toBeLessThan(50);
  });

  it("no tema escuro a lateral acompanha o fundo, não se destaca dele", () => {
    const fundo = valor(".dark {", "--sidebar-background");
    const conteudo = valor(".dark {", "--background");
    const sat = (v?: string) => Number(v?.match(/\d+ (\d+)%/)?.[1] ?? 0);
    // Era 72% de saturação contra 50% do conteúdo: um navy destacado.
    expect(sat(fundo)).toBe(sat(conteudo));
  });

  /**
   * `--muted` era IDÊNTICO a `--background` (ambos `220 14% 97%`), então o
   * truque padrão de kanban -- coluna cinza, cartão branco -- era invisível.
   * Está documentado no CLAUDE.md como armadilha.
   */
  it("muted deixou de ser idêntico ao fundo", () => {
    expect(valor(":root {", "--muted")).not.toBe(valor(":root {", "--background"));
  });

  /**
   * A barra de 2px à esquerda funcionava contra o navy. Com a lateral clara ela
   * vira um traço competindo com a linha de separação da coluna -- duas
   * verticais paralelas a dois pixels de distância.
   */
  it("o item ativo é pastilha, não barra lateral", () => {
    expect(bloco(".vx-nav-active {")).not.toContain("border-left");
  });

  /**
   * 45% da cor de destaque era calibrado para o navy, onde a barra precisava se
   * destacar de um fundo muito escuro.
   */
  it("a barra de rolagem da lateral não grita", () => {
    const i = CSS.indexOf('[data-sidebar="sidebar"], [data-sidebar="sidebar"] *');
    expect(CSS.slice(i, i + 200)).not.toContain("--sidebar-primary");
  });
});
