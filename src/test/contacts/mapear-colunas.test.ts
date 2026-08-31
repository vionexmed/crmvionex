/**
 * Cabeçalho de planilha → campo do CRM.
 *
 * O CASO REAL, e é o que este arquivo existe para travar:
 * `Leads_Medicos_Revisado_(CONSOLIDADA).csv` tem sete colunas, e o mapeamento
 * automático acertou DUAS. Cinco ficaram em "Ignorar":
 *
 *   Nome           → Nome          ✔
 *   Especialidade  → Ignorar       ✘  (o campo se chamava "Cargo")
 *   Cidade         → Cidade/Estado ✔
 *   WhatsApp       → Ignorar       ✘  (procurava "telefone" ou "phone")
 *   E-mail         → Ignorar       ✘  ("e-mail".includes("email") é FALSO)
 *   Atendimento    → Ignorar       ✘
 *   Observações    → Ignorar       ✘
 *
 * A causa das cinco: comparação de texto CRU com `includes`. A saída foi lista
 * explícita de sinônimos sobre chave sem acento e sem pontuação.
 */
import { describe, it, expect } from "vitest";
import {
  CAMPOS_DE_CONTATO, CAMPOS_DE_EMPRESA, EMPRESA, IGNORAR, NOTA, PREFIXO_META,
  mapearColunas,
} from "@/lib/importar-colunas";

const mapear = (cabecalho: string[]) => {
  const m = mapearColunas(cabecalho, CAMPOS_DE_CONTATO);
  return cabecalho.map((_, i) => m[i]);
};

describe("o arquivo real que expôs o defeito", () => {
  /** Os cabeçalhos EXATOS, com acento e hífen, como vieram do Excel. */
  const CABECALHO = ["Nome", "Especialidade", "Cidade", "WhatsApp", "E-mail", "Atendimento", "Observações"];

  it("acerta as seis que têm destino", () => {
    const r = mapear(CABECALHO);
    expect(r[0]).toBe("first_name");
    expect(r[1]).toBe("title");                       // era Ignorar
    expect(r[2]).toBe(`${PREFIXO_META}cidade`);
    expect(r[3]).toBe("phone");                       // era Ignorar
    expect(r[4]).toBe("email");                       // era Ignorar
    expect(r[6]).toBe(NOTA);                          // era Ignorar
  });

  /**
   * "Atendimento" NÃO tem destino, e ficar em "Ignorar" é o certo. Inventar um
   * campo para ela gravaria o dado no lugar errado, o que é pior que não gravar
   * — a pessoa pode mapear à mão em três segundos.
   */
  it("e deixa em Ignorar a que não tem destino", () => {
    expect(mapear(CABECALHO)[5]).toBe(IGNORAR);
  });
});

describe("as variações que aparecem de verdade", () => {
  it.each([
    ["E-mail", "email"], ["e mail", "email"], ["EMAIL", "email"], ["Correio eletrônico", "email"],
    ["WhatsApp", "phone"], ["Whats", "phone"], ["Telefone", "phone"], ["Celular", "phone"], ["Zap", "phone"],
    ["Especialidade", "title"], ["Cargo", "title"], ["Profissão", "title"],
    ["Sobrenome", "last_name"],
    ["Nome completo", "first_name"], ["Nome", "first_name"], ["Médico", "first_name"],
    ["Observações", NOTA], ["Obs", NOTA], ["Anotações", NOTA], ["Comentários", NOTA],
    ["Empresa", EMPRESA], ["Clínica", EMPRESA], ["Hospital", EMPRESA], ["Instituição", EMPRESA],
    ["LinkedIn", "linkedin_url"],
    ["Ciclo de vida", "lifecycle_stage"], ["Estágio", "lifecycle_stage"],
  ])("%s → %s", (header, esperado) => {
    expect(mapear([header])[0]).toBe(esperado);
  });
});

describe("um destino recebe UMA coluna", () => {
  /**
   * Duas colunas para o mesmo campo fariam a segunda sobrescrever a primeira em
   * silêncio — e a planilha entraria com metade do dado sem ninguém notar.
   */
  it("a segunda coluna repetida cai em Ignorar", () => {
    const r = mapear(["Nome", "Nome"]);
    expect(r[0]).toBe("first_name");
    expect(r[1]).toBe(IGNORAR);
  });

  /**
   * "Sobrenome" contém "nome". Se `first_name` viesse antes na lista, toda
   * coluna de sobrenome cairia em nome — e é por isso que a ordem de SINONIMOS
   * tem comentário próprio.
   */
  it("Sobrenome não é engolido por Nome", () => {
    expect(mapear(["Nome", "Sobrenome"])).toEqual(["first_name", "last_name"]);
    // E na ordem inversa também.
    expect(mapear(["Sobrenome", "Nome"])).toEqual(["last_name", "first_name"]);
  });
});

describe("as perguntas do cadastro", () => {
  it("casam pelo rótulo exibido", () => {
    expect(mapear(["Cidade / Estado"])[0]).toBe(`${PREFIXO_META}cidade`);
    expect(mapear(["Nível de interesse"])[0]).toBe(`${PREFIXO_META}interesse`);
    expect(mapear(["CRM / CREFITO"])[0]).toBe(`${PREFIXO_META}registro_profissional`);
  });

  it("e pela chave interna", () => {
    expect(mapear(["registro_profissional"])[0]).toBe(`${PREFIXO_META}registro_profissional`);
    expect(mapear(["usa_ondas_choque"])[0]).toBe(`${PREFIXO_META}usa_ondas_choque`);
  });
});

describe("empresas usam a própria lista", () => {
  it("lá 'Nome' é a coluna name, não o contato", () => {
    const m = mapearColunas(["Nome", "Website"], CAMPOS_DE_EMPRESA);
    expect(m[0]).toBe("name");
    expect(m[1]).toBe("website");
  });

  /** `first_name` não existe em Empresa; oferecer daria erro no insert. */
  it("e nenhum campo de contato aparece", () => {
    expect(CAMPOS_DE_EMPRESA.some((f) => f.key === "first_name")).toBe(false);
    expect(CAMPOS_DE_EMPRESA.some((f) => f.key === NOTA)).toBe(false);
  });
});

describe("toda opção do seletor tem tratamento", () => {
  /**
   * O usuário pediu "todas as opções funcionando". Uma opção oferecida e não
   * tratada gravaria a coluna numa chave que o PostgREST recusa — e o insert
   * levaria a planilha INTEIRA com ele.
   */
  it("são colunas, perguntas com prefixo, ou os três especiais", () => {
    const colunas = ["first_name", "last_name", "email", "phone", "title", "lifecycle_stage", "linkedin_url"];
    for (const f of CAMPOS_DE_CONTATO) {
      const conhecido =
        colunas.includes(f.key) ||
        f.key.startsWith(PREFIXO_META) ||
        [NOTA, EMPRESA, IGNORAR].includes(f.key);
      expect(conhecido, `destino sem tratamento: ${f.key}`).toBe(true);
    }
  });

  it("e há pelo menos as 13 perguntas do cadastro", () => {
    expect(CAMPOS_DE_CONTATO.filter((f) => f.key.startsWith(PREFIXO_META)).length)
      .toBeGreaterThanOrEqual(13);
  });
});
