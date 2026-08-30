/**
 * Consulta sem teto trunca em 1000 EM SILÊNCIO.
 *
 * O PostgREST corta e não sinaliza: o registro some da tela e não há como saber
 * por quê. Já mordeu duas vezes neste projeto — a lista de contatos e o seletor
 * de Atividades — e o levantamento achou 55 consultas sem `.range()` nem
 * `.limit()`.
 *
 * Estes testes cobrem as que carregam por uso, não as de tabela de configuração
 * (funis, etapas, chaves de API), onde a contagem é naturalmente pequena e um
 * teto seria ruído.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ler = (p: string) => readFileSync(p, "utf8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * Recorta UMA consulta encadeada: de `from("tabela")` até o ponto em que a
 * cadeia `.metodo(...)` acaba. Uma janela de N caracteres alcançaria a consulta
 * seguinte e reprovaria por vizinhança em vez de por comportamento.
 */
function trechoDaConsulta(src: string, tabela: string): string {
  const i = src.indexOf(`from("${tabela}")`);
  if (i < 0) return "";
  const resto = src.slice(i);
  // Cada elo é `.nome(` com parênteses equilibrados; para no primeiro caractere
  // que não continua a cadeia.
  let fim = resto.indexOf("(") + 1;
  let profundidade = 1;
  while (fim < resto.length) {
    const c = resto[fim];
    if (c === "(") profundidade++;
    else if (c === ")") {
      profundidade--;
      if (profundidade === 0) {
        const proximo = resto.slice(fim + 1).match(/^\s*\.\w+\s*\(/);
        if (!proximo) return resto.slice(0, fim + 1);
        // +1 porque `proximo` foi casado a partir de fim+1; sem ele a posição
        // cai SOBRE o "(", que a volta seguinte conta de novo e dessincroniza a
        // profundidade -- o recorte então engole as consultas de baixo.
        fim += proximo[0].length + 1;
        profundidade = 1;
        continue;
      }
    }
    fim++;
  }
  return resto;
}

describe("as consultas que crescem com o uso têm teto", () => {
  /**
   * `AtRiskPanel` baixava a tabela `activities` INTEIRA toda vez que o painel
   * abria, e usa só três campos. As regras de risco padrão olham de 7 a 21 dias,
   * então atividade mais antiga que o corte não muda decisão nenhuma.
   */
  it("AtRiskPanel limita as atividades e escolhe as colunas", () => {
    const src = semComentarios(ler("src/components/crm/AtRiskPanel.tsx"));
    // Recorta ATÉ a vírgula que fecha esta consulta, não uma janela de N
    // caracteres: logo abaixo vêm `pipeline_stages` e `risk_rules`, que usam
    // `select("*")` com razão -- são tabelas de configuração, e uma janela fixa
    // reprovaria o arquivo por causa delas.
    const consulta = trechoDaConsulta(src, "activities");
    expect(consulta).toMatch(/\.limit\(\d+\)/);
    expect(consulta).not.toContain('select("*")');
  });

  /**
   * O mesmo painel também baixava `deals` e `contacts` inteiros com
   * `select("*")`. O corte de 1000 do PostgREST já acontecia -- em silêncio e
   * em ordem arbitrária. Declarar o teto com `updated_at` ascendente faz o
   * descarte cair sobre quem tem MENOS risco, não sobre quem calhar.
   */
  it.each(["deals", "contacts"])(
    "AtRiskPanel ordena %s pelo mais parado antes de cortar",
    (tabela) => {
      const consulta = trechoDaConsulta(
        semComentarios(ler("src/components/crm/AtRiskPanel.tsx")),
        tabela,
      );
      expect(consulta).toMatch(/\.limit\(\d+\)/);
      expect(consulta).not.toContain('select("*")');
      expect(consulta).toMatch(/order\("updated_at", \{ ascending: true/);
    },
  );

  /**
   * `LeadScoring` baixava todos os contatos e cortava com `.slice()` na
   * renderização — trafegava a base inteira para exibir cem linhas.
   */
  it("LeadScoring corta no servidor, não no cliente", () => {
    const src = semComentarios(ler("src/pages/LeadScoring.tsx"));
    expect(trechoDaConsulta(src, "contacts")).toMatch(/\.limit\(\d+\)/);
  });

  /** Roda ao ABRIR o modal, e aparecia como demora entre clicar e a janela responder. */
  it("EmailComposeModal limita o que carrega ao abrir", () => {
    const src = semComentarios(ler("src/components/crm/EmailComposeModal.tsx"));
    for (const tabela of ["contacts", "deals", "email_templates"]) {
      const consulta = trechoDaConsulta(src, tabela);
      expect(consulta, `consulta a ${tabela} não encontrada`).not.toBe("");
      expect(consulta, `consulta a ${tabela} sem teto`).toMatch(/\.limit\(\d+\)/);
    }
  });

  it("activitiesApi.list declara o teto em vez de sofrê-lo", () => {
    // 1000 é o corte que o PostgREST aplica sozinho. Declarar não muda o
    // resultado; muda o fato de ser uma decisão, e deixa o lugar de paginar.
    const src = semComentarios(ler("src/lib/api/activities.ts"));
    expect(src).toMatch(/query\.limit\(1000\)/);
  });
});

describe("Reports confere o erro das sete consultas", () => {
  const src = semComentarios(ler("src/pages/Reports.tsx"));

  /**
   * Cada resultado virava `|| []` e o erro sumia. Falha de rede ou de RLS
   * produzia um relatório com zeros — e zero é uma AFIRMAÇÃO: alguém lê "nenhuma
   * venda no período" e decide com base nisso.
   */
  it("verifica erro antes de exibir número", () => {
    expect(src).toMatch(/\.find\(\(r\) => r\.error\)/);
    expect(src).toMatch(/setFalhou\(true\)/);
  });

  it("o estado de carregando é lido, não só escrito", () => {
    // Era `const [, setLoading]` — escrito e descartado.
    expect(src).not.toMatch(/const \[, setLoading\]/);
    expect(src).toContain("<LoadingState");
    expect(src).toContain("<ErrorState");
  });
});

/**
 * A varredura completa: nenhuma consulta a tabela que cresce fica sem teto nem
 * paginação.
 *
 * As tabelas de CONFIGURAÇÃO ficam de fora de propósito — funis, etapas, chaves
 * de API, motivos de perda. A contagem ali é naturalmente pequena e um teto
 * seria ruído que ninguém mantém.
 */
describe("nenhuma consulta a tabela que cresce fica solta", () => {
  const CRESCEM = ["contacts", "deals", "activities", "companies", "email_sequence_enrollments"];

  function arquivos(dir: string, saida: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) {
        if (nome !== "test") arquivos(caminho, saida);
      } else if (/\.tsx?$/.test(nome)) saida.push(caminho);
    }
    return saida;
  }

  it("varre src inteiro", () => {
    const soltas: string[] = [];
    for (const arquivo of arquivos("src")) {
      const src = readFileSync(arquivo, "utf8");
      for (const m of src.matchAll(/\.from\("(\w+)"\)/g)) {
        if (!CRESCEM.includes(m[1])) continue;
        const trecho = src.slice(m.index!, m.index! + 500);
        if (!/\.select\(/.test(trecho.slice(0, 200))) continue;
        // `count: "exact", head: true` não traz LINHA nenhuma -- devolve só o
        // número, e o corte de 1000 não se aplica.
        if (/count: "exact", head: true/.test(trecho.slice(0, 200))) continue;
        // `.in(...)` já é limitado pela lista de ids que o chamador tem.
        if (/\.limit\(|\.range\(|\.single\(\)|\.maybeSingle\(\)|\.in\(/.test(trecho.slice(0, 450))) continue;
        soltas.push(`${arquivo}:${src.slice(0, m.index!).split("\n").length}  ${m[1]}`);
      }
    }
    expect(soltas, `sem teto nem paginação:\n${soltas.join("\n")}`).toEqual([]);
  });
});

describe("limitar e paginar são escolhas diferentes", () => {
  /**
   * `.limit()` serve quando a tela MOSTRA uma lista e o corte só esconde o que
   * já estava fora de vista.
   *
   * Quando o resultado vira CONTAGEM, limitar produz um número errado que
   * parece certo -- e é pior que um registro faltando, porque ninguém desconfia
   * de um total. `SalesGoals` soma negócios, atividades e contatos por
   * vendedor para medir metas: num mês movimentado, mil atividades é pouco, e a
   * meta apareceria cumprida pela metade num mês em que foi batida.
   */
  it("SalesGoals pagina em vez de limitar", () => {
    const src = semComentarios(readFileSync("src/pages/SalesGoals.tsx", "utf8"));
    expect(src).toContain("buscarEmBlocos");
    // Três consultas, todas paginadas.
    expect(src.match(/buscarEmBlocos</g) ?? []).toHaveLength(3);
  });

  it("os seletores de contato paginam", () => {
    // Um destinatário que some do seletor não tem explicação em tela.
    for (const arquivo of ["src/lib/api/contacts.ts", "src/lib/api/emails.ts"]) {
      expect(semComentarios(readFileSync(arquivo, "utf8")), arquivo).toContain("buscarEmBlocos");
    }
  });

  /**
   * O laço estava escrito duas vezes em `api/contacts.ts`, e as outras dez
   * consultas que precisavam dele não o tinham.
   */
  it("o laço de paginação existe em um lugar só", () => {
    const soltos: string[] = [];
    for (const arquivo of ["src/lib/api/contacts.ts", "src/lib/api/emails.ts", "src/pages/SalesGoals.tsx"]) {
      const src = semComentarios(readFileSync(arquivo, "utf8"));
      if (/const CHUNK = 1000/.test(src)) soltos.push(arquivo);
    }
    expect(soltos, soltos.join("\n")).toEqual([]);
  });

  it("para no bloco incompleto, que é o único sinal do PostgREST", () => {
    const src = readFileSync("src/lib/paginar.ts", "utf8");
    expect(src).toMatch(/data\.length < BLOCO/);
  });
});
