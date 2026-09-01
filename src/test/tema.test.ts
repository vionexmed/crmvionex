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
 * A lateral navy — a âncora da tela.
 *
 * Cheguei a clareá-la inteira, na direção "editorial", e a escolha foi voltar:
 * no formato de painel de comando a lateral escura ancora a tela pela esquerda
 * e a luz fica onde o trabalho está. É também a identidade do Vionex.
 *
 * O que NÃO voltou foi o descuido: as opacidades, a pastilha ativa e a barra de
 * rolagem continuam derivando de token, e a cor de destaque segue trocável.
 */
describe("a lateral ancora a tela", () => {
  const bloco = (seletor: string) => {
    const i = CSS.indexOf(seletor);
    return CSS.slice(i, CSS.indexOf("}", i));
  };
  const valor = (escopo: string, token: string) =>
    bloco(escopo).match(new RegExp(`${token}:\\s*([^;]+);`))?.[1]?.trim();

  /**
   * A LATERAL DEIXOU DE SER NAVY.
   *
   * Era `217 72% 14%`, encostada na borda. Virou cartão BRANCO flutuando sobre o
   * cinza da página (`--background`, 97%) -- é o formato pedido, e é o que dá
   * separação sem depender de sombra pesada.
   *
   * O teste não trava o branco exato: trava a RELAÇÃO, que é o que precisa valer
   * para o cartão se ler como cartão. Cravar `0 0% 100%` reprovaria um ajuste
   * legítimo para 99%.
   */
  it("no claro a lateral é mais clara que a página, para flutuar sobre ela", () => {
    const lum = (v?: string) => Number(v?.match(/(\d+)%\s*$/)?.[1] ?? 0);
    expect(lum(valor(":root {", "--sidebar-background")))
      .toBeGreaterThan(lum(valor(":root {", "--background")));
  });

  /**
   * Era `0 0% 60%`: cinza PURO sobre um fundo azulado, o que faz o texto
   * parecer sujo. Mesma claridade, com o azul do fundo dentro dele.
   */
  it("o texto da lateral não é cinza puro", () => {
    const v = valor(":root {", "--sidebar-foreground");
    expect(v).not.toMatch(/^0 0%/);
    const [matiz, sat] = v!.split(" ");
    expect(Number(matiz)).toBeGreaterThan(180);
    expect(Number(sat.replace("%", ""))).toBeGreaterThan(0);
  });

  /**
   * O teal claro existia porque o escuro sumia CONTRA O NAVY. Sem navy, a lateral
   * usa o mesmo teal do conteúdo -- duas variantes da cor da marca sem motivo
   * seria justamente o tipo de divergência que o `--sidebar-primary` foi criado
   * para resolver.
   */
  it("a cor de destaque da lateral acompanha a do conteúdo", () => {
    expect(valor(":root {", "--sidebar-primary")).toBe(valor(":root {", "--primary"));
  });

  /**
   * O ATIVO É NEUTRO, não teal.
   *
   * "Você está aqui" é orientação, não ação. Gastar a cor da marca nisso a
   * esvazia onde ela deveria significar decisão -- botão primário, série de
   * gráfico. A pílula do item ativo é `--sidebar-accent`, e este teste garante
   * que ela não seja uma variação do destaque.
   */
  it("a pílula do item ativo é cinza, não a cor da marca", () => {
    const acento = valor(":root {", "--sidebar-accent");
    const [matiz, sat] = acento!.split(" ");
    // Teal vive perto de 187. Cinza levemente azulado, perto de 220, com
    // saturação baixa.
    expect(Number(sat.replace("%", "")), `--sidebar-accent está saturado: ${acento}`)
      .toBeLessThan(20);
    expect(Math.abs(Number(matiz) - 187), `--sidebar-accent puxa para o teal: ${acento}`)
      .toBeGreaterThan(15);
  });

  /**
   * INVERTEU, junto com o formato.
   *
   * Antes a lateral era um bloco mais escuro, encostado -- ali fazer-se mais
   * escura era o que a separava. Agora é um cartão que FLUTUA, e objeto que
   * flutua sobre fundo escuro se aproxima da luz, não se afasta. Mesmo princípio
   * do tema claro, invertido: em ambos, o cartão se distingue da página.
   */
  it("no escuro a lateral é mais clara que o conteúdo, para flutuar sobre ele", () => {
    const lum = (v?: string) => Number(v?.match(/(\d+)%\s*$/)?.[1] ?? 0);
    expect(lum(valor(".dark {", "--sidebar-background")))
      .toBeGreaterThan(lum(valor(".dark {", "--background")));
  });

  /**
   * `--muted` era IDÊNTICO a `--background` (ambos `220 14% 97%`), e o truque
   * padrão de kanban — coluna cinza, cartão branco — era invisível. Ao voltar o
   * fundo para 97%, o muted teve de descer junto.
   */
  it("muted continua distinto do fundo", () => {
    expect(valor(":root {", "--muted")).not.toBe(valor(":root {", "--background"));
  });

  /**
   * A pastilha do item ativo é 18% da cor de destaque. Chegou a ser 10%,
   * calibrado para a lateral clara — contra o navy, dez por cento quase não
   * aparece.
   */
  it("o item ativo aparece contra o navy", () => {
    const b = bloco(".vx-nav-active {");
    expect(b).toContain("--sidebar-primary");
    expect(b).toMatch(/\/ 18%/);
    // Sem barra lateral colorida: era um traço de 2px competindo com a linha
    // de separação da coluna.
    expect(b).not.toContain("border-left");
  });

  /**
   * Era um teal a 45% CRAVADO, que gritava e ignorava a troca de cor de
   * destaque. Deriva do texto da lateral, que já é claro sobre o navy.
   */
  it("a barra de rolagem deriva de token", () => {
    const i = CSS.indexOf('[data-sidebar="sidebar"], [data-sidebar="sidebar"] *');
    const trecho = CSS.slice(i, i + 260);
    expect(trecho).not.toMatch(/rgba?\(/);
    expect(trecho).toContain("--sidebar-foreground");
  });
});

