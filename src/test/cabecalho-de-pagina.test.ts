/**
 * O cabeçalho que aparece em 19 telas.
 *
 * Era um cartão elevado com gradiente, trilho na cor da marca e ladrilho de
 * ícone de 40px, ocupando ~126px antes de qualquer conteúdo — em toda tela
 * interna. Três defeitos foram MEDIDOS antes de mexer:
 *
 * 1. O `kicker` era digitado em cada tela: 14 valores distintos para 18 telas,
 *    dos quais **15 discordavam do grupo que a lateral mostrava acesa**.
 *    Contatos dizia "Diretório" e a lateral, "Registros".
 * 2. Relatórios e Metas ficam no MESMO grupo e escreviam "Análises" e
 *    "Analytics" — a mesma palavra, uma traduzida e outra não.
 * 3. `--muted-foreground` rendia 2,54:1 sobre o cartão. A WCAG AA exige 4,5:1.
 *
 * E `description` carregava duas coisas incompatíveis: nove telas montavam
 * contagem viva por template string, seis escreviam texto fixo lido uma vez.
 * Mesmo tamanho, mesma cor apagada — o número, que é o dado, formatado como
 * ajuda.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { grupoDaRota, NAV_GRUPOS, MENU_DA_CONTA } from "@/components/layout/navegacao";
import { pluralizar } from "@/lib/formato";

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const PAGINAS = readdirSync("src/pages")
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => join("src/pages", f))
  .filter((f) => /<PageShell|<PageHeader/.test(readFileSync(f, "utf8")));

describe("o rótulo do cabeçalho sai da mesma lista que desenha a lateral", () => {
  /**
   * A prova de que o achado 1 está fechado POR CONSTRUÇÃO: cada destino
   * resolve exatamente para o grupo que o declara. Se alguém acrescentar
   * `/settings/faturamento` num grupo diferente de "Conta", o casamento por
   * prefixo mais longo tem de continuar entregando o grupo certo.
   */
  const destinos = [
    ...NAV_GRUPOS.flatMap((g) => g.items.map((i) => [i.url, g.label] as const)),
    ...MENU_DA_CONTA.map((i) => [i.url, "Conta"] as const),
  ];

  it.each(destinos)("%s pertence a %s", (url, grupo) => {
    expect(grupoDaRota(url)).toBe(grupo);
  });

  /**
   * `/settings` viria antes de `/settings/security` numa varredura ingênua, e a
   * tela de Segurança herdaria o grupo de Configurações. O prefixo mais longo
   * vence, e aqui isso é verificado com uma rota FILHA, que é o caso real:
   * `/deals/:id` não está na lista e precisa herdar de `/deals`.
   */
  it("rota filha herda o grupo do pai", () => {
    expect(grupoDaRota("/deals/9f3a-1b2c")).toBe("Registros");
    expect(grupoDaRota("/marketing/visao-geral")).toBe("Análise");
  });

  it("prefixo mais longo vence o mais curto", () => {
    // As duas existem na lista; a específica não pode ser capturada pela genérica.
    expect(grupoDaRota("/settings/security")).toBe("Conta");
    expect(grupoDaRota("/settings")).toBe("Conta");
  });

  it("barra final não muda o resultado", () => {
    expect(grupoDaRota("/contacts/")).toBe(grupoDaRota("/contacts"));
  });

  it("rota desconhecida devolve undefined, não um rótulo errado", () => {
    // Undefined faz o rótulo sumir. Um palpite faria a tela AFIRMAR um lugar falso.
    expect(grupoDaRota("/nao-existe")).toBeUndefined();
  });
});

