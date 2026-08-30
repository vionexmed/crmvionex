// @vitest-environment jsdom
// exercita o download de verdade: Blob, createObjectURL e o <a> clicado
/**
 * Exportação de CSV.
 *
 * Havia CINCO implementações, e elas divergiam no que importa:
 *
 *   Relatórios         BOM ✓   escapa aspas ✓
 *   Contatos           BOM ✓   escapa aspas ✓
 *   Empresas           BOM ✗   escapa aspas ✗
 *   Lead Scoring       BOM ✗   escapa aspas ✗
 *   Importar/Exportar  BOM ✗   escapa aspas ✓
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { exportarCSV } from "@/lib/csv";

/** Captura o que foi para o Blob, sem baixar nada. */
function capturar(fn: () => void): { conteudo: string; tipo: string; nome: string } {
  let conteudo = "", tipo = "", nome = "";
  const BlobOriginal = globalThis.Blob;
  // @ts-expect-error substituição deliberada no teste
  globalThis.Blob = class {
    constructor(partes: string[], opcoes: { type: string }) {
      conteudo = partes.join(""); tipo = opcoes.type;
    }
  };
  const criarUrl = vi.fn(() => "blob:x");
  globalThis.URL.createObjectURL = criarUrl;
  globalThis.URL.revokeObjectURL = vi.fn();
  const a = { href: "", download: "", click: vi.fn() };
  vi.spyOn(document, "createElement").mockReturnValue(a as unknown as HTMLAnchorElement);
  try {
    fn();
    nome = a.download;
  } finally {
    globalThis.Blob = BlobOriginal;
    vi.restoreAllMocks();
  }
  return { conteudo, tipo, nome };
}

describe("o BOM", () => {
  /**
   * Sem os três bytes do BOM, o Excel abre o arquivo em Windows-1252 e todo
   * acento vira lixo: "João" vira "JoÃ£o". Num CRM em português isso torna
   * metade das exportações inutilizável -- e quem abre culpa o DADO, não o
   * arquivo.
   */
  it("o arquivo começa com BOM", () => {
    const { conteudo } = capturar(() => exportarCSV([{ Nome: "João" }], "x"));
    expect(conteudo.charCodeAt(0)).toBe(0xfeff);
  });

  it("declara utf-8 no tipo", () => {
    const { tipo } = capturar(() => exportarCSV([{ Nome: "a" }], "x"));
    expect(tipo).toContain("charset=utf-8");
  });
});

describe("escape", () => {
  /**
   * Uma empresa chamada `Silva "Móveis" Ltda` fechava o campo no meio e
   * deslocava todas as colunas dali para a direita, na linha inteira.
   */
  it("aspas internas são duplicadas", () => {
    const { conteudo } = capturar(() => exportarCSV([{ Nome: 'Silva "Móveis" Ltda' }], "x"));
    expect(conteudo).toContain('"Silva ""Móveis"" Ltda"');
  });

  it("vírgula no valor não vira separador", () => {
    const { conteudo } = capturar(() => exportarCSV([{ Endereco: "Rua A, 100" }], "x"));
    const linhas = conteudo.split("\r\n");
    expect(linhas[1]).toBe('"Rua A, 100"');
  });

  it("quebra de linha dentro do campo fica dentro das aspas", () => {
    const { conteudo } = capturar(() => exportarCSV([{ Nota: "linha1\nlinha2" }], "x"));
    expect(conteudo).toContain('"linha1\nlinha2"');
  });

  it("nulo e indefinido viram célula vazia, não a palavra", () => {
    // `String(null)` é "null" -- apareceria como texto na planilha.
    const { conteudo } = capturar(() => exportarCSV([{ a: null, b: undefined }], "x"));
    expect(conteudo).not.toContain("null");
    expect(conteudo).not.toContain("undefined");
  });

  it("objeto vira JSON, não [object Object]", () => {
    const { conteudo } = capturar(() => exportarCSV([{ meta: { x: 1 } }], "x"));
    expect(conteudo).toContain('{""x"":1}');
  });
});

describe("estrutura", () => {
  it("CRLF entre linhas", () => {
    // É o que a especificação do CSV pede e o que o Excel no Windows espera.
    const { conteudo } = capturar(() => exportarCSV([{ a: 1 }, { a: 2 }], "x"));
    expect(conteudo).toContain("\r\n");
  });

  it("os cabeçalhos vêm da primeira linha, na ordem escrita", () => {
    const { conteudo } = capturar(() => exportarCSV([{ Nome: "a", Email: "b" }], "x"));
    expect(conteudo.split("\r\n")[0]).toBe('﻿"Nome","Email"');
  });

  it("lista vazia não baixa arquivo nenhum", () => {
    const { nome } = capturar(() => exportarCSV([], "x"));
    expect(nome).toBe("");
  });

  it("acrescenta .csv só uma vez", () => {
    expect(capturar(() => exportarCSV([{ a: 1 }], "x")).nome).toBe("x.csv");
    expect(capturar(() => exportarCSV([{ a: 1 }], "x.csv")).nome).toBe("x.csv");
  });
});

describe("ninguém monta CSV à mão", () => {
  const arquivos = (function varrer(dir: string, saida: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) varrer(caminho, saida);
      else if (/\.tsx?$/.test(nome)) saida.push(caminho);
    }
    return saida;
  })("src").filter((f) => !f.endsWith("lib/csv.ts") && !f.includes("/test/"));

  it("nenhum Blob de CSV fora do módulo", () => {
    const infratores = arquivos.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /new Blob\(\[/.test(src) && /csv/i.test(src);
    });
    expect(infratores, infratores.join("\n")).toEqual([]);
  });
});
