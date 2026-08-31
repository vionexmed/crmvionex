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
  camposParaAtualizar, mapearColunas, planejarEmpresas,
} from "@/lib/importar-colunas";

const mapear = (cabecalho: string[]) => {
  const m = mapearColunas(cabecalho, CAMPOS_DE_CONTATO);
  return cabecalho.map((_, i) => m[i]);
};

describe("o arquivo real que expôs o defeito", () => {
  /** Os cabeçalhos EXATOS, com acento e hífen, como vieram do Excel. */
  const CABECALHO = ["Nome", "Especialidade", "Cidade", "WhatsApp", "E-mail", "Atendimento", "Observações"];

  it("acerta as SETE colunas", () => {
    const r = mapear(CABECALHO);
    expect(r[0]).toBe("first_name");
    expect(r[1]).toBe("title");                       // era Ignorar
    expect(r[2]).toBe(`${PREFIXO_META}cidade`);
    expect(r[3]).toBe("phone");                       // era Ignorar
    expect(r[4]).toBe("email");                       // era Ignorar
    expect(r[5]).toBe(`${PREFIXO_META}atendido_por`);  // era Ignorar
    expect(r[6]).toBe(NOTA);                          // era Ignorar
  });

  /**
   * "Atendimento" ficava em Ignorar até o usuário explicar o que era: QUEM
   * atendeu o médico no estande do congresso. Ganhou campo próprio
   * (`atendido_por`), separado de "Responsável pelo cadastro" — aquele é quem
   * digitou a ficha, este é quem conversou, e num congresso quase nunca são a
   * mesma pessoa.
   */
  it("Atendimento é quem atendeu, não a especialidade", () => {
    expect(mapear(["Atendimento"])[0]).toBe(`${PREFIXO_META}atendido_por`);
    expect(mapear(["Atendente"])[0]).toBe(`${PREFIXO_META}atendido_por`);
    // E não rouba a coluna de especialidade.
    expect(mapear(["Especialidade", "Atendimento"]))
      .toEqual(["title", `${PREFIXO_META}atendido_por`]);
  });

  it("coluna sem destino nenhum continua em Ignorar", () => {
    // Inventar um campo gravaria o dado no lugar errado, o que é pior que não
    // gravar -- a pessoa mapeia à mão em três segundos.
    expect(mapear(["Coluna Que Ninguém Conhece"])[0]).toBe(IGNORAR);
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

describe("empresas: quais criar e quais reusar", () => {
  /**
   * DEFEITO QUE ISTO CORRIGE: a versão anterior fazia `new Set` das grafias
   * EXATAS. "Hospital X" e "hospital x" eram duas entradas, as duas caíam na
   * lista de criar, e nasciam DUAS empresas para a mesma instituição — a
   * duplicata que o código dizia evitar.
   */
  it("grafias diferentes da mesma empresa criam UMA", () => {
    const plano = planejarEmpresas(
      ["Hospital Santa Casa", "HOSPITAL SANTA CASA", "hospital santa casa"],
      [],
    );
    expect(plano.aCriar).toHaveLength(1);
    // A grafia da PRIMEIRA aparição: é a que a pessoa reconhece na tela, e
    // escolher a "melhor" seria inventar critério.
    expect(plano.aCriar[0]).toBe("Hospital Santa Casa");
  });

  it("espaço a mais e acento não criam empresa nova", () => {
    const plano = planejarEmpresas(
      ["Clínica  São  José", "Clinica Sao Jose", " CLÍNICA SÃO JOSÉ "],
      [],
    );
    expect(plano.aCriar).toHaveLength(1);
  });

  it("reusa a que já existe, em qualquer caixa", () => {
    const plano = planejarEmpresas(
      ["hospital x", "Hospital Y"],
      [{ id: "id-x", name: "HOSPITAL X" }],
    );
    expect(plano.aCriar).toEqual(["Hospital Y"]);
    expect(plano.porChave.get("hospital x")).toBe("id-x");
  });

  /**
   * Fundir DEMAIS é pior que fundir de menos: empresa duplicada é chateação
   * visível e reversível; contato ligado à empresa ERRADA é dado falso que
   * ninguém percebe.
   */
  it("nomes parecidos mas distintos NÃO são fundidos", () => {
    const plano = planejarEmpresas(
      ["Santa Casa", "Santa Casa de Misericórdia"],
      [],
    );
    expect(plano.aCriar).toHaveLength(2);
  });

  it("vazio, nulo e só espaço são ignorados", () => {
    expect(planejarEmpresas([null, undefined, "", "   "], []).aCriar).toEqual([]);
  });

  /**
   * Se o banco já tem duplicata (criada antes desta correção), escolher sempre
   * a MESMA evita que a importação alterne entre elas entre execuções — o que
   * espalharia os contatos da mesma instituição por duas fichas.
   */
  it("com duplicata no banco, escolhe sempre a primeira", () => {
    const existentes = [{ id: "a", name: "Hospital X" }, { id: "b", name: "HOSPITAL X" }];
    expect(planejarEmpresas(["hospital x"], existentes).porChave.get("hospital x")).toBe("a");
    expect(planejarEmpresas(["hospital x"], existentes).porChave.get("hospital x")).toBe("a");
  });
});

describe("o que atualizar quando o contato já existe", () => {
  const atual = {
    first_name: "Guilherme", last_name: "RCL",
    email: "g@exemplo.com", phone: null, title: null,
    metadata: { source: "APROXIMA MED", importado_em: "2026-08-31", cidade: "Campinas" },
  };

  it("ignorar não devolve nada", () => {
    expect(camposParaAtualizar({ phone: "11999998888" }, atual, "ignorar")).toBeNull();
  });

  /**
   * O caso que motivou tudo: o lote entrou sem telefone e sem especialidade
   * porque o mapeamento estava errado. Reimportar corrigido tem de PREENCHER.
   */
  it("completar preenche o que está em branco", () => {
    const r = camposParaAtualizar(
      { phone: "11999998888", title: "Ortopedista" }, atual, "completar",
    );
    expect(r).toEqual({ phone: "11999998888", title: "Ortopedista" });
  });

  it("completar NÃO toca no que já tem valor", () => {
    const r = camposParaAtualizar({ email: "outro@exemplo.com" }, atual, "completar");
    expect(r).toBeNull();
  });

  it("substituir vence nos campos que a planilha traz", () => {
    const r = camposParaAtualizar({ email: "novo@exemplo.com" }, atual, "substituir");
    expect(r).toEqual({ email: "novo@exemplo.com" });
  });

  /**
   * A REGRA QUE NÃO NEGOCIA. Vazio numa planilha quer dizer "não informado";
   * interpretar como "apague" faria reimportar uma lista sem e-mail limpar todos
   * os e-mails da base, em silêncio.
   */
  it.each(["completar", "substituir"] as const)("%s: célula vazia NÃO apaga", (modo) => {
    for (const vazio of [null, undefined, "", "   "]) {
      expect(camposParaAtualizar({ email: vazio }, atual, modo)).toBeNull();
    }
  });

  it("valor idêntico não gasta escrita", () => {
    expect(camposParaAtualizar({ email: "g@exemplo.com" }, atual, "substituir")).toBeNull();
  });

  /**
   * `metadata` MESCLA, sempre — nem "substituir" troca o objeto. Substituir
   * apagaria as respostas do formulário, a origem do lote anterior e a marca
   * `importado_em`, que é o que o filtro "Importação" da tela de Contatos usa
   * para achar essas pessoas.
   */
  it("metadata mescla e nunca perde o que já estava", () => {
    const r = camposParaAtualizar(
      { metadata: { atendido_por: "Ana", source: "NOVO LOTE" } },
      atual,
      "substituir",
    );
    const meta = r?.metadata as Record<string, string>;
    expect(meta.atendido_por).toBe("Ana");        // novo entrou
    expect(meta.source).toBe("NOVO LOTE");        // substituído, como pedido
    expect(meta.cidade).toBe("Campinas");         // não veio na planilha: PERMANECE
    expect(meta.importado_em).toBe("2026-08-31"); // a marca do filtro sobrevive
  });

  it("em completar, metadata só preenche o que falta", () => {
    const r = camposParaAtualizar(
      { metadata: { cidade: "São Paulo", atendido_por: "Ana" } },
      atual,
      "completar",
    );
    const meta = r?.metadata as Record<string, string>;
    expect(meta.cidade).toBe("Campinas");     // já tinha: intacto
    expect(meta.atendido_por).toBe("Ana");    // estava vazio: preenchido
  });
});
