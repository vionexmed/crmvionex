/**
 * Os destinos do sistema.
 *
 * A barra lateral e a barra inferior do celular mantinham listas SEPARADAS, e
 * elas divergiram sem que ninguém percebesse: 13 telas eram inalcançáveis no
 * celular, e a primeira aba da barra inferior -- rotulada "Home" -- apontava
 * para `/`, que é o LOGIN.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NAV_GRUPOS, ABAS_CELULAR, MENU_DA_CONTA, gruposDoMenuMais } from "@/components/layout/navegacao";

const APP = readFileSync("src/App.tsx", "utf8");

/** Os `path=` do roteador, que é o que de fato existe. */
const ROTAS = new Set(
  [...APP.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]),
);

describe("todo destino do menu existe no roteador", () => {
  /**
   * O par que motivou tudo: `/` é o Login, e a aba principal do celular
   * apontava para lá. Um destino escrito errado não dá erro nenhum -- leva a
   * `NotFound` ou, pior, a uma tela que não é a esperada.
   */
  const destinos = NAV_GRUPOS.flatMap((g) => g.items.map((i) => i.url));

  it.each(destinos)("%s é uma rota", (url) => {
    // A query string não faz parte do caminho: "Tarefas" é
    // `/activities?tipo=task`, o mesmo destino de Atividades com um filtro
    // pré-selecionado.
    const caminho = url.split("?")[0];
    // Rota aninhada aparece no App como caminho relativo: /marketing/visao-geral
    // está declarada como <Route path="visao-geral"> dentro de /marketing.
    const existe = ROTAS.has(caminho) || ROTAS.has(caminho.split("/").pop()!);
    expect(existe, `${url} não está no roteador`).toBe(true);
  });

  /**
   * `/tasks` era uma tela inteira e virou redirecionamento. A rota TEM de
   * continuar existindo: quem tem o link salvo ou nos favoritos precisa chegar
   * ao mesmo lugar.
   */
  it("o caminho antigo de Tarefas continua atendendo", () => {
    expect(APP).toContain('<Route path="/tasks"');
    expect(APP).toMatch(/path="\/tasks" element=\{<Navigate to="\/activities\?tipo=task" replace \/>\}/);
  });

  it("nenhum destino é a raiz", () => {
    // `/` é o Login. Menu de navegação de app autenticado nunca deve apontar
    // para lá -- quem quer sair usa o botão de sair.
    expect(destinos).not.toContain("/");
  });
});

describe("o celular alcança tudo o que a lateral alcança", () => {
  /**
   * Este é o teste que faltava. Enquanto as listas eram duas, nada comparava
   * uma com a outra, e a diferença cresceu até 13.
   */
  it.each([true, false])("admin=%s: nenhum destino fica de fora", (isAdmin) => {
    // `MENU_DA_CONTA` conta como "alcançável no computador": vive no rodapé da
    // lateral. No celular não há rodapé, então ele precisa aparecer no menu
    // "Mais" -- e sem incluí-lo aqui, as cinco telas de configuração sumiriam
    // do celular sem nada acusar.
    const naLateral = [...NAV_GRUPOS, { label: "Conta", items: MENU_DA_CONTA }].flatMap((g) =>
      g.items.filter((i) => isAdmin || !i.adminOnly).map((i) => i.url),
    );
    const noCelular = new Set([
      ...ABAS_CELULAR.map((i) => i.url),
      ...gruposDoMenuMais(isAdmin).flatMap((g) => g.items.map((i) => i.url)),
    ]);
    const faltando = naLateral.filter((u) => !noCelular.has(u));
    expect(faltando, `inalcançável no celular: ${faltando.join(", ")}`).toEqual([]);
  });

  it("as quatro abas fixas cabem na barra", () => {
    // Cinco elementos na barra: quatro abas mais o botão "Mais". Uma sexta não
    // cabe na largura de um celular.
    expect(ABAS_CELULAR).toHaveLength(4);
  });

  it("o menu Mais não repete o que já está nas abas", () => {
    const abas = new Set(ABAS_CELULAR.map((i) => i.url));
    const mais = gruposDoMenuMais(true).flatMap((g) => g.items.map((i) => i.url));
    expect(mais.filter((u) => abas.has(u))).toEqual([]);
  });

  it("quem não é admin não vê item de admin", () => {
    const mais = gruposDoMenuMais(false).flatMap((g) => g.items);
    expect(mais.filter((i) => i.adminOnly)).toEqual([]);
  });
});

