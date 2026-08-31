/**
 * Importação de contatos por planilha.
 *
 * Três coisas mudaram, e as três têm armadilha própria:
 *
 * 1. XLSX além de CSV. O leitor entra por import DINÂMICO -- estático, ele
 *    entraria no pacote da entrada e a tela de login baixaria um parser de
 *    planilha.
 * 2. As perguntas do cadastro passaram a ser mapeáveis. Elas NÃO são colunas de
 *    `contacts`: vivem em `metadata`, jsonb. Mapear sem distinguir tentaria
 *    gravar coluna inexistente e o insert levaria a planilha inteira com ele.
 * 3. A origem virou o nome do arquivo. Isso quebraria o filtro "Importação" da
 *    página Contatos, que casava o texto `csv_import` de forma exata.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CADASTRO_FIELDS, getContactOrigin } from "@/lib/contact-options";

const ler = (f: string) => readFileSync(f, "utf8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const MODAL = "src/components/crm/CSVImportModal.tsx";

describe("o arquivo pode ser planilha", () => {
  const src = semComentarios(ler(MODAL));

  it("aceita xlsx e csv no seletor", () => {
    expect(src).toMatch(/accept="\.xlsx,\.xls,\.csv"/);
  });

  it("decide pela extensão", () => {
    expect(src).toMatch(/\/\\\.xlsx\?\$\/i\.test\(file\.name\)/);
  });

  /**
   * Estático, o leitor entra no pacote da entrada. A regra de chunk em
   * vite.config só ajuda se o import for dinâmico.
   */
  it("o leitor entra por import dinâmico", () => {
    expect(src).toMatch(/await import\("read-excel-file\/browser"\)/);
    expect(src).not.toMatch(/^import .*read-excel-file/m);
  });

  /**
   * Duas armadilhas do pacote, as duas apontadas pelo compilador na hora:
   * não há export raiz (só subcaminhos por ambiente), e na v9 o export PADRÃO
   * devolve a lista de ABAS, não as linhas.
   */
  it("usa readSheet, não o export padrão", () => {
    expect(src).toContain("{ readSheet }");
    expect(src).not.toMatch(/default: lerXlsx/);
  });

  it("permite escolher o mesmo arquivo de novo", () => {
    // Sem limpar o value, o input não dispara change na segunda vez e a tela
    // parece travada depois de um erro.
    expect(src).toMatch(/e\.target\.value = ""/);
  });
});

