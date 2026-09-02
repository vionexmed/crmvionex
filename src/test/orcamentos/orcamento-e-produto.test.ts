/**
 * Orçamento aprovável pelo cliente.
 *
 * O que este arquivo tranca são falhas que NÃO aparecem numa captura de tela:
 * um preço que muda depois de aprovado, um campo interno que vaza para a página
 * pública, uma decisão que pode ser refeita. As três funcionam — só ficam
 * erradas.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  totaisDoOrcamento, totalDoItem, novoToken, estadoDoOrcamento, venceu,
} from "@/lib/orcamento-calculo";

const ler = (p: string) => readFileSync(p, "utf8");
const semComentarios = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const MIGRACAO = ler("supabase/migrations/20260902120000_produtos_e_orcamentos.sql");
const FUNCAO = ler("supabase/functions/orcamento-publico/index.ts");
const API = semComentarios(ler("src/lib/api/orcamentos.ts"));
const CALCULO = semComentarios(ler("src/lib/orcamento-calculo.ts"));

describe("o item guarda o que foi ofertado", () => {
  /**
   * O TESTE QUE MAIS IMPORTA de todos aqui.
   *
   * Se o item apontasse só para o produto, corrigir o preço no catálogo mudaria
   * orçamento já aprovado — inclusive o total que o cliente aprovou por
   * escrito. É a mesma família do defeito que o CLAUDE.md registra em métrica
   * contada por `created_at`: um número fechado que muda depois de fechado.
   */
  it("nome e preço são colunas do item, não do produto", () => {
    const bloco = MIGRACAO.slice(
      MIGRACAO.indexOf("CREATE TABLE IF NOT EXISTS public.orcamento_itens"),
      MIGRACAO.indexOf("-- ---------- 5."),
    );
    expect(bloco).toMatch(/\bnome\s+text NOT NULL/);
    expect(bloco).toMatch(/preco_unit\s+numeric\(14,2\) NOT NULL/);
  });

  /** Apagar produto não pode apagar histórico: por isso a FK é anulável. */
  it("produto_id é ON DELETE SET NULL", () => {
    expect(MIGRACAO).toMatch(/produto_id\s+uuid REFERENCES public\.produtos\(id\) ON DELETE SET NULL/);
  });

  it("a cópia acontece na entrada do item", () => {
    expect(API).toContain("export function itemDeProduto");
    expect(API).toMatch(/preco_unit: Number\(p\.preco\)/);
  });

  /** A tela nunca lê `produtos.preco` para exibir item existente: é assim que
   *  um orçamento aprovado mudaria de valor. */
  it("nenhuma tela de orçamento lê o preço do catálogo", () => {
    for (const arquivo of [
      "src/components/orcamentos/LinhaDeOrcamento.tsx",
      "src/components/orcamentos/PainelDeOrcamento.tsx",
    ]) {
      expect(semComentarios(ler(arquivo)), arquivo).not.toMatch(/produto\?\.preco|\.produto\.preco/);
    }
  });
});

