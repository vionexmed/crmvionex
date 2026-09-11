/**
 * Corrigir e apagar nota na própria ficha do contato.
 *
 * O pedido veio de quem usa, e o motivo é o que importa: teste de alinhamento e
 * erro de digitação entravam no histórico do lead e não saíam mais -- e
 * ENTRAVAM NA MÉTRICA, porque atividade concluída conta em "Abordagens
 * realizadas". Nota de teste não é histórico; é número de painel inflado.
 *
 * Os três defeitos que isto tranca são silenciosos, na ordem em que mordem:
 * a linha não tinha como ser corrigida, o apagar devolvia sucesso sem apagar, e
 * a origem do contato era exibida sem poder ser mudada.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const semComentarios = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const ler = (p: string) => semComentarios(readFileSync(p, "utf8"));

const GAVETA = ler("src/components/crm/ContactDrawer.tsx");
const LINHA = ler("src/components/crm/LinhaDeAtividade.tsx");
const API = ler("src/lib/api/activities.ts");
const CADASTRO = ler("src/components/crm/ContactCreateModal.tsx");
const MIGRACAO = readFileSync("supabase/migrations/20260911120000_nota_editavel.sql", "utf8");

describe("a linha do histórico é editável onde ela aparece", () => {
  /** Duas abas da mesma gaveta mostram a mesma linha. Um componente só para as
   *  duas -- senão uma ganha o botão e a outra não, como já era. */
  it("as abas Atividades e Notas usam a mesma linha", () => {
    const usos = GAVETA.match(/<LinhaDeAtividade/g) ?? [];
    expect(usos.length, "Atividades e Notas").toBe(2);
    expect(GAVETA).toContain("mostrarTipo={false}");
  });

  it("a linha oferece corrigir e apagar", () => {
    expect(LINHA).toMatch(/aria-label=\{`Editar /);
    expect(LINHA).toMatch(/aria-label=\{`Excluir /);
  });

  /**
   * Pelos hooks, e não por `supabase` cru como o resto da gaveta faz: eles
   * invalidam atividades E negócios. Sem isso, a nota apagada aqui continuaria
   * na tela de Atividades e na última interação do card do kanban até alguém
   * recarregar a página.
   */
  it("apagar na ficha repercute no resto do CRM", () => {
    expect(GAVETA).toContain("useUpdateActivity");
    expect(GAVETA).toContain("useDeleteActivities");
  });
});

describe("apagar não pode devolver sucesso sem apagar", () => {
  /**
   * O DEFEITO QUE MAIS IMPORTA AQUI. O PostgREST não trata linha recusada pela
   * RLS como erro: apaga zero linhas e devolve sucesso. A tela dizia "excluída",
   * recarregava a lista, e a nota continuava lá -- sem nada dizendo por quê.
   */
  it("a exclusão confere quantas linhas saíram", () => {
    const i = API.indexOf("deleteMany:");
    const corpo = API.slice(i, API.indexOf("},", i));
    expect(corpo).toContain('.select("id")');
    expect(corpo).toMatch(/saiu < ids\.length/);
    expect(corpo).toContain("throw new Error");
  });

  /** Uma implementação só: `delete` delega, para as duas não divergirem. */
  it("delete de um usa o mesmo caminho de deleteMany", () => {
    const i = API.indexOf("delete: async");
    expect(API.slice(i, API.indexOf("},", i))).toContain("deleteMany([id])");
  });

  it("a policy deixa a organização apagar, e a migração diz por quê", () => {
    expect(MIGRACAO).toMatch(/CREATE POLICY "activities_delete"[\s\S]{0,120}user_belongs_to_org/);
    expect(MIGRACAO).not.toMatch(/USING \([^)]*user_id = auth\.uid\(\)/);
  });
});

describe("a origem do contato deixou de ser só leitura", () => {
  /**
   * O selo do cabeçalho já mostrava de onde a pessoa veio e não havia como
   * corrigir: lead que chegou por indicação e entrou como "Manual" ficava assim
   * para sempre -- e a origem alimenta o filtro da lista e o gráfico de canais.
   */
  it("existe um campo de origem na edição", () => {
    expect(GAVETA).toContain('<Label className="text-xs">Origem</Label>');
    expect(GAVETA).toContain("ORIGIN_OPTIONS.map");
  });

  /**
   * O valor CRU, não o rótulo. `getContactOrigin` agrupa -- "csv_import" vira
   * "Importação" --, então gravar o rótulo apagaria o nome da planilha de onde
   * a pessoa veio. Por isso a opção crua também aparece na lista quando não é
   * uma das quatro conhecidas.
   */
  it("origem fora da lista conhecida sobrevive a abrir e salvar", () => {
    expect(GAVETA).toMatch(/!ORIGIN_OPTIONS\.some\(\(o\) => o\.value === meta\.source\)/);
  });

  /** `metadata` é um JSON com mais coisa dentro (cidade, país, marca de
   *  importação). Gravar só `source` apagaria o resto. */
  it("salvar mescla o metadata em vez de trocá-lo", () => {
    // Até a próxima função, e não até o primeiro `};`: um `toast({...});` no
    // meio fecharia a fatia cedo demais e o teste passaria sobre nada.
    const i = GAVETA.indexOf("const handleSave");
    const corpo = GAVETA.slice(i, GAVETA.indexOf("const addActivity", i));
    expect(corpo).toContain("...existingMeta");
    expect(corpo).toContain("source: meta.source || undefined");
  });
});

describe("a origem é escolhida na hora do cadastro", () => {
  /**
   * O formulário manual gravava `source: "manual"` FIXO. Quem cadastrava à mão
   * o lead que veio de indicação, de evento ou de campanha sabia disso na hora
   * -- e era a única hora em que se sabia. Depois vira arqueologia: ninguém
   * lembra de onde veio o contato de três meses atrás.
   */
  it("o cadastro manual oferece a origem, e não a fixa", () => {
    expect(CADASTRO).toContain('<Field label="Origem">');
    expect(CADASTRO).toContain("ORIGIN_OPTIONS.map");
    expect(CADASTRO, "gravar fixo é o defeito").not.toMatch(/source: "manual",/);
    // "manual" continua como PADRÃO, que é o que o formulário sempre gravou.
    expect(CADASTRO).toMatch(/source: origem \|\| "manual"/);
    expect(CADASTRO).toMatch(/useState\("manual"\)/);
  });

  /** Limpar o formulário tem de limpar isto também, ou o próximo cadastro
   *  herda a origem do anterior sem ninguém perceber. */
  it("fechar e reabrir volta ao padrão", () => {
    const i = CADASTRO.indexOf("const reset");
    expect(CADASTRO.slice(i, i + 300)).toContain('setOrigem("manual")');
  });

  /** O par que o cabeçalho mostra como dois selos vizinhos. Empilhados no fim
   *  do formulário, a origem passava despercebida -- e passou. */
  it("na ficha, origem fica ao lado do ciclo de vida", () => {
    const i = GAVETA.indexOf('<Label className="text-xs">Ciclo de vida</Label>');
    const j = GAVETA.indexOf('<Label className="text-xs">Origem</Label>');
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(GAVETA.slice(i - 200, i), "os dois numa grade de duas colunas")
      .toContain('grid grid-cols-2 gap-3');
  });
});
