/**
 * As ações da tela de E-mail alcançam o Gmail.
 *
 * DEFEITO QUE ISTO CORRIGE, e era a maior fonte da sensação de "cru": NENHUMA
 * ação chegava ao Google. `archiveEmail` fazia
 * `updateEmail(id, { is_archived: true })` — um update no banco do CRM — e
 * parava ali. O e-mail continuava na caixa de entrada do Gmail; marcar como lido
 * aqui deixava não lido lá.
 *
 * As ações PARECIAM funcionar, e a divergência crescia a cada clique. Somado a
 * isso, o sync só buscava `labelIds: "INBOX"`, então nem havia como notar.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ler = (f: string) => readFileSync(f, "utf8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const TELA = semComentarios(ler("src/pages/Inbox.tsx"));
const MODIFY = semComentarios(ler("supabase/functions/gmail-modify/index.ts"));
const LABELS = semComentarios(ler("supabase/functions/gmail-labels/index.ts"));

describe("as ações vão ao Gmail, não só ao banco", () => {
  it.each([
    ["archiveEmail", "arquivar"],
    ["markSpam", "spam"],
    ["notSpam", "nao_spam"],
    ["trashEmail", "lixeira"],
    ["restoreEmail", "restaurar"],
  ])("%s chama a edge function com a ação %s", (fn, acao) => {
    const bloco = TELA.slice(TELA.indexOf(`const ${fn} =`), TELA.indexOf(`const ${fn} =`) + 250);
    expect(bloco).toContain(`noGmail([id], "${acao}")`);
  });

  it("o lote também", () => {
    expect(TELA).toMatch(/if \(!\(await noGmail\(ids, acao\)\)\) return;/);
  });

  /**
   * Nenhuma das cinco pode voltar a ser `updateEmail` puro. `updateEmail`
   * continua existindo, e é o certo para importância e adiar — conceitos que NÃO
   * existem no Gmail e não têm o que sincronizar.
   */
  it("arquivar não é mais um update local", () => {
    expect(TELA).not.toMatch(/archiveEmail[\s\S]{0,120}updateEmail\(id, \{ is_archived: true \}\)/);
  });
});

describe("o que o Gmail chama de arquivar, marcar lido e apagar", () => {
  /**
   * No Gmail não existem essas operações como tal: tudo é label. Arquivar é
   * remover INBOX; lido é remover UNREAD.
   */
  it("arquivar remove INBOX", () => {
    expect(MODIFY).toMatch(/case "arquivar":\s*return \{ add: \[\], remove: \["INBOX"\] \}/);
  });

  it("marcar lido remove UNREAD", () => {
    expect(MODIFY).toMatch(/case "ler":\s*return \{ add: \[\], remove: \["UNREAD"\] \}/);
  });

  /**
   * A LIXEIRA é a exceção que importa: `TRASH` como label é ACEITO pela API mas
   * não produz o mesmo efeito que a rota de trash, e a mensagem fica num estado
   * meio-apagado que a interface do Gmail mostra de forma estranha.
   */
  it("lixeira usa a rota própria, não o label TRASH", () => {
    expect(MODIFY).toMatch(/messages\/\$\{encodeURIComponent\(gid\)\}\/\$\{acao === "lixeira" \? "trash" : "untrash"\}/);
    expect(MODIFY).not.toMatch(/add: \["TRASH"\]/);
  });

  /**
   * Mover para pasta REMOVE de INBOX, como o Gmail faz quando você arrasta. Sem
   * remover, a mensagem apareceria nos dois lugares e "mover" não teria movido.
   */
  it("mover para pasta tira da caixa de entrada", () => {
    expect(MODIFY).toMatch(/case "mover_para_pasta":\s*return \{ add: \[label_id as string\], remove: \["INBOX"\] \}/);
  });
});

