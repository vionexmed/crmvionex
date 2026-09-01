/**
 * A casca comum das páginas.
 *
 * O levantamento mediu por que a interface parece "esquisita e confusa", e a
 * causa nº 1 não é decoração: **o título muda de tamanho e de FONTE conforme a
 * tela**. `PageHeader` aparecia em 9 de 27 páginas; 16 montavam `<h1>` próprio
 * em quatro tamanhos (`text-2xl`, `text-xl sm:text-2xl`, `text-lg sm:text-xl`,
 * `text-[20px]`), herdando Nunito, enquanto o `PageHeader` usa Poppins.
 *
 * O espaçamento raiz também variava sem hierarquia: `space-y-3`, `space-y-4`,
 * `space-y-5`. Ter UM valor importa mais do que qual valor -- ritmo vertical só
 * é perceptível quando se repete.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * Toda página INTERNA usa a casca. As exceções estão logo abaixo, cada uma com
 * o motivo -- e é a lista de exceções que impede a regra de virar decoração.
 */
const COM_CASCA = [
  "src/pages/Dashboard.tsx",
  "src/pages/Contacts.tsx",
  "src/pages/Deals.tsx",
  "src/pages/Companies.tsx",
  "src/pages/Activities.tsx",
  "src/pages/Reports.tsx",
  "src/pages/SalesGoals.tsx",
  "src/pages/LeadScoring.tsx",
  "src/pages/Automations.tsx",
  "src/pages/EmailSequences.tsx",
  "src/pages/EmailTemplates.tsx",
  "src/pages/MyEmail.tsx",
  "src/pages/Team.tsx",
  "src/pages/Settings.tsx",
  "src/pages/SecuritySettings.tsx",
  "src/pages/Integrations.tsx",
];

/**
 * As que NÃO usam, e por quê. Cada motivo é diferente, e nenhum é "não deu
 * tempo" -- se fosse, estaria na lista de cima.
 */
const SEM_CASCA: Record<string, string> = {
  // Fora do app: cartão centralizado em tela cheia, sem barra lateral. A casca
  // pressupõe estar dentro do AppLayout.
  "src/pages/Login.tsx": "fora do app",
  "src/pages/ResetPassword.tsx": "fora do app",
  "src/pages/AcceptInvite.tsx": "fora do app",
  "src/pages/NotFound.tsx": "fora do app",

  // Altura cheia: `h-[calc(100vh-3.5rem)]` com rolagem interna. O `space-y-4`
  // da casca quebraria o flex.
  "src/pages/Inbox.tsx": "altura cheia",
  "src/pages/Conversations.tsx": "altura cheia",

  // Título editável no lugar: clicar no nome do negócio abre o campo. Não é
  // cabeçalho de página, é um controle.
  "src/pages/DealDetail.tsx": "título editável",

  // Só redirecionamento e <Outlet/>. Não desenha nada.
  "src/pages/Marketing.tsx": "casca de rota",
};

