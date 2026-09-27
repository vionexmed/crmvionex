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
/**
 * Sem comentários.
 *
 * Duas regras deste arquivo liam o CSS cru e acabaram medindo a PROSA dentro
 * dos blocos em vez das declarações -- uma delas passou meses verde guardando
 * uma regra que já não existia. É a armadilha que o CLAUDE.md registra como
 * regra de como escrever teste aqui: varredura tem de apagar o comentário
 * antes de procurar.
 */
const CSS_LIMPO = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
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
   * O REALCE DE PASSAGEM É NEUTRO.
   *
   * `--sidebar-accent` era a pastilha do item ATIVO; hoje é o realce do item
   * sob o cursor, e o ativo passou a ser um lavado de `--sidebar-primary` (ver
   * o teste do item ativo mais abaixo). O token trocou de papel, e o teste
   * acompanha -- mas a regra que ele guarda é a mesma, e continua valendo com
   * mais força ainda: passar o mouse não significa nada, e tingir isso com a
   * cor da marca esvazia o acento onde ele deveria significar decisão.
   *
   * Além disso `--sidebar-accent` NÃO é sobrescrito pelo `ThemeContext`: se
   * alguém o aproximar do teal, ele fica teal para quem escolheu roxo.
   */
  it("o realce de passagem é cinza, não a cor da marca", () => {
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
   * O ITEM ATIVO SE DISTINGUE DO ITEM SOB O CURSOR.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * A VERSÃO ANTERIOR DESTE TESTE ESTAVA MEDINDO PROSA.
   *
   * Ela exigia `--sidebar-primary` e `/ 18%` dentro do bloco cru de
   * `.vx-nav-active`, e passava porque um COMENTÁRIO dentro do bloco narrava a
   * regra antiga ("era `--sidebar-primary / 18%` com texto teal"). A
   * declaração real não tinha nem o token nem a porcentagem: a pastilha virou
   * cinza quando a lateral deixou de ser navy, e o teste não percebeu.
   *
   * O nome também tinha envelhecido -- "aparece contra o navy". Não há navy:
   * a lateral é a superfície mais CLARA da tela nos dois temas.
   *
   * O que este teste guarda agora é a regra viva, e ela tem duas metades:
   *
   *   ATIVO SEGUE O ACENTO   o fundo é `--sidebar-primary` com alfa baixo. O
   *                          `ThemeContext` só sobrescreve `--primary`,
   *                          `--ring`, `--sidebar-primary` e `--sidebar-ring`
   *                          -- qualquer outro token é FIXO. Pintar o item
   *                          ativo de `--sidebar-accent` tem na prática o
   *                          mesmo efeito de cravar o teal em hex: quem
   *                          escolhe roxo continua vendo cinza.
   *
   *   HOVER FICA NEUTRO      é o que separa os dois estados. Antes ambos eram
   *                          o mesmo cinza e a única diferença era o peso da
   *                          fonte, que não se lê de relance.
   *
   *   A DOSE É BAIXA         doze por cento é lavado, não cor. O argumento
   *                          antigo ("você está aqui" é orientação, não ação,
   *                          e gastar a marca nisso a esvazia onde ela
   *                          significa decisão) continua valendo -- o botão
   *                          primário segue sendo a única coisa SÓLIDA em cor
   *                          na tela. Por isso o teste cobra o alfa, e não só
   *                          a presença do token.
   *
   * Lido sem comentários, e sobre a família inteira da classe -- a regra, a
   * variante do tema escuro e a do `svg`.
   */
  it("o item ativo segue a cor de destaque e se separa do hover", () => {
    const i = CSS_LIMPO.indexOf(".vx-nav-active {");
    expect(i, "regra .vx-nav-active não encontrada").toBeGreaterThan(-1);
    const familia = CSS_LIMPO.slice(i, CSS_LIMPO.indexOf(".vx-nav-item {", i));

    // O fundo deriva do token que o ThemeContext troca...
    const fundo = familia.match(/\.vx-nav-active \{[^}]*background:\s*([^;]+);/)?.[1];
    expect(fundo, "o fundo do item ativo não deriva de --sidebar-primary")
      .toMatch(/hsl\(var\(--sidebar-primary\)\s*\/\s*\d+%\)/);

    // ...mas em dose de LAVADO: acima de ~25% deixa de ser superfície tingida
    // e vira elemento colorido, que é o papel reservado ao botão primário.
    const alfa = Number(fundo!.match(/\/\s*(\d+)%/)?.[1]);
    expect(alfa, `o lavado do item ativo está forte demais: ${alfa}%`).toBeLessThanOrEqual(25);
    expect(alfa, `o lavado do item ativo não aparece: ${alfa}%`).toBeGreaterThanOrEqual(8);

    // O hover continua neutro -- é o que distingue os dois estados.
    const hover = CSS_LIMPO.match(/\.vx-nav-item:hover \{[^}]*background:\s*([^;]+);/)?.[1];
    expect(hover, "hover e ativo voltaram a ser o mesmo tratamento")
      .toContain("--sidebar-accent");

    // E o ícone leva o acento cheio: o menor elemento da linha.
    expect(familia).toMatch(/svg\s*\{\s*color:\s*hsl\(var\(--sidebar-primary\)\)/);

    // Sem barra lateral colorida: era um traço de 2px competindo com a linha
    // de separação da coluna -- duas verticais paralelas a dois pixels.
    expect(familia).not.toContain("border-left");
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

