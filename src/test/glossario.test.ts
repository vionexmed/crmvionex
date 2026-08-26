/**
 * Um termo por conceito, em toda a interface.
 *
 * A mesma tela dizia "Funil de vendas" no menu e no h1, "Personalizar Pipeline"
 * no botão dentro dela, e "Pipeline atualizado!" no aviso de sucesso. As etapas
 * eram "Estágio" em Negócios, "Etapa" em Configurações, e "stages" -- em inglês --
 * em dois passos do onboarding.
 *
 * Isso não é preciosismo: quem lê "Funil" e "Pipeline" na mesma tela procura a
 * diferença entre os dois, porque tela bem-feita não usa duas palavras para uma
 * coisa. O custo é o tempo gasto procurando uma distinção que não existe.
 *
 * O vocabulário:
 *
 *   deals                    → Negócio / Negócios
 *   pipelines                → Funil
 *   pipeline_stages          → Etapa
 *   contacts.lifecycle_stage → Ciclo de vida
 *
 * Nomes de arquivo, componente, hook e tabela seguem em inglês, alinhados ao
 * banco. Renomear `DealsKanban` não pagaria nada.
 *
 * ---------------------------------------------------------------------------
 * Sobre a forma deste teste
 *
 * A primeira versão varria todos os .tsx tentando extrair "texto visível" por
 * expressão regular. Reprovou 20 arquivos de uma vez, e nenhum por rótulo
 * errado: pegava `"pipeline_stages"` em `.from(...)`, caminhos de import, e --
 * o pior -- genéricos do TypeScript, porque `useState<Stage[]>` tem um `>` e um
 * `<` e o extrator lia o código entre eles como conteúdo de tag.
 *
 * Um scanner desses só funciona com um parser de JSX de verdade. Sem isso, ou
 * ele deixa passar o que importa, ou grita sem motivo -- e teste que grita sem
 * motivo é teste que alguém desliga. Troquei pela verificação direta: os
 * arquivos que de fato tinham o problema, e as frases exatas que regrediram.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ler = (p: string) => readFileSync(p, "utf8");

/** Sem comentários: eles citam o termo errado justamente para explicá-lo. */
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("a tela de /deals se chama Negócios em todo lugar", () => {
  /**
   * Menu, barra inferior no celular, migalha de pão, paleta de comandos e h1.
   * Divergir em um só significa clicar em "Funil de vendas" e chegar numa tela
   * chamada "Negócios" -- que é pior que o nome antigo, porque agora a pessoa
   * duvida se clicou no lugar certo.
   */
  const pontos = [
    "src/components/layout/AppSidebar.tsx",
    "src/components/layout/MobileBottomNav.tsx",
    "src/components/layout/AppHeader.tsx",
    "src/components/CommandPalette.tsx",
    "src/pages/Deals.tsx",
  ];

  it.each(pontos)("%s", (arq) => {
    expect(ler(arq)).not.toContain("Funil de vendas");
  });
});

describe("'Pipeline' não aparece na interface", () => {
  /**
   * Os arquivos que tinham o termo em texto visível. A lista é explícita de
   * propósito: nomeia onde o problema estava, e uma varredura genérica não
   * consegue distinguir rótulo de identificador sem parser.
   */
  const arquivos = [
    "src/pages/Deals.tsx",
    "src/components/setup/StepPipeline.tsx",
    "src/components/setup/StepComplete.tsx",
    "src/components/onboarding/PipelineStep.tsx",
    "src/components/onboarding/CompleteStep.tsx",
    "src/components/onboarding/OnboardingModal.tsx",
    "src/components/onboarding/WelcomeStep.tsx",
    "src/components/settings/BillingTab.tsx",
    "src/components/integrations/LeadCaptureTab.tsx",
    "src/components/reports/SalesReport.tsx",
    "src/components/crm/AICopilot.tsx",
    "src/components/crm/DashboardAIChat.tsx",
    "src/pages/Leads.tsx",
  ];

  // "Pipeline" com maiúscula em literal ou entre tags é sempre rótulo: o
  // identificador do código é `pipeline`, `pipelineId`, `usePipelines`.
  it.each(arquivos)("%s não mostra 'Pipeline' capitalizado", (arq) => {
    expect(semComentarios(ler(arq))).not.toMatch(/["> ]Pipelines?\b/);
  });

  // "pipeline" minúsculo dentro de frase — "Nome do pipeline", "ao pipeline".
  it.each(arquivos)("%s não mostra 'pipeline' em frase", (arq) => {
    expect(semComentarios(ler(arq))).not.toMatch(/\b(do|no|ao|seu|os|dos|de) pipelines?\b/i);
  });
});

describe("etapa do funil se chama Etapa, não Estágio", () => {
  /**
   * `EmailSequences` usa "Etapa" para passo de sequência de e-mail -- conceito
   * DIFERENTE de pipeline_stages, e por isso fora desta regra. Unificar os dois
   * trocaria uma inconsistência por um erro.
   */
  const doFunil = [
    "src/pages/Deals.tsx",
    "src/components/crm/DealsList.tsx",
    "src/components/settings/PipelinesTab.tsx",
    "src/components/setup/StepPipeline.tsx",
    "src/components/reports/SalesReport.tsx",
    "src/components/reports/CustomReportBuilder.tsx",
  ];

  it.each(doFunil)("%s", (arq) => {
    expect(semComentarios(ler(arq))).not.toMatch(/Estágios?\b/i);
  });
});

describe("'stages' em inglês não vaza para a tela", () => {
  const onboarding = [
    "src/components/onboarding/PipelineStep.tsx",
    "src/components/onboarding/CompleteStep.tsx",
  ];

  it.each(onboarding)("%s", (arq) => {
    // Interpolação visível, do tipo `${stageCount} stages`.
    expect(semComentarios(ler(arq))).not.toMatch(/\}\s*stages\b/);
    expect(semComentarios(ler(arq))).not.toMatch(/\bos stages\b/);
  });
});

describe("Leads descreve o que a qualificação faz de verdade", () => {
  const tela = semComentarios(ler("src/pages/Leads.tsx"));

  /**
   * A tela prometia "O lead vira Prospect em Contatos". A RPC `qualify_lead`
   * grava `lifecycle_stage = 'opportunity'`, que a interface chama
   * "Em negociação" -- nunca 'prospect' nem 'qualified'.
   *
   * Descrição de efeito que não acontece é pior que nenhuma: ensina o time a
   * esperar o estado errado, e quem for conferir vai achar que a qualificação
   * está quebrada.
   */
  it("não promete que o lead vira Prospect", () => {
    expect(tela).not.toMatch(/vira <strong>Prospect<\/strong>/);
  });

  it("diz o estágio que a RPC realmente grava", () => {
    expect(tela).toContain("Em negociação");
  });
});