describe("as telas internas usam a mesma casca", () => {
  /**
   * Toda página está classificada: ou usa a casca, ou tem motivo declarado.
   * Sem isto, uma página nova entra sem cabeçalho e ninguém percebe -- que é
   * exatamente como as 16 divergências apareceram.
   */
  it("nenhuma página fica fora das duas listas", () => {
    const todas = readdirSync("src/pages")
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => `src/pages/${f}`);
    const classificadas = new Set([...COM_CASCA, ...Object.keys(SEM_CASCA)]);
    const orfas = todas.filter((f) => !classificadas.has(f));
    expect(orfas, `sem classificação:\n${orfas.join("\n")}`).toEqual([]);
  });

  it.each(Object.entries(SEM_CASCA))("%s fica de fora: %s", (arquivo) => {
    expect(readFileSync(arquivo, "utf8")).not.toContain("<PageShell");
  });

  it.each(COM_CASCA)("%s monta PageShell", (arquivo) => {
    const src = semComentarios(readFileSync(arquivo, "utf8"));
    expect(src).toContain('from "@/components/layout/PageShell"');
    expect(src).toContain("<PageShell");
  });

  /**
   * `<h1>` solto é o que fazia o título mudar de fonte entre telas vizinhas.
   * Só o `PageHeader` deve montar um.
   */
  it.each(COM_CASCA)("%s não monta título próprio", (arquivo) => {
    expect(semComentarios(readFileSync(arquivo, "utf8"))).not.toContain("<h1");
  });

  /**
   * O wrapper raiz vinha com três valores diferentes -- `space-y-3` em
   * Negócios, `space-y-4` em Contatos, `space-y-5` no Painel e em Metas. Agora
   * quem decide é o PageShell, e a página não repete a decisão.
   *
   * A verificação é sobre o COMPONENTE EXPORTADO, não sobre o arquivo: quase
   * todos têm funções auxiliares que devolvem formulários com `space-y-2`, e
   * essas decidem o próprio espaçamento com razão.
   */
  it.each(COM_CASCA)("%s abre direto na casca", (arquivo) => {
    const src = semComentarios(readFileSync(arquivo, "utf8"));
    // Ancorado na indentação da raiz -- `  return (` com o elemento em quatro
    // espaços. As auxiliares ficam mais fundas, ou devolvem JSX de dentro de um
    // `if`, e não são confundidas com a raiz. (`Automations` tem uma
    // `renderTriggerConfig` cujo `return` vem ANTES do da página.)
    //
    // Uma asserção só, e é a que basta: se a raiz é o PageShell, a página não
    // está decidindo o próprio espaçamento. Proibir `<div className="space-y-"`
    // no arquivo inteiro reprovaria `SecuritySettings`, que tem `AuditLogTab` e
    // `SessionsTab` no escopo do módulo -- sub-componentes que decidem o
    // próprio respiro com razão.
    expect(src, "a raiz não abre em PageShell").toMatch(/\n {2}return \(\n {4}<PageShell/);
  });

  it("o PageShell é quem fixa o ritmo vertical", () => {
    const src = readFileSync("src/components/layout/PageShell.tsx", "utf8");
    /*
     * `\s*` entre o `cn(` e o valor: a versão anterior casava o literal
     * `cn("space-y-4"` e quebrou quando o `cn` ganhou uma segunda linha, sem que
     * o invariante tivesse mudado -- o ritmo continua saindo daqui. Teste que
     * quebra por quebra de linha é teste que alguém desliga.
     */
    expect(src).toMatch(/cn\(\s*"space-y-4"/);
  });

  /**
   * O modo de altura cheia é OPCIONAL, e tem de continuar sendo.
   *
   * Ele existe para o kanban, onde a coluna é que rola. Ligado por padrão,
   * transformaria toda página comprida num contêiner de rolagem interno -- e
   * lista longa quer rolar a página, não uma caixa dentro dela.
   */
  it("o preenchimento de altura é opt-in", () => {
    const src = readFileSync("src/components/layout/PageShell.tsx", "utf8");
    expect(src).toMatch(/preencherAltura = false/);
  });
});

describe("o PageHeader não carrega prop morta", () => {
  /**
   * `pattern` estava marcada no próprio código como "kept for API
   * compatibility, no longer used" -- e cinco páginas passavam valores
   * diferentes ("grid", "waves", "dots", "ticks", "diagonal") acreditando que
   * mudavam alguma coisa.
   */
  it("pattern saiu do componente", () => {
    expect(readFileSync("src/components/layout/PageHeader.tsx", "utf8")).not.toContain("pattern");
  });

  it.each([
    "src/pages/Reports.tsx",
    "src/pages/Conversations.tsx",
    "src/pages/Activities.tsx",
    "src/pages/Companies.tsx",
  ])("%s não passa mais pattern", (arquivo) => {
    expect(readFileSync(arquivo, "utf8")).not.toMatch(/pattern="/);
  });
});

describe("Negócios usa o controle segmentado compartilhado", () => {
  const src = semComentarios(readFileSync("src/pages/Deals.tsx", "utf8"));

  /**
   * Era a quarta cópia escrita à mão do mesmo grupo de pílulas, com medidas
   * próprias e sem `aria-pressed` -- nenhuma das quatro anunciava a seleção
   * para leitor de tela.
   */
  it("monta SegmentedControl", () => {
    expect(src).toContain("<SegmentedControl<ViewMode>");
  });

  it("não sobrou grupo de pílulas à mão", () => {
    expect(src).not.toMatch(/rounded-md border border-border bg-muted\/50 p-0\.5/);
  });
});