describe("o banco só é atualizado DEPOIS do Gmail confirmar", () => {
  /**
   * Se o Google recusar, nada é gravado. É o que impede a divergência de voltar
   * por outro caminho: um banco que diz "arquivado" e um Gmail que discorda é
   * exatamente o defeito que este arquivo existe para fechar.
   */
  it("o update local vem depois da checagem de resposta", () => {
    const iRecusa = MODIFY.indexOf("if (!resp.ok)");
    /*
     * Por REGEX com `\s*`, não pela string com a indentação embutida.
     *
     * A versão anterior procurava `admin.from("emails")\n` seguido de exatamente
     * dez espaços. Envolver o trecho num laço a mais -- o que a busca por caixa
     * fez -- mudou o recuo e reprovou o teste sem que o invariante tivesse
     * mudado: o update continuava depois da checagem. Teste que quebra por
     * recuo é teste que alguém desliga.
     */
    const update = /admin\s*\.from\("emails"\)\s*\.update\(/.exec(MODIFY);
    expect(iRecusa).toBeGreaterThan(-1);
    expect(update, "não achei o update local em gmail-modify").not.toBeNull();
    expect(update!.index).toBeGreaterThan(iRecusa);
  });

  /**
   * As labels gravadas são as que o GMAIL DEVOLVE, não as que supusemos. O
   * Google faz coisas além do pedido — mover para spam também remove IMPORTANT —
   * e supor deixaria a coluna mentindo.
   */
  it("as labels gravadas vêm da resposta do Gmail", () => {
    expect(MODIFY).toMatch(/labelsAgora = \(corpo as \{ labelIds\?: string\[\] \}/);
  });
});

/**
 * A CAIXA CERTA, e o que fazer quando não se sabe qual é.
 *
 * `synced_from` guarda o e-mail da caixa de onde a mensagem veio. Mensagens
 * sincronizadas antes de essa coluna existir têm nulo ali -- o `gmail-attachment`
 * já registrava esse caso com um fallback próprio.
 *
 * O `gmail-modify` passava `null` nessas, e `obterAccessToken` com e-mail nulo
 * devolve o token MAIS RECENTE DA ORGANIZAÇÃO -- que pode ser a caixa de outra
 * pessoa. O Gmail recebia um id que não existe naquela caixa e respondia 404.
 * Na tela, a ação simplesmente não acontecia: apagar não apagava.
 */
describe("a ação encontra a caixa da mensagem", () => {
  it("a caixa conhecida vem primeiro", () => {
    // `synced_from` na frente, e as outras atrás. O contrário faria toda ação
    // começar errando.
    expect(MODIFY).toMatch(/m\.synced_from\s*\n?\s*\?\s*\[m\.synced_from as string, \.\.\.contas/);
  });

  it("404 tenta a próxima caixa; outro erro não", () => {
    /*
     * 404 é "esta caixa não conhece esta mensagem". Qualquer outro status é
     * problema de verdade -- 401 de token, 403 de escopo, 429 de cota -- e
     * repetir em outra caixa só multiplica a falha e queima cota.
     */
    const i = MODIFY.indexOf("if (resp.status === 404) continue;");
    expect(i, "o 404 não tenta a próxima caixa").toBeGreaterThan(-1);
    // O `break` imediatamente depois é o que impede a repetição dos outros.
    expect(MODIFY.slice(i, i + 60)).toContain("break;");
  });

  it("a caixa descoberta é gravada, para não varrer de novo", () => {
    expect(MODIFY).toMatch(/conta && !m\.synced_from \? \{ synced_from: conta \}/);
  });

  it("o erro do select não é descartado", () => {
    /*
     * Sem esta checagem, coluna que falta -- `labels` só existe desde
     * 20260831180000 -- fazia `mensagens` vir undefined e a resposta ser
     * "Mensagens não encontradas". Migração pendente aparecia como mensagem
     * inexistente, que é a pista errada.
     */
    expect(MODIFY).toContain("error: erroBusca");
    const iErro = MODIFY.indexOf("if (erroBusca)");
    const iVazio = MODIFY.indexOf("Mensagens não encontradas");
    expect(iErro).toBeGreaterThan(-1);
    expect(iErro).toBeLessThan(iVazio);
  });
});

/**
 * O CLIQUE RESPONDE NA HORA.
 *
 * Sem efeito otimista o caminho era: função de borda com cold start, chamada ao
 * Gmail (às vezes mais de uma, quando a caixa não é conhecida), gravação, e só
 * então a lista INTEIRA recarregando -- com `await`. Segundos de tela parada, e a
 * sensação de que o clique não pegou.
 *
 * `useUpdateEmail` já tinha o padrão, e é por isso que estrela e adiar sempre
 * responderam na hora enquanto apagar e mover pareciam travados. Estes testes
 * travam a paridade.
 */
describe("a tela muda no clique, não depois do Gmail", () => {
  const INBOX = semComentarios(readFileSync("src/pages/Inbox.tsx", "utf8"));

  it("aplica o efeito local antes de chamar a função", () => {
    const iEfeito = INBOX.indexOf("qc.setQueryData<Email[]>(chave");
    const iChamada = INBOX.indexOf('invoke("gmail-modify"');
    expect(iEfeito).toBeGreaterThan(-1);
    expect(iEfeito, "o efeito otimista tem de vir ANTES da chamada").toBeLessThan(iChamada);
  });

  it("desfaz quando o Gmail recusa", () => {
    // Sem isto a mensagem sairia da lista e não voltaria: a tela mostraria um
    // resultado que não aconteceu.
    expect(INBOX).toMatch(/if \(anterior\) qc\.setQueryData\(chave, anterior\)/);
  });

  it("não espera a revalidação para mostrar o resultado", () => {
    // `void`, não `await`. A revalidação é reconciliação em segundo plano.
    expect(INBOX).toMatch(/void qc\.invalidateQueries\(\{ queryKey: emailsKeys\.all/);
    const i = INBOX.indexOf("const noGmail");
    const fim = INBOX.indexOf("const moverParaPasta");
    expect(INBOX.slice(i, fim), "await na revalidação devolve a lentidão")
      .not.toMatch(/await qc\.invalidateQueries/);
  });

  /**
   * OS DOIS MAPAS TÊM DE CONCORDAR.
   *
   * O do servidor (`LOCAL` em gmail-modify) é a verdade que fica no banco; o do
   * cliente (`EFEITO_LOCAL` no Inbox) é o que a tela mostra antes da resposta.
   * Divergirem significa a tela mostrar uma coisa e o banco gravar outra -- e a
   * diferença só apareceria no próximo F5, quando ninguém mais liga a causa ao
   * efeito.
   *
   * Estão duplicados porque o servidor roda no Deno, e importar de
   * `supabase/functions` para dentro do `src` puxaria o mundo do Deno para o
   * build do Vite. Dívida assumida, com este teste como juro.
   */
  it("o mapa do cliente concorda com o do servidor", () => {
    const extrair = (src: string, nome: string) => {
      const i = src.indexOf(nome);
      expect(i, `não achei ${nome}`).toBeGreaterThan(-1);
      const abre = src.indexOf("{", i);
      /*
       * Fim por CONTAGEM DE CHAVES, não pelo recuo do `};`.
       * A primeira versão procurava `"\n  };"` -- o recuo do cliente. No
       * servidor o mapa é declarado no topo e fecha na coluna 0, então a busca
       * seguia arquivo adiante e capturava objetos de outras funções: apareceu
       * uma "ação" chamada `global`. Recuo não delimita escopo.
       */
      let nivel = 0;
      let fecha = abre;
      for (let k = abre; k < src.length; k++) {
        if (src[k] === "{") nivel++;
        else if (src[k] === "}") {
          nivel--;
          if (nivel === 0) { fecha = k; break; }
        }
      }
      const corpo = src.slice(abre, fecha);
      const mapa: Record<string, string> = {};
      for (const m of corpo.matchAll(/(\w+):\s*\{([^}]*)\}/g)) {
        // Normaliza: ordem das chaves e espaços não são diferença de semântica.
        mapa[m[1]] = m[2].split(",").map((x) => x.trim()).filter(Boolean).sort().join("|");
      }
      return mapa;
    };

    const servidor = extrair(MODIFY, "const LOCAL");
    const cliente = extrair(INBOX, "const EFEITO_LOCAL");

    expect(Object.keys(servidor).length).toBeGreaterThanOrEqual(10);
    for (const [acao, efeito] of Object.entries(servidor)) {
      expect(cliente[acao], `a ação "${acao}" existe no servidor e não no cliente`).toBeDefined();
      expect(cliente[acao], `"${acao}" grava diferente no cliente e no servidor`).toBe(efeito);
    }
    for (const acao of Object.keys(cliente)) {
      expect(servidor[acao], `a ação "${acao}" existe no cliente e não no servidor`).toBeDefined();
    }
  });

  /**
   * Mover para pasta SAI da caixa de entrada.
   *
   * A chamada remove `INBOX` -- é o que "mover" significa no Gmail -- e o mapa
   * não gravava nada. O filtro da caixa de entrada do CRM é `!is_archived`, então
   * a mensagem saía da caixa no Gmail e continuava na caixa aqui: mover não
   * movia, do lado que a pessoa está olhando.
   */
  it("mover para pasta marca como arquivada", () => {
    expect(MODIFY).toMatch(/mover_para_pasta: \{ is_archived: true \}/);
  });
});

describe("pastas são labels, e o escopo já existe", () => {
  it("listar e criar, na mesma função", () => {
    expect(LABELS).toMatch(/acao === "criar"/);
    expect(LABELS).toMatch(/GMAIL\}\/labels/);
  });

  /**
   * Label de SISTEMA não é pasta: INBOX, UNREAD, DRAFT são estados que a tela já
   * expõe por outros botões. Oferecê-las como destino produziria "mover para não
   * lido", que não quer dizer nada.
   */
  it("as labels de sistema ficam fora da lista de pastas", () => {
    expect(LABELS).toMatch(/DO_SISTEMA = new Set/);
    for (const l of ["INBOX", "UNREAD", "DRAFT", "TRASH", "CATEGORY_PROMOTIONS"]) {
      expect(LABELS).toContain(`"${l}"`);
    }
    expect(LABELS).toMatch(/l\.type !== "system"/);
  });

  it("ordenadas por nome", () => {
    // O Gmail devolve em ordem de criação, e uma lista fora de ordem alfabética
    // é impossível de percorrer com os olhos.
    expect(LABELS).toMatch(/localeCompare\(b\.name, "pt-BR"\)/);
  });

  it("nome repetido tem mensagem própria", () => {
    // O Gmail responde "Label name exists or conflicts", que não diz o que fazer.
    expect(LABELS).toMatch(/Já existe uma pasta chamada/);
  });
});

describe("o sync guarda as pastas de cada mensagem", () => {
  const SYNC = semComentarios(ler("supabase/functions/gmail-sync/index.ts"));

  it("as labels são gravadas", () => {
    expect(SYNC).toMatch(/const labels: string\[\] = msg\.labelIds \?\? \[\]/);
    expect(SYNC).toMatch(/^\s*labels,$/m);
  });

  /**
   * IDs e não nomes. O nome é editável pela pessoa a qualquer momento, e uma
   * pasta renomeada tornaria toda mensagem dela órfã.
   */
  it("a coluna guarda IDs, e o comentário diz por quê", () => {
    const cru = ler("supabase/migrations/20260831180000_emails_com_pasta.sql");
    expect(cru).toMatch(/labels text\[\]/);
    expect(cru).toMatch(/IDs e não nomes/);
  });
});

describe("o token do Gmail é resolvido em UM lugar", () => {
  /**
   * A mesma lógica de renovação estava inline em `gmail-sender.ts` e em
   * `gmail-sync/index.ts`. A terceira cópia ia nascer em `gmail-modify` — e um
   * bug corrigido numa cópia deixaria as outras quebradas.
   */
  it("gmail-modify e gmail-labels usam o helper compartilhado", () => {
    for (const f of ["gmail-modify", "gmail-labels"]) {
      const src = semComentarios(ler(`supabase/functions/${f}/index.ts`));
      expect(src, f).toContain('from "../_shared/gmail-token.ts"');
      // E não reimplementam a renovação.
      expect(src, f).not.toMatch(/renovarAccessToken/);
    }
  });

  it("a renovação tem margem, para o token não expirar no caminho", () => {
    const helper = semComentarios(ler("supabase/functions/_shared/gmail-token.ts"));
    expect(helper).toMatch(/< 60_000/);
  });
});
