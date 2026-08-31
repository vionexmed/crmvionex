/**
 * A tabela de Contatos cabe na tela — e nada se perdeu no caminho.
 *
 * Eram NOVE colunas, e era preciso arrastar para o lado para ver o resto. Duas
 * delas -- Empresa e Especialidade -- vinham vazias em toda a página quando a
 * lista é de leads importados: largura morta empurrando o resto para fora.
 *
 * Campos parentes passaram a dividir célula, e sobraram seis.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE ARQUIVO EXISTE PARA PEGAR
 *
 * Juntar colunas TIRA cabeçalho, e cabeçalho é onde a ordenação vive. Ao fundir
 * as nove em seis eu removi os cabeçalhos de "Email" e "Especialidade" e, com
 * eles, a única forma de ordenar por esses campos -- a API continuava sabendo, e
 * não havia mais como pedir. Nenhum teste reprovou, porque a perda é de
 * ALCANCE, não de código: nada quebra, só deixa de ser possível.
 *
 * A regra abaixo é a que faltava: toda chave de ordenação declarada tem de ser
 * alcançável na interface.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const TELA = "src/pages/Contacts.tsx";
const src = readFileSync(TELA, "utf8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const codigo = semComentarios(src);

describe("toda ordenação declarada é alcançável", () => {
  /** As chaves que o tipo `SortKey` da tela declara. */
  const declaradas = (() => {
    const m = /type SortKey = ([^;]+);/.exec(codigo);
    expect(m, "type SortKey não encontrado").toBeTruthy();
    return [...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  })();

  it("o tipo declara as cinco", () => {
    expect(declaradas.sort()).toEqual(["created_at", "email", "name", "status", "title"]);
  });

  /**
   * Alcançável por cabeçalho clicável OU pelo seletor "Ordenar por". As duas
   * formas contam: uma célula compartilhada só ordena por um campo, então o
   * seletor é o que cobre o resto.
   */
  it.each(declaradas)("%s pode ser escolhida na interface", (campo) => {
    const porCabecalho = codigo.includes(`campo="${campo}"`);
    const porSeletor = new RegExp(`\\["${campo}", "`).test(codigo);
    expect(
      porCabecalho || porSeletor,
      `nenhum cabeçalho nem opção de seletor alcança "${campo}"`,
    ).toBe(true);
  });

  it("a API aceita exatamente as mesmas chaves", () => {
    // Divergir faria a tela oferecer uma ordenação que o servidor ignora, e a
    // lista voltaria na ordem anterior sem dizer por quê.
    const api = readFileSync("src/lib/api/contacts.ts", "utf8");
    const m = /sortKey\?: ([^;]+);/.exec(api);
    expect(m).toBeTruthy();
    const naApi = [...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
    expect(naApi.sort()).toEqual(declaradas.sort());
  });
});

describe("a tabela não volta a ter coluna morta", () => {
  /**
   * Uma coluna própria para e-mail era o par de uma célula que JÁ mostrava o
   * e-mail sob o nome -- só que escondida em `sm:hidden`. Duas cópias do mesmo
   * dado, uma delas consumindo uma coluna.
   */
  it("o e-mail vive sob o nome, sempre visível", () => {
    expect(codigo).toMatch(/block truncate text-xs text-muted-foreground">\{formatarEmail\(c\.email\)\}/);
    expect(codigo).not.toMatch(/sm:hidden">\{formatarEmail/);
  });

  /**
   * O AVATAR é de onde vem o espaço, e não da fusão de colunas.
   *
   * Eram 44px por linha para desenhar iniciais de gente que não tem foto --
   * decorativo, e o usuário pediu para sair. Junto com o e-mail sob o nome, é o
   * que permitiu Empresa, Especialidade e Origem voltarem a ter coluna própria:
   * são três perguntas diferentes, e juntá-las obrigava a ler a célula inteira
   * para achar uma.
   */
  it("a tabela não desenha avatar", () => {
    const tabela = codigo.slice(codigo.indexOf("<TableHeader>"), codigo.indexOf("</Table>"));
    expect(tabela).not.toMatch(/<Avatar/);
  });

  it("situação e origem são colunas separadas", () => {
    expect(codigo).toMatch(/<TableCell><LifecycleBadge/);
    expect(codigo).toMatch(/<OriginBadge metadata=/);
  });

  it("são oito cabeçalhos, não nove", () => {
    // `<TableHead[\s>]` e não `<TableHead`: o segundo casa com `<TableHeader>`
    // também, e o teste contava sete. Prefixo mordendo prefixo -- terceira vez
    // que essa família de erro aparece nesta sessão.
    const cabecalhos = (codigo.match(/<TableHead[\s>]/g) || []).length;
    expect(cabecalhos, "mudou o número de colunas").toBe(8);
  });
});

describe("o CSV não segue a tela", () => {
  /**
   * A tela junta para caber; a exportação NÃO pode juntar. Ela existe para
   * reimportar e para cruzar com outro sistema, e campo colado atrapalha as
   * duas -- reimportar um "Empresa · Especialidade" não recuperaria nem um nem
   * outro.
   */
  it("cada campo continua em coluna própria", () => {
    for (const coluna of ["Nome:", "Sobrenome:", "Email:", "Telefone:", "Cargo:", "Empresa:"]) {
      expect(codigo, `${coluna} saiu da exportação`).toContain(coluna);
    }
  });
});
