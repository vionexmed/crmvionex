/**
 * Qual caractere separa as colunas de um CSV.
 *
 * O DEFEITO REAL: o Excel em português exporta com PONTO E VÍRGULA, porque a
 * vírgula é o separador decimal. Um arquivo de 835 leads médicos chegou assim, e
 * o parser — que só entendia vírgula — produziu UMA coluna chamada
 * "Nome;Especialidade;Cidade;..." com o mapeamento oferecendo um campo só.
 *
 * "CSV" significa coisas diferentes conforme o idioma de quem salvou, e assumir
 * vírgula é assumir inglês.
 */
import { describe, it, expect } from "vitest";
import { detectarSeparador, parseCSV } from "@/lib/csv";

describe("detecta o separador", () => {
  it("ponto e vírgula — o caso do Excel em português", () => {
    expect(detectarSeparador("Nome;Especialidade;Cidade\nJoão;Ortopedia;SP")).toBe(";");
  });

  it("vírgula — o caso em inglês", () => {
    expect(detectarSeparador("Name,Specialty,City\nJohn,Ortho,NY")).toBe(",");
  });

  it("tabulação — colado de planilha", () => {
    expect(detectarSeparador("Nome\tEspecialidade\nJoão\tOrtopedia")).toBe("\t");
  });

  /**
   * A contagem tem de ignorar o que está entre aspas. Um nome como
   * "Silva, João" não pode fazer a vírgula ganhar num arquivo de ponto e vírgula
   * — e é justamente em lista de pessoas que esse formato aparece.
   */
  it("vírgula dentro de aspas não vence o ponto e vírgula", () => {
    const csv = '"Silva, João";Ortopedia;SP\n"Souza, Ana";Cardio;RJ';
    expect(detectarSeparador(csv)).toBe(";");
  });

  it("olha só a PRIMEIRA linha, não o arquivo todo", () => {
    // Uma linha de dados cheia de vírgulas decimais não pode mudar a leitura do
    // cabeçalho.
    const csv = "Nome;Valor\nJoão;1,50\nAna;2,75\nPedro;3,10";
    expect(detectarSeparador(csv)).toBe(";");
  });

  it("arquivo de uma coluna cai em vírgula, e não quebra", () => {
    // Sem separador nenhum, o valor escolhido não muda o resultado.
    expect(detectarSeparador("Nome\nJoão\nAna")).toBe(",");
  });
});

describe("o parser respeita o separador escolhido", () => {
  it("ponto e vírgula produz as colunas certas", () => {
    const linhas = parseCSV("Nome;Especialidade;Cidade\nJoão;Ortopedia;SP", ";");
    expect(linhas[0]).toEqual(["Nome", "Especialidade", "Cidade"]);
    expect(linhas[1]).toEqual(["João", "Ortopedia", "SP"]);
  });

  it("campo entre aspas guarda o separador embutido", () => {
    const linhas = parseCSV('"Silva, João";Ortopedia\n"Souza; Ana";Cardio', ";");
    expect(linhas[0]).toEqual(["Silva, João", "Ortopedia"]);
    // Ponto e vírgula DENTRO das aspas não parte o campo.
    expect(linhas[1]).toEqual(["Souza; Ana", "Cardio"]);
  });

  it("aspas escapadas viram uma aspa", () => {
    expect(parseCSV('"Ele disse ""oi""";x', ";")[0]).toEqual(['Ele disse "oi"', "x"]);
  });

  it("CRLF do Excel não deixa linha fantasma", () => {
    const linhas = parseCSV("a;b\r\nc;d\r\n", ";");
    expect(linhas).toEqual([["a", "b"], ["c", "d"]]);
  });

  /**
   * O caso que o defeito produzia: lido com vírgula, o arquivo de ponto e
   * vírgula vira uma coluna só. O teste guarda a diferença entre os dois modos
   * para deixar claro que o separador é o que decide, não o conteúdo.
   */
  it("o mesmo arquivo, com o separador errado, vira UMA coluna", () => {
    const csv = "Nome;Especialidade;Cidade\nJoão;Ortopedia;SP";
    expect(parseCSV(csv, ",")[0]).toHaveLength(1);
    expect(parseCSV(csv, ";")[0]).toHaveLength(3);
  });
});