describe("os rótulos não se repetem", () => {
  /**
   * "Principal" era renderizado DUAS vezes seguidas na lateral: uma vez cravado
   * no topo, para Leads e Em Risco, e outra vindo da lista de grupos.
   */
  it("cada grupo tem rótulo único", () => {
    const rotulos = NAV_GRUPOS.map((g) => g.label);
    expect(new Set(rotulos).size).toBe(rotulos.length);
  });

  it("a lateral não crava nenhum rótulo fora da lista", () => {
    const src = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");
    // O bloco cravado tinha o texto "Principal" solto no JSX.
    expect(src).not.toMatch(/>\s*Principal\s*</);
    expect(src).toContain("NAV_GRUPOS");
  });

  it("a barra do celular lê a mesma fonte", () => {
    const src = readFileSync("src/components/layout/MobileBottomNav.tsx", "utf8");
    expect(src).toContain('from "./navegacao"');
    // Nenhuma lista própria: era assim que as duas divergiam.
    expect(src).not.toMatch(/const \w+Items = \[/);
  });
});

describe("as rotas que mandam para a raiz querem mesmo o login", () => {
  /**
   * `/` é o Login. Dois lugares mandavam para lá querendo o painel: o botão
   * rotulado "Dashboard" do NotFound, e o fim do wizard de configuração -- que
   * jogava o usuário recém cadastrado de volta na tela de entrada.
   */
  it("NotFound manda para o painel", () => {
    const src = readFileSync("src/pages/NotFound.tsx", "utf8");
    expect(src).toContain('navigate("/dashboard")');
  });

  /**
   * `/setup` era uma SEGUNDA implementação do wizard de onboarding -- mesmos
   * passos, mesmas edge functions, mas sem ler o que já está configurado e sem
   * gravar progresso. E nada no produto apontava para ela: só se chegava
   * digitando a URL.
   *
   * A rota continua atendendo quem a tenha salvo, agora abrindo o wizard de
   * verdade.
   */
  it("o caminho antigo de configuração abre o wizard real", () => {
    expect(APP).toMatch(/path="\/setup" element=\{<Navigate to="\/dashboard\?configurar=1" replace \/>\}/);
  });

  it("o wizard reabre quando pedido pela URL", () => {
    const modal = readFileSync("src/components/onboarding/OnboardingModal.tsx", "utf8");
    expect(modal).toMatch(/get\("configurar"\) === "1"/);
    // Sem o `&& !pedido`, quem já concluiu o onboarding não conseguiria reabrir.
    expect(modal).toMatch(/onboarding_completed && !pedido/);
  });
});

describe("configuração sai da navegação sem sumir", () => {
  /**
   * Eram cinco itens ocupando um sexto do menu lateral — e configuração não é
   * destino de trabalho: ninguém abre o CRM para ir em Segurança. Foram para o
   * menu da conta, no rodapé da lateral, que é onde Linear e Attio as põem.
   *
   * O plano previa fundi-las em abas de Configurações. **Não procede**:
   * Integrações tem seis abas próprias e Segurança duas — fundir faria uma tela
   * de quinze abas, que é pior que o problema. Verifiquei antes de mexer, e é a
   * quarta vez que uma dessas "X é aba de Y" não se sustenta.
   */
  it("as cinco continuam sendo rotas de verdade", () => {
    for (const item of MENU_DA_CONTA) {
      const caminho = item.url.split("?")[0];
      const existe = ROTAS.has(caminho) || ROTAS.has(caminho.split("/").pop()!);
      expect(existe, `${item.url} não está no roteador`).toBe(true);
    }
  });

  it("o rodapé da lateral as monta", () => {
    const src = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");
    expect(src).toContain("MENU_DA_CONTA");
    expect(src).toContain("DropdownMenu");
  });

  it("não estão duplicadas na navegação principal", () => {
    const naNav = new Set(NAV_GRUPOS.flatMap((g) => g.items.map((i) => i.url)));
    for (const item of MENU_DA_CONTA) {
      expect(naNav.has(item.url), `${item.title} em dois lugares`).toBe(false);
    }
  });
});

/**
 * Marketing está no menu, e o que não funciona diz que não funciona.
 *
 * Eu a tinha tirado da navegação inteira, por causa dos cartões sem fonte de
 * dado. Errei a avaliação: o painel do **Meta funciona** — lê `meta_campaigns` e
 * `meta_insights`, que são tabelas sincronizadas de verdade. Só o Google não
 * está integrado.
 *
 * Tirar a tela inteira escondeu o que funciona junto com o que não funciona.
 */
describe("Marketing está no menu, com o que não funciona declarado", () => {
  it("é um destino da navegação", () => {
    const destinos = NAV_GRUPOS.flatMap((g) => g.items.map((i) => i.url));
    expect(destinos).toContain("/marketing/visao-geral");
  });

  /**
   * `google.campaigns` é `[]` CRAVADO no código, e o tipo `MarketingSource`
   * tinha um valor só — `"real"` — que os dois canais usavam. Um tipo de um
   * valor não distingue nada, e ali ele afirmava que dado inexistente era real.
   */
  it("o Google é marcado como não integrado, não como real", () => {
    const hook = readFileSync("src/hooks/useMarketingData.ts", "utf8");
    expect(hook).toContain('"nao-integrado"');
    expect(hook).not.toMatch(/google: \{ campaigns: \[\], source: "real" \}/);
  });

  /**
   * A tela dizia "Conecte sua conta Google Ads" e oferecia um botão para
   * Integrações — onde não existe integração de Google Ads para conectar.
   * Mandava a pessoa procurar uma coisa que não está lá.
   */
  it("a tela do Google não promete uma conexão que não existe", () => {
    const src = readFileSync("src/pages/marketing/Overview.tsx", "utf8");
    expect(src).toContain('integrado={false}');
    expect(src).toMatch(/ainda não integrado/);
  });
});


describe("a estrutura de grupos", () => {
  /**
   * Eram SEIS grupos, e dois deles com um item só — "Atenção" com Leads e
   * "Marketing" com uma página. Um grupo de um item é um cabeçalho gastando
   * uma linha para não agrupar nada.
   *
   * E "Analytics" continha Automações e Lead Scoring, que não são analytics.
   */
  it("quatro grupos, nenhum com menos de dois itens", () => {
    expect(NAV_GRUPOS).toHaveLength(4);
    for (const g of NAV_GRUPOS) {
      expect(g.items.length, `grupo "${g.label}" com ${g.items.length} item`).toBeGreaterThan(1);
    }
  });

  it("os nomes dizem o que o grupo tem", () => {
    expect(NAV_GRUPOS.map((g) => g.label)).toEqual([
      "Trabalho", "Registros", "Atendimento", "Análise",
    ]);
  });
});

describe("o cabeçalho não mantém lista própria", () => {
  const HEADER = readFileSync("src/components/layout/AppHeader.tsx", "utf8");

  /**
   * Havia um `routeLabels` escrito à mão — uma TERCEIRA lista de destinos,
   * depois da lateral e da barra do celular. E já tinha divergido: continha
   * `/tasks`, que virou redirecionamento, e "Templates de Email", renomeado
   * dois commits antes.
   */
  it("deriva de NAV_GRUPOS", () => {
    expect(HEADER).toContain("NAV_GRUPOS");
    expect(HEADER).not.toMatch(/const routeLabels/);
  });

  /** `/` é o Login — o mesmo defeito que NotFound e Setup tinham. */
  it("o primeiro elo do caminho não leva ao login", () => {
    expect(HEADER).not.toMatch(/label: "VIONEX", href: "\/"/);
    expect(HEADER).toMatch(/label: "VIONEX", href: "\/dashboard"/);
  });
});