describe("todas as perguntas do cadastro são mapeáveis", () => {
  const src = semComentarios(ler(MODAL));

  it("os campos saem de CADASTRO_FIELDS, não de uma segunda lista", () => {
    // Uma lista própria aqui divergiria da ficha do contato na primeira
    // pergunta nova -- e a divergência seria silenciosa.
    expect(src).toContain("CADASTRO_FIELDS.map");
  });

  it("as perguntas vão para metadata, não para coluna", () => {
    expect(src).toContain("PREFIXO_META");
    expect(src).toMatch(/fieldKey\.startsWith\(PREFIXO_META\)/);
  });

  it("resposta vazia não é gravada", () => {
    // Gravar string vazia faria a ficha exibir o rótulo sem resposta.
    expect(src).toMatch(/if \(valor\) perguntas\[/);
  });

  /** Se a lista encurtar, alguma pergunta parou de ser importável. */
  it("há pergunta para mapear", () => {
    expect(CADASTRO_FIELDS.length).toBeGreaterThanOrEqual(13);
  });
});

describe("a origem é o nome do documento", () => {
  const src = semComentarios(ler(MODAL));

  it("grava a origem escolhida em source", () => {
    expect(src).toMatch(/source: origemFinal/);
  });

  /**
   * Editável, e não cravada no nome do arquivo.
   *
   * Planilha encaminhada chega com nome que não descreve nada ("Pasta1.xlsx",
   * "leads (3).xlsx"), e quem importa sabe de onde veio. Sem poder trocar, a
   * origem viraria lixo exatamente nas listas de terceiros -- que são as que
   * mais precisam de rastro.
   */
  it("a origem é um campo editável, nos DOIS passos", () => {
    // No passo de envio, porque quem sabe de onde a lista veio sabe disso ANTES
    // de escolher o arquivo -- pedir só depois obriga a lembrar no meio de
    // outra tarefa. E no mapeamento, para conferir.
    expect(src).toMatch(/id="origem-antes"/);
    expect(src).toMatch(/id="origem-import"/);
  });

  /**
   * A sugestão do nome do arquivo NÃO pode sobrescrever o que a pessoa digitou
   * antes de escolher o arquivo -- seria perder o trabalho dela no momento
   * exato em que ela avança.
   */
  it("escolher o arquivo não apaga a origem já digitada", () => {
    expect(src).toMatch(/setOrigem\(\(atual\) => atual\.trim\(\) \|\| nomeArquivo/);
  });

  it("origem em branco nunca chega ao banco", () => {
    // Selo sem texto parece defeito da tela.
    expect(src).toMatch(/origem\.trim\(\) \|\|[\s\S]{0,120}"Importação"/);
  });

  it("tira a extensão", () => {
    // "Leads Congresso 2026" lê melhor que o mesmo nome com extensão,
    // num selo de 11px -- e a extensão não distingue nada que importe.
    expect(src).toMatch(/arquivo\.replace\(\/\\\.\[\^\.\]\+\$\//);
  });

  it("arquivo sem nome não deixa a origem vazia", () => {
    expect(src).toMatch(/\|\| "Importação"/);
  });

  /**
   * O selo NÃO precisou de caso novo: `getContactOrigin` já tinha um ramo final
   * que exibe o texto cru da origem. É o que faz o nome do arquivo aparecer.
   */
  it("o selo mostra o nome do arquivo sem caso novo", () => {
    const o = getContactOrigin({ source: "Leads Congresso 2026" });
    expect(o.label).toBe("Leads Congresso 2026");
  });

  it("os valores antigos continuam virando 'Importação'", () => {
    for (const v of ["csv_import", "import", "importacao"]) {
      expect(getContactOrigin({ source: v }).label).toBe("Importação");
    }
  });
});

describe("o filtro Importação continua achando os importados", () => {
  const api = semComentarios(ler("src/lib/api/contacts.ts"));

  /**
   * Com o nome do arquivo em `source`, casar o texto pararia de funcionar: uma
   * planilha chamada "Congresso 2026" não seria reconhecida como importação por
   * nada. A marca de data é o que independe do nome.
   */
  it("filtra pela marca importado_em", () => {
    expect(api).toContain("metadata->>importado_em.not.is.null");
  });

  it("e mantém os valores legados, para os importados de antes", () => {
    expect(api).toContain("metadata->>source.eq.csv_import");
  });

  it("a importação grava a marca", () => {
    expect(semComentarios(ler(MODAL))).toMatch(/importado_em: importadoEm/);
  });
});

describe("o estágio segue sem tocar na coluna legada", () => {
  const src = semComentarios(ler(MODAL));

  /**
   * A armadilha do CLAUDE.md, e a razão de contato importado nascer
   * "qualificado" sem ninguém ter qualificado: no INSERT o gatilho dá a vitória
   * ao `status`.
   */
  it("apaga status e escreve lifecycle_stage", () => {
    expect(src).toContain("delete record.status");
    expect(src).toContain("ESTAGIO_DA_PLANILHA");
  });
});

describe("célula de planilha vira texto de um jeito só", () => {
  const src = semComentarios(ler(MODAL));

  it("data passa pelo formatador compartilhado", () => {
    // `toLocaleDateString` inline está proibido por teste -- eram 18 arquivos
    // com oito formatos.
    expect(src).toContain("formatarData(c)");
    expect(src).not.toContain("toLocaleDateString");
  });

  it("booleano vira Sim/Não, não true/false", () => {
    expect(src).toMatch(/\? "Sim" : "Não"/);
  });
});
