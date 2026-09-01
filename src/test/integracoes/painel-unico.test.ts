/**
 * As seis integrações abrem a configuração DO MESMO JEITO.
 *
 * Elas abriam de quatro jeitos: Meta Ads, Slack e Zapier num diálogo controlado
 * por `editProvider`; WhatsApp num diálogo com estado próprio; Instagram em DOIS
 * `<Dialog>` sem estado, disparados por botões diferentes do rodapé; e o Google
 * num terceiro diálogo. Seis cartões, quatro comportamentos -- aprender um não
 * ensinava nada sobre o próximo.
 *
 * Hoje todos chamam `abrir(chave)` e desenham `<PainelDeIntegracao>` na coluna
 * da direita. O que este arquivo tranca é a REGRESSÃO: nada aqui aparece numa
 * captura de tela, e o jeito de voltar atrás é acrescentar um `<Dialog>` num
 * cartão só -- que continua funcionando, e só fica diferente dos outros cinco.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * SEM COMENTÁRIO, e aqui isso não é detalhe: o comentário que explica por que
 * os dois `<Dialog>` do Instagram saíram CONTÉM a string `<Dialog>`, e
 * reprovaria a própria regra que documenta. É a armadilha que o CLAUDE.md
 * descreve, e já pegou outros testes desta base.
 */
const semComentarios = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const ler = (p: string) => semComentarios(readFileSync(p, "utf8"));

const WHATSAPP = ler("src/components/crm/WhatsAppCard.tsx");
const INSTAGRAM = ler("src/components/crm/InstagramCard.tsx");
const ABA = ler("src/components/integrations/IntegrationsTab.tsx");
const PAINEL = ler("src/components/integrations/PainelDeIntegracao.tsx");
const CONTEXTO = ler("src/components/integrations/contexto-do-painel.ts");

describe("as seis abrem pelo contexto", () => {
  const CHAMADAS: [string, string, string][] = [
    ["WhatsApp", WHATSAPP, 'abrir("whatsapp")'],
    ["Instagram", INSTAGRAM, 'abrir("instagram")'],
    ["Google OAuth", ABA, 'abrir("google-oauth")'],
    // Os genéricos (Meta Ads, Slack, Zapier) abrem pelo provider, num laço só.
    ["genéricos", ABA, "abrir(intg.provider)"],
  ];

  it.each(CHAMADAS)("%s chama abrir()", (_nome, src, chamada) => {
    expect(src).toContain(chamada);
  });

  /** A chave do botão tem de bater com a chave do painel, senão nada abre. */
  const CHAVES: [string, string, string][] = [
    ["WhatsApp", WHATSAPP, 'chave="whatsapp"'],
    ["Instagram", INSTAGRAM, 'chave="instagram"'],
    ["Google OAuth", ABA, 'chave="google-oauth"'],
  ];

  it.each(CHAVES)("%s desenha o painel com a mesma chave", (_nome, src, chave) => {
    expect(src).toContain(chave);
  });

  it("o genérico usa o provider dos dois lados", () => {
    expect(ABA).toContain("chave={intgEmEdicao.provider}");
  });
});

describe("nenhum cartão volta a abrir diálogo próprio", () => {
  /**
   * O caminho de volta é este: alguém acrescenta um `<Dialog>` num cartão para
   * resolver um caso pontual, e aquele cartão passa a abrir diferente dos
   * outros cinco. Continua funcionando -- e é por isso que só um teste pega.
   */
  it.each([
    ["WhatsAppCard", WHATSAPP],
    ["InstagramCard", INSTAGRAM],
  ])("%s não monta <Dialog>", (_nome, src) => {
    expect(src).not.toMatch(/<Dialog[\s>]/);
    expect(src).not.toContain("<DialogContent");
  });

  /**
   * A aba MANTÉM um diálogo, e de propósito: o guia de configuração do Slack é
   * leitura de quatro passos, não formulário, e não há lista para consultar ao
   * lado enquanto se lê. Um só -- se virarem dois, a exceção virou regra.
   */
  it("a aba guarda exatamente um diálogo, o guia do Slack", () => {
    expect(ABA.match(/<Dialog[\s>]/g) ?? []).toHaveLength(1);
    expect(ABA).toContain("open={slackSetupGuide}");
  });
});

describe("o painel se desenha na coluna da direita", () => {
  /**
   * O TESTE QUE MAIS IMPORTA aqui.
   *
   * Cada cartão é uma célula da GRADE, e o painel é desenhado por ele. Sem o
   * portal, o painel nasce dentro da célula -- com a largura de um cartão, no
   * meio da lista. E isso não quebra nada: renderiza, só fica errado.
   */
  it("por portal, e não onde o cartão está", () => {
    expect(PAINEL).toContain("createPortal(");
    expect(PAINEL).toContain('from "react-dom"');
  });

  it("a aba publica o alvo do portal", () => {
    expect(ABA).toContain("ref={alvoRef}");
    // `contents` para o alvo não virar uma coluna vazia ao lado da lista.
    expect(ABA).toMatch(/ref=\{alvoRef\}\s+className="contents"/);
  });

  /**
   * `alvo` vem de callback ref e não de `useRef`: `useRef` não dispara render
   * quando o nó aparece, então o primeiro `createPortal` receberia `null` e o
   * painel só apareceria num render seguinte -- que pode não vir.
   */
  it("o alvo vem de callback ref", () => {
    expect(PAINEL).toContain("const alvoRef = useCallback(");
    expect(PAINEL).not.toMatch(/const alvoRef = useRef/);
  });
});

describe("só um painel por vez", () => {
  /**
   * `aberto` é UMA string, não um booleano por cartão. Com um booleano em cada
   * um, abrir o segundo não fecharia o primeiro e os dois empilhariam na mesma
   * coluna.
   */
  it("o contexto guarda uma chave, não um booleano por cartão", () => {
    expect(CONTEXTO).toMatch(/aberto: string \| null/);
  });

  it("o painel só se desenha quando a chave é a dele", () => {
    expect(PAINEL).toContain("if (aberto !== chave || !alvo) return null;");
  });

  /**
   * A casca fornece o contexto e o conteúdo consome. Sem a divisão, o conteúdo
   * chamaria `useContextoDoPainel()` dentro do componente que fornece o
   * contexto -- e receberia o valor padrão, onde `abrir` não faz nada. Os seis
   * botões ficariam mudos, sem erro nenhum.
   */
  it("a casca fornece e o conteúdo consome", () => {
    expect(ABA).toContain("<ProvedorDoPainel>");
    expect(ABA).toContain("function ConteudoDeIntegracoes(");
    expect(ABA).toMatch(/const \{ abrir, aberto, fechar \} = useContextoDoPainel\(\)/);
  });
});