describe("nenhuma tela digita o próprio rótulo", () => {
  /**
   * Enquanto der para digitar, alguém digita — e foi assim que "Analytics"
   * conviveu com "Análises" no mesmo grupo.
   */
  it.each(PAGINAS)("%s não declara kicker literal", (arquivo) => {
    expect(semComentarios(readFileSync(arquivo, "utf8"))).not.toMatch(/kicker="/);
  });
});

describe("contagem e texto fixo não dividem o mesmo campo", () => {
  /**
   * O padrão proibido é `description={`…${x}…`}` — template string com
   * interpolação, que é sempre contagem disfarçada de prosa. Texto fixo entre
   * aspas continua permitido, e é o que as seis telas explicativas usam.
   */
  it.each(PAGINAS)("%s não monta contagem dentro de description", (arquivo) => {
    const codigo = semComentarios(readFileSync(arquivo, "utf8"));
    const interpolada = /description=\{`[^`]*\$\{/.test(codigo);
    expect(interpolada, `${arquivo} monta contagem por template string`).toBe(false);
  });

  /** As nove que contavam precisam ter migrado, não simplesmente perdido o número. */
  const QUE_CONTAM = [
    "Contacts", "Companies", "Deals", "Leads", "Activities",
    "Automations", "LeadScoring", "EmailTemplates", "EmailSequences",
  ];
  it.each(QUE_CONTAM)("%s passa contagem", (nome) => {
    expect(readFileSync(`src/pages/${nome}.tsx`, "utf8")).toMatch(/contagem=\{\{/);
  });

  /** E as seis que explicam continuam explicando. */
  const QUE_EXPLICAM = ["Dashboard", "Reports", "SalesGoals", "MyEmail", "Integrations", "SecuritySettings"];
  it.each(QUE_EXPLICAM)("%s mantém description em texto fixo", (nome) => {
    expect(readFileSync(`src/pages/${nome}.tsx`, "utf8")).toMatch(/description="/);
  });
});

describe("o cabeçalho não desenha mais ícone", () => {
  const HEADER = semComentarios(readFileSync("src/components/layout/PageHeader.tsx", "utf8"));
  const SHELL = semComentarios(readFileSync("src/components/layout/PageShell.tsx", "utf8"));

  /**
   * A lateral já mostra o ícone da tela atual aceso. Manter a prop sem
   * desenhar nada deixaria 19 telas passando um valor que ninguém lê.
   */
  it("PageHeader não recebe nem renderiza ícone", () => {
    expect(HEADER).not.toMatch(/LucideIcon/);
    expect(HEADER).not.toMatch(/<Icon\b/);
  });

  it("PageShell não aceita mais a prop", () => {
    expect(SHELL).not.toMatch(/icon[?]?:/);
  });

  /*
   * NÃO há varredura de `icon=` nas páginas, de propósito.
   *
   * A primeira versão deste teste procurava `icon={` em cada página e reprovou
   * o Painel por `icon={tile.icon}` -- os cartões de métrica, que nada têm a
   * ver com o cabeçalho. Restringir ao trecho entre `<PageShell` e o `>` que o
   * fecha não resolve: `onClick={() => algo()}` contém um `>`, e é o mesmo
   * erro que já custou dois casos numa varredura anterior deste projeto.
   *
   * Como `PageShell` não declara mais a prop, passar `icon` não compila. O
   * `npm run typecheck` é a guarda, e ela é exata.
   */

  /** O gradiente era estilo inline, fora de qualquer token. */
  it("o gradiente inline saiu", () => {
    expect(HEADER).not.toMatch(/linear-gradient/);
  });
});

describe("o subtítulo passa no contraste mínimo", () => {
  /**
   * O teste faz a conta, e é de propósito: um teste que só procurasse a string
   * "43%" passaria com o comentário que explica a mudança, e continuaria
   * passando se alguém devolvesse o valor para 65% deixando o comentário.
   */
  const hslParaRgb = (h: number, s: number, l: number): [number, number, number] => {
    s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] = [
      [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
    ][Math.floor(h / 60) % 6];
    return [r, g, b].map((v) => Math.round((v + m) * 255)) as [number, number, number];
  };

  const luminancia = (rgb: [number, number, number]) => {
    const [r, g, b] = rgb.map((v) => {
      const n = v / 255;
      return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const contraste = (a: [number, number, number], b: [number, number, number]) => {
    const [la, lb] = [luminancia(a), luminancia(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const CSS = readFileSync("src/index.css", "utf8");

  /** O primeiro bloco é `:root`, o tema claro. O segundo é `.dark`. */
  const valores = [...CSS.matchAll(/--muted-foreground:\s*(\d+)\s+(\d+)%\s+(\d+)%/g)];
  const claro = valores[0];

  it("o token do tema claro existe", () => {
    expect(claro, "--muted-foreground não encontrado em src/index.css").toBeTruthy();
  });

  it.each([
    ["o branco do cartão", [255, 255, 255] as [number, number, number]],
    ["o cinza de --muted", hslParaRgb(220, 13, 93)],
  ])("atinge 4,5:1 sobre %s", (_onde, fundo) => {
    const fg = hslParaRgb(Number(claro[1]), Number(claro[2]), Number(claro[3]));
    expect(contraste(fg, fundo)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("pluralizar", () => {
  /**
   * Estava escrito à mão em nove cabeçalhos, cada um com o ternário dentro da
   * template string — que é justamente o que misturava dado com prosa.
   */
  it("um é singular, o resto é plural", () => {
    expect(pluralizar(1, "contato")).toBe("contato");
    expect(pluralizar(0, "contato")).toBe("contatos");
    expect(pluralizar(340, "contato")).toBe("contatos");
  });

  /** Nem todo plural em português é +s no fim da frase. */
  it("aceita plural irregular", () => {
    expect(pluralizar(2, "negócio no funil", "negócios no funil")).toBe("negócios no funil");
    expect(pluralizar(2, "automação", "automações")).toBe("automações");
    // sem o parâmetro, a regra do "s" produziria isto -- e é o erro que ele evita
    expect(pluralizar(2, "automação")).toBe("automaçãos");
  });
});
