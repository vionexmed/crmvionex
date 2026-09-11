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
  const SELETOR = ler("src/components/crm/SeletorDeOrigem.tsx");

  /**
   * O selo do cabeçalho mostrava de onde a pessoa veio e não havia como
   * corrigir: lead que chegou por indicação e entrou como "Manual" ficava assim
   * para sempre -- e a origem alimenta o filtro da lista e o gráfico de canais.
   */
  it("os dois lugares usam o MESMO seletor", () => {
    expect(GAVETA).toContain("<SeletorDeOrigem");
    expect(CADASTRO).toContain("<SeletorDeOrigem");
  });

  /**
   * A lista tinha só os quatro grupos conhecidos, e a base tem muito mais: nome
   * de planilha, campanha, evento. Sem as origens reais, não havia como
   * reaproveitar uma que já existe -- e a mesma origem escrita de dois jeitos
   * vira duas fatias no gráfico de canais e dois itens no filtro.
   */
  it("oferece as origens que a base já usa", () => {
    expect(SELETOR).toContain("useOrigensDeContato");
    expect(SELETOR).toMatch(/\{o\.origem\} \(\{o\.contatos\}\)/);
  });

  /** Digitar é o único jeito de a PRIMEIRA ocorrência de uma origem nova
   *  existir: ela não está na base porque ninguém a usou ainda. */
  it("deixa digitar uma origem nova", () => {
    expect(SELETOR).toContain('aria-label="Nova origem"');
    expect(SELETOR).toContain("Digitar uma nova…");
  });

  /**
   * Sem a remoção, um contato com `source: "manual"` faria "Manual" aparecer
   * duas vezes -- uma como grupo e outra como valor real da base --, e as duas
   * gravariam exatamente a mesma coisa.
   */
  it("não repete o que já está entre os grupos conhecidos", () => {
    expect(SELETOR).toMatch(/!grupos\.includes\(o\.origem\)/);
  });

  /**
   * O valor CRU, não o rótulo. Se a consulta das origens falhar, ou se o valor
   * acabou de ser digitado, ele não está em lista nenhuma -- e sem esta opção
   * abrir e salvar a ficha apagaria de onde a pessoa veio.
   */
  it("a origem atual continua selecionável mesmo fora das listas", () => {
    expect(SELETOR).toMatch(/soltaNaLista/);
    expect(SELETOR).toMatch(/!daBase\.some\(\(o\) => o\.origem === valor\)/);
  });

  /**
   * O formulário manual gravava `source: "manual"` FIXO. Quem cadastrava à mão
   * o lead vindo de indicação, de evento ou de campanha sabia disso na hora --
   * e era a única hora em que se sabia. Depois vira arqueologia.
   */
  it("o cadastro manual não fixa mais a origem", () => {
    expect(CADASTRO, "gravar fixo é o defeito").not.toMatch(/source: "manual",/);
    expect(CADASTRO).toMatch(/source: origem \|\| "manual"/);
    expect(CADASTRO).toMatch(/useState\("manual"\)/);
  });

  /** Limpar o formulário tem de limpar isto também, ou o próximo cadastro
   *  herda a origem do anterior sem ninguém perceber. */
  it("fechar e reabrir volta ao padrão", () => {
    const i = CADASTRO.indexOf("const reset");
    expect(CADASTRO.slice(i, i + 300)).toContain('setOrigem("manual")');
  });

  /** `metadata` é um JSON com mais coisa dentro (cidade, país, marca de
   *  importação). Gravar só `source` apagaria o resto. */
  it("salvar mescla o metadata em vez de trocá-lo", () => {
    const i = GAVETA.indexOf("const handleSave");
    const corpo = GAVETA.slice(i, GAVETA.indexOf("const addActivity", i));
    expect(corpo).toContain("...existingMeta");
    expect(corpo).toContain("source: meta.source || undefined");
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

  /** Uma consulta só para o filtro da lista e para os dois seletores: com dois
   *  carregadores, uma tela oferece origem que a outra não tem. */
  it("filtro e seletor leem a mesma lista", () => {
    expect(ler("src/pages/Contacts.tsx")).toContain("useOrigensDeContato");
  });
});
