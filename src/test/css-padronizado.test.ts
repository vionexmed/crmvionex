/**
 * O CSS: moldura de tabela, cores e classes mortas.
 *
 * O projeto tinha `.vx-table` pronto no CSS e **3 de 18 tabelas** o usavam. As
 * outras 15 montavam a moldura à mão, em CINCO formatos:
 *
 *     rounded-md border overflow-hidden
 *     rounded-md border border-border
 *     rounded-md border border-border overflow-x-auto
 *     rounded-md border overflow-auto max-h-[500px]
 *     (nenhum — quatro tabelas sem moldura)
 *
 * Parte da causa era o próprio `.vx-table`: a borda vinha de
 * `.vx-table > div`, então quem aplicasse a classe sem um `<div>` como filho
 * direto ficava sem borda nenhuma e não entendia por quê.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync("src/index.css", "utf8");
/** Sem comentários: o comentário que EXPLICA por que `.vx-table > div` saiu
 *  contém o seletor, e reprovaria a regra que ele documenta. */
const CSS_LIMPO = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const TSX = (function varrer(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) varrer(caminho, saida);
    else if (nome.endsWith(".tsx")) saida.push(caminho);
  }
  return saida;
})("src");

describe("toda tabela usa a mesma moldura", () => {
  it("nenhuma monta a borda à mão", () => {
    const infratores = TSX.filter((f) => {
      const src = readFileSync(f, "utf8");
      return src.includes("<Table>") && !src.includes("vx-table");
    });
    expect(infratores, infratores.join("\n")).toEqual([]);
  });

  /**
   * A moldura tem de estar na PRÓPRIA classe. Enquanto dependia de
   * `.vx-table > div`, aplicar a classe numa tabela sem essa estrutura não
   * fazia nada -- e o silêncio é o que fez quinze telas desistirem dela.
   */
  it("a borda não depende da estrutura dos filhos", () => {
    expect(CSS_LIMPO).not.toContain(".vx-table > div {");
    const i = CSS.indexOf("\n  .vx-table {");
    expect(i, "regra .vx-table não encontrada").toBeGreaterThan(-1);
    expect(CSS.slice(i, CSS.indexOf("}", i))).toContain("border:");
  });
});