describe("o contato é opcional, e a consequência está tratada", () => {
  const OPCIONAL = ler("supabase/migrations/20260902160000_orcamento_contato_opcional.sql");

  /**
   * Ele nasceu `NOT NULL` porque era o vínculo que levava a decisão do cliente
   * para a ficha de alguém. Na prática obrigava a cadastrar contato antes de
   * orçar — e cotação por telefone não começa assim.
   *
   * Este teste lê a migração QUE MUDOU, e não a primeira: a de origem ainda diz
   * `NOT NULL`, então continuar checando lá passaria afirmando o contrário do
   * que o banco faz hoje.
   */
  it("a coluna deixou de ser obrigatória", () => {
    expect(OPCIONAL).toMatch(/ALTER COLUMN contact_id DROP NOT NULL/);
  });

  /**
   * O ON DELETE muda junto. `RESTRICT` fazia sentido para vínculo obrigatório;
   * para vínculo opcional, recusar a exclusão do contato seria pior que soltar
   * a referência — o orçamento agora sobrevive sem contato por construção.
   */
  it("apagar contato solta o orçamento em vez de recusar", () => {
    expect(OPCIONAL).toMatch(/FOREIGN KEY \(contact_id\)[\s\S]{0,80}ON DELETE SET NULL/);
    expect(OPCIONAL).toContain("DROP CONSTRAINT IF EXISTS orcamentos_contact_id_fkey");
  });

  /**
   * O QUE SE PERDE, e o que a função faz com isso: sem contato E sem negócio,
   * a atividade seria uma linha órfã — aparece na tela de Atividades sem dizer
   * de quem é, e não entra em ficha nenhuma. O registro do que aconteceu não se
   * perde: está no próprio orçamento, em `decidido_por` e `decidido_em`.
   */
  it("a função não grava atividade órfã", () => {
    expect(FUNCAO).toContain("if (!orc.contact_id && !orc.deal_id) return;");
  });

  /** As outras duas FKs seguem explícitas. O CLAUDE.md registra quatro FKs
   *  criadas sem cláusula, e o problema lá é ela ser IMPLÍCITA. */
  it("deal_id e itens continuam declarando o que acontece ao apagar", () => {
    expect(MIGRACAO).toMatch(/deal_id[^\n]*ON DELETE SET NULL/);
    expect(MIGRACAO).toMatch(/orcamento_id[^\n]*ON DELETE CASCADE/);
  });
});

