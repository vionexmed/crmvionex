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
   * A ABA NÃO TEM MAIS NENHUM DIÁLOGO.
   *
   * O guia do Slack era a última exceção -- e cobria justamente o painel do
   * Slack, então quem seguia os quatro passos perdia de vista o formulário para
   * o qual eles levam. Agora ele mora dentro daquele painel.
   */
  it("a aba não monta diálogo nenhum", () => {
    expect(ABA.match(/<Dialog[\s>]/g) ?? []).toHaveLength(0);
  });

  it("o guia do Slack vive dentro do painel do Slack", () => {
    expect(ABA).toContain('intgEmEdicao.provider === "slack" && slackSetupGuide');
  });
});

describe("a configuração abre numa gaveta, como o perfil de contato", () => {
  /**
   * O TESTE QUE MAIS IMPORTA aqui.
   *
   * O CRM já ensinou um gesto para "detalhe de uma coisa": a gaveta que entra
   * pela direita, do `ContactDrawer`. Abrir integração de outro jeito obrigaria
   * a aprender duas convenções para o mesmo movimento.
   *
   * Já foram tentadas duas outras formas, e as duas tinham defeito próprio: um
   * `<Dialog>` centralizado, que cobria a lista inteira; e uma coluna fixa no
   * fluxo, que comia ~340px permanentes e derrubava a grade para dois cartões
   * por linha mesmo com nada aberto.
   */
  it("usa o Sheet, não Dialog nem coluna fixa", () => {
    expect(PAINEL).toContain("<Sheet ");
    expect(PAINEL).toContain("<SheetContent");
    expect(PAINEL).not.toContain("createPortal");
  });

  /** Mesma largura do perfil de contato: é o mesmo gesto, e larguras diferentes
   *  para a mesma gaveta leem como duas coisas. */
  it("tem a mesma largura da gaveta de contato", () => {
    const DRAWER = ler("src/components/crm/ContactDrawer.tsx");
    const largura = DRAWER.match(/w-\[(\d+)px\]/)?.[1];
    expect(largura).toBeTruthy();
    expect(PAINEL).toContain(`w-[${largura}px]`);
    expect(PAINEL).toContain(`sm:max-w-[${largura}px]`);
  });

  /**
   * O `SheetContent` desenha o próprio X em `right-4 top-4`. Sem afastar, o
   * controle do topo do painel fica embaixo dele -- é o mesmo motivo do `mr-8`
   * no ContactDrawer.
   */
  it("o controle do topo não fica embaixo do X", () => {
    expect(PAINEL).toContain("mr-8");
  });
});

describe("a grade não perde largura para o painel", () => {
  /**
   * Com o painel encaixado como coluna, a grade caía para dois cartões por
   * linha o tempo todo -- inclusive sem nada aberto, que é o estado normal da
   * tela. A gaveta cobre só enquanto está aberta.
   */
  it("a lista chega a três colunas", () => {
    expect(ABA).toContain("xl:grid-cols-3");
  });

  it("a aba não monta mais a coluna fixa", () => {
    expect(ABA).not.toContain("lg:flex-row");
    expect(ABA).not.toContain("alvoRef");
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

  it("o painel só abre quando a chave é a dele", () => {
    expect(PAINEL).toContain("open={aberto === chave}");
  });
});
