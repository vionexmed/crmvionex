/**
 * Abordagem sem lead vinculado não é abordagem.
 *
 * Três e-mails de teste apareciam em "Abordagens realizadas": linhas de
 * `emails` com `status = 'sent'` e `contact_id` nulo. O drill-down as rotulava
 * "Sem lead vinculado" e mesmo assim as somava.
 *
 * O que torna isso um defeito, e não faxina: uma abordagem sem contato NUNCA
 * pode virar resposta, reunião ou venda -- as métricas seguintes casam por
 * `contact_id`. Ela entra no denominador da conversão e não tem como sair do
 * numerador.
 *
 * E o card já se contradizia: `pessoas_abordadas` -- o "· N pessoas" ao lado do
 * número -- JÁ exigia `contact_id IS NOT NULL`. Dois números do mesmo card
 * usavam critérios diferentes.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTE ARQUIVO PROCURA A MIGRAÇÃO EM VEZ DE NOMEÁ-LA
 *
 * Os outros testes de métrica leem nomes FIXOS de migração. Isso os deixa
 * obsoletos em silêncio: quando uma migração nova redefine `sdr_metrics`, o
 * teste continua verde afirmando coisas sobre uma definição que já foi
 * substituída. Foi o que aconteceu aqui -- 92 testes de painel passaram sem
 * olhar uma linha do que mudou.
 *
 * Aqui a migração vigente é DESCOBERTA: a última, por ordem de nome de arquivo,
 * que declara a função. É a mesma ordem que o Supabase usa para aplicar.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
const ARQUIVOS = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

/** A última migração que declara a função — a que vale depois de aplicar tudo. */
function migracaoVigente(fn: string): string {
  const marca = new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${fn}\\s*\\(`);
  const achado = [...ARQUIVOS].reverse().find((f) =>
    marca.test(readFileSync(join(DIR, f), "utf8")),
  );
  if (!achado) throw new Error(`nenhuma migração declara ${fn}`);
  return achado;
}

/** O corpo de UMA função, do CREATE dela até o próximo CREATE (ou o fim). */
function corpo(sql: string, fn: string): string {
  const ini = sql.search(new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${fn}\\s*\\(`));
  expect(ini, `${fn} não encontrada`).toBeGreaterThan(-1);
  const resto = sql.slice(ini + 10);
  const prox = resto.search(/CREATE (OR REPLACE )?FUNCTION public\./);
  return prox < 0 ? sql.slice(ini) : sql.slice(ini, ini + 10 + prox);
}

const FUNCOES = ["sdr_metrics", "sdr_series", "sdr_by_owner", "sdr_metric_leads"];

describe("as quatro funções vivem na mesma migração", () => {
  /**
   * CLAUDE.md: card, gráfico, lista e desempenho contam a mesma coisa em
   * funções separadas, e mexer numa só faz clicar no número abrir uma lista com
   * outro total. Se elas passarem a ser redefinidas em migrações diferentes, o
   * critério pode divergir sem que nada acuse.
   */
  it("a mesma migração declara as quatro", () => {
    const vigentes = FUNCOES.map(migracaoVigente);
    expect(new Set(vigentes).size, `divergiram: ${vigentes.join(", ")}`).toBe(1);
  });
});

/**
 * As três fontes de abordagem, e o predicado que identifica cada uma.
 *
 * Consulta que NÃO tem o predicado não é abordagem -- é a taxa de resposta, que
 * lê as mesmas tabelas nas duas direções -- e por isso é ignorada aqui.
 */
const FONTES: { tabela: string; alias: string; predicado: RegExp[] }[] = [
  { tabela: "activities", alias: "a", predicado: [/type IN \('call', 'email'\)/] },
  // Só `direction = 'outbound'` NÃO basta: casava também com as subconsultas
  // `NOT EXISTS (… WHERE e.contact_id = c.id AND e.direction = 'outbound')`, que
  // pertencem a outra métrica -- "leads sem nenhuma abordagem" -- e onde o
  // contato já vem amarrado pelo join. O filtro de status é o que separa.
  { tabela: "emails", alias: "e", predicado: [/direction = 'outbound'/, /status = 'sent'/] },
  { tabela: "whatsapp_messages", alias: "w",
    predicado: [/direction = 'outbound'/, /status IN \('sent', 'delivered', 'read'\)/] },
];

