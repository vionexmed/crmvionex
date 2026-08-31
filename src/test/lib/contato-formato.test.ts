/**
 * Nome e telefone de contato, padronizados na exibição.
 *
 * O defeito era visível numa captura de tela da lista de Contatos: a mesma
 * página mostrava "CLAUDIA MOSCHEN ANTUNES" ao lado de "Claudia Nascentes
 * Soares", e telefones em quatro formatos -- "5511985427007", "41 99974-8426",
 * "44991790710" e vazio.
 *
 * Os casos abaixo são os dados REAIS daquela tela, não exemplos inventados.
 *
 * A normalização é de EXIBIÇÃO. O banco continua com o que veio: reescrever
 * telefone alheio corromperia número estrangeiro e ramal, e a busca precisa
 * achar o que a pessoa digitou.
 */
import { describe, it, expect } from "vitest";
import {
  formatarEmail,
  formatarTelefone,
  nomeDoContato,
  normalizarCaixa,
} from "@/lib/contato-formato";

describe("caixa do nome", () => {
  it("TODO EM MAIÚSCULA vira Capitalizado", () => {
    expect(normalizarCaixa("CLAUDIA MOSCHEN ANTUNES")).toBe("Claudia Moschen Antunes");
    expect(normalizarCaixa("CRISTIANE RIBEIRO")).toBe("Cristiane Ribeiro");
  });

  /**
   * Caixa mista foi escrita por alguém que sabia o que queria. Reescrever seria
   * supor que sei melhor -- e destruiria "McCarthy" e "d'Ávila".
   */
  it("nome com minúscula é deixado em paz", () => {
    expect(normalizarCaixa("Claudia Nascentes Soares")).toBe("Claudia Nascentes Soares");
    expect(normalizarCaixa("Cláudio Barros Ohashi")).toBe("Cláudio Barros Ohashi");
    expect(normalizarCaixa("McCarthy")).toBe("McCarthy");
  });

  /**
   * Title-case ingênuo produz "Maria De Souza", e é por isso que ele parece
   * errado em português.
   */
  it("partícula fica em minúscula no meio do nome", () => {
    expect(normalizarCaixa("MARIA DE SOUZA")).toBe("Maria de Souza");
    expect(normalizarCaixa("JOAO DOS SANTOS E SILVA")).toBe("Joao dos Santos e Silva");
  });

  it("mas sobe no começo, porque existe como sobrenome", () => {
    expect(normalizarCaixa("DA SILVA JUNIOR")).toBe("Da Silva Junior");
  });

  it("acento sobrevive", () => {
    expect(normalizarCaixa("CRISLAINE ÉRIKA PELEGRINI SILVA")).toBe("Crislaine Érika Pelegrini Silva");
  });

  it("hífen e apóstrofo sobem depois do separador", () => {
    expect(normalizarCaixa("MARIA-CLARA D'AVILA")).toBe("Maria-Clara D'Avila");
  });

  it("vazio não vira 'undefined'", () => {
    expect(normalizarCaixa("")).toBe("");
    expect(normalizarCaixa("   ")).toBe("");
  });
});

describe("nome completo", () => {
  it("junta as duas partes", () => {
    expect(nomeDoContato("CLAUDIA", "MOSCHEN ANTUNES")).toBe("Claudia Moschen Antunes");
  });

  it("sobrenome ausente não deixa espaço sobrando", () => {
    expect(nomeDoContato("Cleiciane", null)).toBe("Cleiciane");
    expect(nomeDoContato("Cleiciane", "")).toBe("Cleiciane");
  });

  it("sem nome nenhum diz isso, não fica em branco", () => {
    expect(nomeDoContato(null)).toBe("Sem nome");
  });
});

describe("telefone", () => {
  /** Todos os formatos são de linhas reais da lista. */
  it.each([
    ["5511985427007", "(11) 98542-7007"],
    ["5522988222267", "(22) 98822-2267"],
    ["5551994413801", "(51) 99441-3801"],
    ["5554912470320", "(54) 91247-0320"],
    ["5543996256444", "(43) 99625-6444"],
    ["5537999881392", "(37) 99988-1392"],
    ["5514996089092", "(14) 99608-9092"],
    ["5545999280101", "(45) 99928-0101"],
    // Já mascarado, sem código de país
    ["41 99974-8426", "(41) 99974-8426"],
    // Sem máscara e sem código de país
    ["44991790710", "(44) 99179-0710"],
    // Fixo de 8 dígitos
    ["551133334444", "(11) 3333-4444"],
    ["1133334444", "(11) 3333-4444"],
  ])("%s → %s", (entrada, saida) => {
    expect(formatarTelefone(entrada)).toBe(saida);
  });

  it("sem telefone mostra travessão", () => {
    expect(formatarTelefone(null)).toBe("—");
    expect(formatarTelefone("")).toBe("—");
    expect(formatarTelefone("   ")).toBe("—");
  });

  /**
   * A decisão importante. Máscara errada é PIOR que nenhuma: ela afirma um
   * formato. Número estrangeiro e ramal aparecem intactos.
   */
  it("o que não reconhece volta como veio", () => {
    expect(formatarTelefone("+1 415 555 2671")).toBe("+1 415 555 2671");
    expect(formatarTelefone("11 3333-4444 r. 205")).toBe("11 3333-4444 r. 205");
    expect(formatarTelefone("123")).toBe("123");
  });

  it("não inventa DDD quando não há", () => {
    expect(formatarTelefone("985427007")).toBe("98542-7007");
    expect(formatarTelefone("33334444")).toBe("3333-4444");
  });
});

describe("e-mail", () => {
  /**
   * "Crisrisso2018@gmail.com" e "crisrisso2018@gmail.com" são o MESMO endereço.
   * Exibir como foi digitado faz a lista parecer ter duas pessoas.
   */
  it("desce para minúscula", () => {
    expect(formatarEmail("Crisrisso2018@gmail.com")).toBe("crisrisso2018@gmail.com");
  });

  it("sem e-mail mostra travessão", () => {
    expect(formatarEmail(null)).toBe("—");
  });
});