describe("os campos numéricos aceitam decimal", () => {
  const CONSTRUTOR = semComentarios(ler("src/components/orcamentos/ConstrutorDeOrcamento.tsx"));

  /**
   * O DEFEITO QUE ISTO TRANCA, e ele era real: os campos guardavam `number` e
   * convertiam a cada tecla com `Number(v.replace(",", ".")) || 0`. Digitar
   * "1,5" mostrava "1" no instante em que a vírgula era digitada, e apagar o
   * campo travava em "0" — não dava para limpar e recomeçar.
   *
   * O formulário de produto já documentava esse cuidado; o construtor repetia o
   * erro que aquele evitava.
   */
  it("o item guarda os números como texto enquanto se digita", () => {
    expect(CONSTRUTOR).toMatch(/preco_unit: string/);
    expect(CONSTRUTOR).toMatch(/quantidade: string/);
    expect(CONSTRUTOR).toMatch(/desconto: string/);
    // A conversão a cada tecla é justamente o que não pode voltar.
    expect(CONSTRUTOR, "converter no onChange quebra a digitação de decimal")
      .not.toMatch(/onChange=\{\(e\) => mudarItem\(i, \{ \w+: Number\(/);
  });

  /** O desconto por linha existia no banco e em `totalDoItem` desde o início, e
   *  não tinha campo: dar desconto num item só era impossível. */
  it("existe entrada de desconto por item", () => {
    expect(CONSTRUTOR).toMatch(/aria-label=\{`Desconto do item \$\{i \+ 1\}`\}/);
  });
});

describe("a página pública não vaza o que é interno", () => {
  /**
   * A função devolve campo escolhido a dedo. `observacoes` é a nota do time —
   * onde se escreve "dá para baixar até 3.000". Mandá-la para o cliente seria o
   * pior vazamento possível desta tela.
   */
  it("observacoes nunca entra no payload", () => {
    const select = FUNCAO.match(/\.select\(\s*"([^"]+)"\s*\)/)?.[1] ?? "";
    expect(select, "a consulta não deve nem buscar a nota interna")
      .not.toContain("observacoes");
    expect(FUNCAO).not.toMatch(/observacoes:/);
  });

  /** A consulta é sempre por token, nunca por id: assim não há como pedir "o
   *  próximo". */
  it("busca por token, não por id", () => {
    expect(FUNCAO).toContain('.eq("token", token)');
    expect(FUNCAO).not.toMatch(/\.eq\("id", .*params/);
  });

  it("token curto ou malformado é recusado antes da consulta", () => {
    expect(FUNCAO).toMatch(/TOKEN_VALIDO = \/\^\[0-9a-f\]\{64\}\$\//);
  });

  /** 32 bytes de crypto. Sequencial ou curto deixaria adivinhar o orçamento do
   *  vizinho, e com ele o preço dele. */
  it("o token é longo e aleatório", () => {
    expect(CALCULO).toContain("crypto.getRandomValues");
    const t = novoToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(novoToken()).not.toBe(t);
  });
});

describe("a decisão do cliente é final", () => {
  /**
   * Sem a guarda, o link vira um botão permanente de mudar de ideia — e o CRM
   * passaria a mostrar decisão diferente da que a equipe já leu e agiu em cima.
   */
  it("orçamento já decidido recusa nova resposta", () => {
    expect(FUNCAO).toContain("if (orc.decidido_em)");
    expect(FUNCAO).toContain("já foi respondido");
  });

  it("orçamento vencido recusa a decisão", () => {
    expect(FUNCAO).toMatch(/if \(expirado\)/);
  });

  /**
   * A condição na PRÓPRIA escrita, e não só no `if`: entre a checagem e o
   * update cabe um segundo clique. Sem isto, dois envios simultâneos gravariam
   * duas decisões e a última venceria em silêncio.
   */
  it("a escrita também exige que ainda não haja decisão", () => {
    expect(FUNCAO).toContain('.is("decidido_em", null)');
  });

  /** Nome é obrigatório: é o que transforma "o cliente aprovou" em algo que se
   *  sustenta numa conversa depois. */
  it("exige o nome de quem responde", () => {
    expect(FUNCAO).toContain("Escreva seu nome para confirmar");
  });
});

describe("o ciclo entra no histórico da pessoa", () => {
  /**
   * Era o pedido literal: "se a pessoa aceita ou não, estará no histórico do
   * perfil dela". A atividade é o que faz isso aparecer na ficha do contato, na
   * última interação do card do negócio e na tela de Atividades — sem tela nova.
   */
  it("visto e decidido gravam atividade no contato", () => {
    expect(FUNCAO).toContain("registrarAtividade");
    expect(FUNCAO).toMatch(/type: "orcamento"/);
    expect(FUNCAO).toContain("contact_id: orc.contact_id");
    // `completed_at` preenchido: sem ele a ficha mostraria "Orçamento aprovado"
    // como coisa a fazer.
    expect(FUNCAO).toMatch(/completed_at: new Date\(\)\.toISOString\(\)/);
  });

  /** Falhar ao gravar histórico não pode derrubar a decisão: o cliente já
   *  clicou, e perder o que importa para preservar o acessório é o pior troco. */
  it("falha no histórico não derruba a aprovação", () => {
    const bloco = FUNCAO.slice(FUNCAO.indexOf("async function registrarAtividade"));
    expect(bloco.slice(0, 900)).toContain("console.error");
    expect(bloco.slice(0, 900)).not.toMatch(/throw error/);
  });
});

describe("o total é calculado num lugar só", () => {
  /**
   * A soma aparece em quatro telas — construtor, lista, painel e a página do
   * cliente — e é o número que o cliente aprova. Duas implementações divergindo
   * por arredondamento é a diferença entre o total que ele viu e o que o CRM
   * registrou.
   */
  it("desconto nunca produz total negativo", () => {
    // "tiro 500" num orçamento de 300 é erro de digitação, e o total negativo
    // iria para a página do cliente.
    const t = totaisDoOrcamento([{ preco_unit: 100, quantidade: 3, desconto: 0 }], 500);
    expect(t.total).toBe(0);
    expect(t.desconto).toBe(300);
  });

  it("desconto de item também tem piso zero", () => {
    expect(totalDoItem({ preco_unit: 100, quantidade: 1, desconto: 250 })).toBe(0);
  });

  it("soma item a item, com quantidade fracionária", () => {
    const t = totaisDoOrcamento(
      [
        { preco_unit: 1200, quantidade: 2, desconto: 200 },
        { preco_unit: 80.5, quantidade: 1.5, desconto: 0 },
      ],
      100,
    );
    expect(t.subtotal).toBeCloseTo(2320.75, 2);
    expect(t.total).toBeCloseTo(2220.75, 2);
  });

  /** A tela não pode recalcular por conta: é assim que duas somas divergem. */
  it("as telas usam a função compartilhada", () => {
    for (const arquivo of [
      "src/components/orcamentos/ConstrutorDeOrcamento.tsx",
      "src/components/orcamentos/LinhaDeOrcamento.tsx",
      "src/components/orcamentos/PainelDeOrcamento.tsx",
    ]) {
      expect(semComentarios(ler(arquivo)), arquivo).toContain("totaisDoOrcamento");
    }
  });
});

describe("vencido é derivado, não gravado", () => {
  /**
   * Um cron mudando status à meia-noite erra em fuso e deixa o CRM discordando
   * da edge function. Derivar da data mantém as duas com a mesma resposta.
   */
  it("válido até hoje ainda vale hoje", () => {
    const hoje = new Date().toISOString().slice(0, 10);
    expect(venceu(hoje), "comparar por instante venceria à zero hora do próprio dia")
      .toBe(false);
  });

  it("ontem venceu", () => {
    const ontem = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    expect(venceu(ontem)).toBe(true);
  });

  it("sem data não vence", () => {
    expect(venceu(null)).toBe(false);
  });

  /** Decisão tomada prevalece sobre a data: aprovado ontem continua aprovado. */
  it("decidido não vira vencido", () => {
    const ontem = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    expect(estadoDoOrcamento({ status: "aprovado", valido_ate: ontem })).toBe("aprovado");
    expect(estadoDoOrcamento({ status: "enviado", valido_ate: ontem })).toBe("expirado");
  });
});

describe("a rota pública fica fora da sessão", () => {
  const APP = semComentarios(ler("src/App.tsx"));

  it("/o/:token fica fora da casca do app", () => {
    const i = APP.indexOf('path="/o/:token"');
    // A casca autenticada é `<Route element={<AppLayout />}>` -- não existe um
    // componente chamado "ProtectedRoute" neste projeto, e a primeira versão
    // deste teste procurava por ele: `indexOf` devolvia -1 e a comparação
    // passava a ser "5074 < -1", que reprova por motivo errado.
    const j = APP.indexOf("<Route element={<AppLayout />}>");
    expect(i, "rota pública não registrada").toBeGreaterThan(-1);
    expect(j, "a casca do app mudou de forma").toBeGreaterThan(-1);
    expect(i, "a rota do cliente precisa vir ANTES da casca autenticada").toBeLessThan(j);
  });

  /**
   * A página é servida pelo APP, não pela função. O runtime das Edge Functions
   * troca `text/html` por `text/plain` + `nosniff`, então HTML devolvido de lá
   * aparece como código-fonte.
   */
  it("a função devolve JSON, nunca HTML", () => {
    expect(FUNCAO).toContain('"Content-Type": "application/json"');
    /*
      SEM COMENTÁRIO, pela segunda vez nesta leva.

      O cabeçalho da função EXPLICA que o runtime rebaixa `text/html` para
      `text/plain` -- e a primeira versão deste teste reprovava justamente por
      causa dessa explicação. É a armadilha que o CLAUDE.md registra: teste que
      proíbe X reprova quem documenta por que não usar X.
    */
    expect(semComentarios(FUNCAO)).not.toContain("text/html");
  });

  it("a função é declarada pública no config", () => {
    const cfg = ler("supabase/config.toml");
    const i = cfg.indexOf("[functions.orcamento-publico]");
    expect(i).toBeGreaterThan(-1);
    expect(cfg.slice(i, i + 120)).toContain("verify_jwt = false");
  });
});