/**
 * Os blocos que leem uma tabela, delimitados até o fim da cláusula.
 *
 * Janela de tamanho fixo NÃO serve: já custou tempo neste projeto: 400 caracteres
 * a partir do `from()` invadiam a consulta vizinha. Aqui o corte é no primeiro
 * fechamento de cláusula -- `GROUP BY`, `UNION`, `ORDER BY` ou um `)` que abre
 * a linha.
 */
function blocosQueLeem(corpoFn: string, tabela: string): string[] {
  const blocos: string[] = [];
  const re = new RegExp(`FROM public\\.${tabela}\\s`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(corpoFn))) {
    const resto = corpoFn.slice(m.index);
    // Inclui `(` e linha em branco: sem eles o corte falhava e um bloco engolia
    // o resto da função inteira, até o `$$;`.
    const fim = resto.search(/\n\s*(GROUP BY|UNION|ORDER BY|SELECT|AND NOT EXISTS)|\n\s*[()+]|\n\n/);
    blocos.push(fim < 0 ? resto : resto.slice(0, fim));
  }
  return blocos;
}

describe.each(FUNCOES)("%s", (fn) => {
  const arquivo = migracaoVigente(fn);
  const sql = corpo(readFileSync(join(DIR, arquivo), "utf8"), fn);

  it.each(FONTES)("toda leitura de $tabela que conta abordagem exige contact_id", (fonte) => {
    const relevantes = blocosQueLeem(sql, fonte.tabela)
      .filter((b) => fonte.predicado.every((p) => p.test(b)));
    // Nem toda função lê as três tabelas para abordagem; o que não pode é ler e
    // não filtrar.
    for (const bloco of relevantes) {
      expect(
        // Pelo ALIAS, não solto. A primeira versão aceitava qualquer
        // `contact_id IS NOT NULL` no bloco -- e como o delimitador chegou a
        // engolir a fonte seguinte, o filtro do e-mail satisfazia a checagem da
        // atividade. Removi o filtro de `activities` de propósito e o teste
        // continuou verde: foi assim que este furo apareceu.
        new RegExp(`${fonte.alias}\\.contact_id IS NOT NULL`).test(bloco),
        `${fn} / ${fonte.tabela}: bloco sem contact_id\n\n${bloco}`,
      ).toBe(true);
    }
  });
});

describe("a taxa de entrega continua contando tudo", () => {
  /**
   * Em `sdr_metrics`, o CTE `envio` produz três números com propósitos
   * diferentes:
   *
   *   total     denominador da taxa de ENTREGA -- toda tentativa, inclusive
   *             para número que não é contato
   *   entregue  numerador dessa taxa
   *   enviado   o que vira ABORDAGEM
   *
   * Só `enviado` foi restrito. Restringir os três faria a taxa de entrega
   * esconder as recusas da Meta em vez de mostrá-las -- que é justamente o que
   * ela existe para revelar.
   */
  const sql = corpo(
    readFileSync(join(DIR, migracaoVigente("sdr_metrics")), "utf8"),
    "sdr_metrics",
  );

  it("enviado exige contato", () => {
    expect(sql).toMatch(/FILTER \(WHERE status IN \('sent', 'delivered', 'read'\)\s*\n?\s*AND contact_id IS NOT NULL\)/);
  });

  it("entregue NÃO exige contato", () => {
    const m = sql.match(/count\(\*\) FILTER \(WHERE status IN \('delivered', 'read'\)\)/);
    expect(m, "o filtro de `entregue` mudou de forma").toBeTruthy();
  });

  it("total não filtra nada além da direção", () => {
    expect(sql).toMatch(/count\(\*\) AS total,/);
  });
});

describe("o card não se contradiz consigo mesmo", () => {
  /**
   * `abordagens` e `pessoas_abordadas` aparecem lado a lado no MESMO card
   * ("5 · 2 pessoas"). Antes usavam critérios diferentes: pessoas exigia
   * contato, abordagens não. Agora a diferença entre os dois é só o DISTINCT.
   */
  const sql = corpo(
    readFileSync(join(DIR, migracaoVigente("sdr_metrics")), "utf8"),
    "sdr_metrics",
  );

  it("pessoas_abordadas continua exigindo contato", () => {
    // Já era assim antes desta mudança -- o teste existe para que continue.
    expect(sql).toMatch(/count\(DISTINCT alvo\)/);
    expect(sql).toMatch(/a\.contact_id IS NOT NULL/);
    expect(sql).toMatch(/e\.contact_id IS NOT NULL/);
    expect(sql).toMatch(/w\.contact_id IS NOT NULL/);
  });
});