describe("a cor de destaque continua trocável", () => {
  /**
   * `ThemeContext` sobrescreve `--primary`, `--ring` e `--sidebar-primary` em
   * tempo de execução. Cor cravada em hex ignora a escolha do usuário -- e a
   * navegação ativa fazia exatamente isso, com `rgba(0, 164, 181, 0.14)`, o
   * teal. Escolher roxo deixava o item ativo teal, sem explicação.
   */
  it("a navegação ativa deriva do token, não do teal", () => {
    const i = CSS.indexOf(".vx-nav-active {");
    const bloco = CSS.slice(i, CSS.indexOf("}", i));
    expect(bloco).not.toMatch(/rgba?\(/);
    expect(bloco).toContain("--sidebar-primary");
  });

  /**
   * `rgba(255,255,255,0.06)` assume barra lateral escura. No tema claro o
   * realce simplesmente não aparecia.
   */
  it("o realce da navegação não assume fundo escuro", () => {
    const i = CSS.indexOf(".vx-nav-item:hover");
    expect(CSS.slice(i, CSS.indexOf("}", i))).not.toContain("255,255,255");
  });

  /**
   * A regra é sobre COR, não sobre `rgba`.
   *
   * Cinza e branco com alfa ficam: sombra, brilho interno e trilha de rolagem
   * são neutros, não mudam quando o usuário troca o tema, e derivá-los de um
   * token não os tornaria mais corretos.
   *
   * O que não pode é cor CROMÁTICA cravada -- foi assim que o teal parou em
   * quatro lugares (item ativo, hover e as três regras da barra de rolagem) e
   * sobreviveu à troca de cor de destaque.
   */
  it("nenhuma cor cromática cravada em rgb", () => {
    const cromaticas = CSS_LIMPO.split("\n").filter((l) => {
      const m = l.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return false;
      const [r, g, b] = m.slice(1).map(Number);
      // Neutro é R≈G≈B. Uma diferença grande entre os canais é matiz.
      return Math.max(r, g, b) - Math.min(r, g, b) > 30;
    });
    expect(cromaticas, cromaticas.join("\n")).toEqual([]);
  });
});

describe("a cor padrão de etapa vem de um lugar só", () => {
  /**
   * Não é cor de TEMA -- é valor de DADO, que vai para `pipeline_stages.color`
   * e o usuário troca no seletor. Por isso continua um hex. O que faltava era
   * estar em um lugar: estava cravada em quatro.
   */
  it("só a fonte declara o hex", () => {
    const infratores = TSX.filter(
      (f) => !f.endsWith("LinhaDeEtapa.tsx") && readFileSync(f, "utf8").includes('"#94a3b8"'),
    );
    expect(infratores, infratores.join("\n")).toEqual([]);
  });
});

describe("nenhuma classe .vx-* morta", () => {
  it("toda classe declarada é usada", () => {
    const declaradas = [...CSS.matchAll(/^\s*\.(vx-[a-z0-9-]+)\s*\{/gm)].map((m) => m[1]);
    const fonte = TSX.map((f) => readFileSync(f, "utf8")).join("\n") + CSS;
    const mortas = [...new Set(declaradas)].filter((c) => {
      // Conta só usos FORA da própria declaração.
      const ocorrencias = fonte.split(c).length - 1;
      const emCss = CSS.split(c).length - 1;
      return ocorrencias <= emCss;
    });
    expect(mortas, `classes sem uso: ${mortas.join(", ")}`).toEqual([]);
  });

  it("as chaves do arquivo estão balanceadas", () => {
    // Uma remoção mal feita deixou um `}` órfão e derrubou o build inteiro.
    expect(CSS.split("{").length).toBe(CSS.split("}").length);
  });
});

/**
 * O respiro interno dos cartões.
 *
 * O primitivo nascia com `p-6` (24px) e **ninguém o queria**: 68 dos 116
 * `CardContent` e 42 dos 86 `CardHeader` sobrescreviam, e **nenhum sobrescrevia
 * PARA p-6**. Metade dos cartões ficava em 24px e metade em 12–16px, então dois
 * cartões lado a lado respiravam diferente.
 *
 * A base tipográfica aqui é 13px, não os 16px que o Tailwind assume — 24px de
 * respiro é proporcionalmente exagerado.
 */
describe("os cartões respiram igual", () => {
  const CARD = readFileSync("src/components/ui/card.tsx", "utf8");

  /**
   * O respiro saiu de `p-4` cravado para `.vx-respiro`, que lê `--respiro` --
   * e é o que faz a densidade escolhida em Configurações valer alguma coisa.
   * Ela era guardada no localStorage e NADA no CSS lia o valor.
   */
  it("o default vem do token de respiro, não de px cravado", () => {
    expect(CARD).not.toMatch(/cn\("[^"]*\bp-6\b/);
    expect(CARD).not.toMatch(/cn\("[^"]*\bp-4\b/);
    expect(CARD).toMatch(/CardContent[\s\S]*?cn\("vx-respiro pt-0"/);
  });

  /**
   * `pb-2` porque é o que 27 dos 42 cabeçalhos já escreviam: o subtítulo fica
   * colado no título, e o vão maior vem do conteúdo abaixo.
   */
  it("o cabeçalho fecha com pb-2", () => {
    expect(CARD).toMatch(/CardHeader[\s\S]*?cn\("flex flex-col space-y-1\.5 vx-respiro pb-2"/);
  });

  /**
   * Se o default está certo, ninguém repete `p-4`. E `pb-2`/`pb-3`/`pb-4` no
   * cabeçalho eram diferenças de 4px — ruído, não decisão.
   */
  it("nenhum cartão repete o padding do default", () => {
    const infratores: string[] = [];
    for (const arquivo of TSX) {
      const src = readFileSync(arquivo, "utf8");
      for (const m of src.matchAll(/<Card(Content|Header) className="([^"]*)"/g)) {
        const classes = m[2].split(" ");
        if (classes.includes("p-4")) infratores.push(`${arquivo}  <Card${m[1]} ${m[2]}`);
        if (m[1] === "Header" && classes.some((c) => /^pb-[234]$/.test(c))) {
          infratores.push(`${arquivo}  <CardHeader ${m[2]}`);
        }
      }
    }
    expect(infratores, infratores.join("\n")).toEqual([]);
  });

  /**
   * `p-3` fica, e é deliberado: são 13 lugares, TODOS em contêiner apertado —
   * grade de métricas com três a cinco colunas, gaveta, painel lateral. O que
   * não existe mais é um terceiro valor por acidente.
   */
  it("só há dois valores de respiro", () => {
    const valores = new Set<string>();
    for (const arquivo of TSX) {
      const src = readFileSync(arquivo, "utf8");
      for (const m of src.matchAll(/<CardContent className="([^"]*)"/g)) {
        for (const c of m[1].split(" ")) if (/^p-\d$/.test(c)) valores.add(c);
      }
    }
    // `p-0` é estrutural: o conteúdo desenha a própria borda (tabela dentro do
    // cartão, por exemplo).
    expect([...valores].sort()).toEqual(["p-0", "p-3"]);
  });
});

/**
 * A página de Marketing tinha um design system PARALELO.
 *
 * 938 linhas, 88 estilos em linha, 21 tokens `--vx-*` próprios, e três cópias
 * locais de primitivos que já existiam: a sétima barra de abas do projeto, a
 * sexta cópia do grupo de pílulas e o décimo terceiro formato de estado vazio.
 *
 * Dezesseis dos 21 tokens duplicavam tokens do sistema — três deles com valor
 * IDÊNTICO. E o teal aparecia cravado como `var(--vx-teal)` em vinte lugares,
 * o mesmo defeito da barra lateral: a cor de destaque é trocável, e escolher
 * roxo deixava a página teal.
 */
describe("Marketing entra no sistema", () => {
  const OVERVIEW = readFileSync("src/pages/marketing/Overview.tsx", "utf8");
  const SEM_COMENTARIOS = OVERVIEW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("usa os primitivos em vez de cópias locais", () => {
    expect(OVERVIEW).toContain('from "@/components/layout/SegmentedControl"');
    expect(OVERVIEW).toContain('from "@/components/layout/EstadoDaLista"');
  });

  it("não monta o próprio grupo de pílulas", () => {
    // Duas cópias havia: a barra de abas e o seletor de período.
    expect(SEM_COMENTARIOS.match(/<SegmentedControl</g) ?? []).toHaveLength(2);
  });

  /**
   * `--primary` segue a escolha do usuário; `--vx-teal` não. Era o mesmo
   * defeito de `.vx-nav-active` e da barra de rolagem.
   */
  it("a cor de destaque vem do token trocável", () => {
    expect(SEM_COMENTARIOS).not.toContain("var(--vx-teal");
    expect(SEM_COMENTARIOS).toContain("hsl(var(--primary))");
  });

  it("texto e cores semânticas vêm do sistema", () => {
    for (const morto of ["--vx-navy", "--vx-text-2", "--vx-text-3", "--vx-green", "--vx-red", "--vx-amber"]) {
      expect(SEM_COMENTARIOS, `${morto} ainda em uso`).not.toContain(`var(${morto})`);
    }
  });

  /**
   * Os que ficam são identidade de TERCEIROS: o azul do Facebook e o vermelho
   * do Google não seguem tema nenhum, e derivá-los de um token os tornaria
   * errados.
   */
  it("só sobram as cores de plataforma", () => {
    // Sem comentários: o comentário que explica por que o teal saiu menciona
    // `var(--vx-teal)`, e reprovaria a regra que ele documenta.
    const usados = new Set([...SEM_COMENTARIOS.matchAll(/var\((--vx-[a-z0-9-]+)\)/g)].map((m) => m[1]));
    expect([...usados].sort()).toEqual([
      "--vx-google", "--vx-google-bg", "--vx-meta", "--vx-meta-bg", "--vx-purple",
    ]);
  });
});
