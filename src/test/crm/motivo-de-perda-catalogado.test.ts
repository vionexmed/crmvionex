/**
 * "Motivo da Perda" tinha DUAS armadilhas antes desta mudança:
 *
 * 1. Os dois modais (Deals.tsx e DealDetail.tsx) tinham a lista de motivos
 *    HARDCODED em `<SelectItem>`, enquanto o catálogo `loss_reasons` já existia
 *    e já tinha tela de gestão (PipelinesTab). Uma organização que cadastrasse
 *    motivo próprio nunca o via aparecer ao marcar um negócio como perdido.
 *
 * 2. `confirmLoss` gravava `motivo + ": " + nota` CONCATENADOS num campo de
 *    texto livre só. O relatório de perdas agrupava pela string inteira, e cada
 *    observação digitada criava um grupo novo -- "por que perdemos?" não tinha
 *    resposta confiável.
 *
 * Este teste tranca as duas coisas: nenhum modal reintroduz `<SelectItem
 * value="Preço">`-e-companhia hardcoded, e nenhum dos dois volta a concatenar
 * categoria e nota antes de gravar.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ler = (p: string) => readFileSync(p, "utf8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const deals = semComentarios(ler("src/pages/Deals.tsx"));
const dealDetail = semComentarios(ler("src/pages/DealDetail.tsx"));
const api = semComentarios(ler("src/lib/api/deals.ts"));
const hooks = semComentarios(ler("src/hooks/queries/useDeals.ts"));
const lossReasonsApi = semComentarios(ler("src/lib/api/loss-reasons.ts"));
const lossReasonsHook = semComentarios(ler("src/hooks/queries/useLossReasons.ts"));
const salesReport = semComentarios(ler("src/components/reports/SalesReport.tsx"));

// Os sete motivos que estavam hardcoded. Se qualquer um reaparecer como valor
// literal de SelectItem num dos dois modais, a lista voltou a ser fixa.
const MOTIVOS_HARDCODED = [
  "Preço muito alto",
  "Perdeu para concorrência",
  "Timing inadequado",
  "Sem orçamento",
  "Produto não atende",
  "Sem resposta do cliente",
];

describe("motivo de perda vem do catálogo, não de lista fixa", () => {
  it.each(MOTIVOS_HARDCODED)("Deals.tsx não tem %s hardcoded num SelectItem", (motivo) => {
    expect(deals).not.toContain(`>${motivo}</SelectItem>`);
  });

  it.each(MOTIVOS_HARDCODED)("DealDetail.tsx não tem %s hardcoded num SelectItem", (motivo) => {
    expect(dealDetail).not.toContain(`>${motivo}</SelectItem>`);
  });

  it("Deals.tsx lê o catálogo pelo hook compartilhado", () => {
    expect(deals).toContain("useLossReasons(");
  });

  it("DealDetail.tsx lê o catálogo pelo hook compartilhado", () => {
    expect(dealDetail).toContain("useLossReasons(");
  });

  it("existe um módulo de API único para o catálogo", () => {
    expect(lossReasonsApi).toContain("loss_reasons");
  });

  it("existe um hook único para os dois modais compartilharem", () => {
    expect(lossReasonsHook).toContain("export function useLossReasons(");
  });
});

describe("categoria e nota não são mais concatenadas", () => {
  it("dealsApi.updateStatus não concatena motivo e nota", () => {
    expect(api).not.toMatch(/\$\{.*[Ll]ossReason.*\}:\s*\$\{.*[Nn]ote/);
    expect(api).not.toContain('": "');
  });

  it("dealsApi.updateStatus grava loss_reason_id e loss_reason separados", () => {
    const bloco = api.slice(api.indexOf("updateStatus:"));
    expect(bloco).toContain("payload.loss_reason_id");
    expect(bloco).toContain("payload.loss_reason");
  });

  it("useUpdateDealStatus expõe lossReasonId e lossReasonNote, não lossReason concatenado", () => {
    const bloco = hooks.slice(hooks.indexOf("useUpdateDealStatus"));
    expect(bloco).toContain("lossReasonId");
    expect(bloco).toContain("lossReasonNote");
  });

  it("Deals.tsx não concatena motivo e nota antes de salvar", () => {
    expect(deals).not.toMatch(/lossReason(Id)?\s*\+|`\$\{lossReason(Id)?\}:/);
    const bloco = deals.slice(deals.indexOf("const confirmLoss"));
    expect(bloco.slice(0, bloco.indexOf("};"))).not.toMatch(/:\s*\$\{lossNote\}|\$\{lossReasonId\}:\s*\$\{/);
  });

  it("DealDetail.tsx não concatena motivo e nota antes de salvar", () => {
    const bloco = dealDetail.slice(dealDetail.indexOf("const confirmLoss"));
    expect(bloco.slice(0, bloco.indexOf("};"))).not.toMatch(/:\s*\$\{lossNote\}|\$\{lossReasonId\}:\s*\$\{/);
  });
});

describe("estado vazio/erro do catálogo nos modais", () => {
  it("Deals.tsx trata catálogo vazio e erro de carregamento", () => {
    expect(deals).toContain("lossReasonsIsError");
    expect(deals).toContain("lossReasonsLoading");
  });

  it("DealDetail.tsx trata catálogo vazio e erro de carregamento", () => {
    expect(dealDetail).toContain("lossReasonsIsError");
    expect(dealDetail).toContain("lossReasonsLoading");
  });
});

describe("exibição de motivo de perda prefere o catálogo, sem perder texto legado", () => {
  it("DealDetail.tsx procura o rótulo do catálogo por loss_reason_id", () => {
    expect(dealDetail).toContain("loss_reason_id");
    expect(dealDetail).toContain("deal.loss_reason");
  });

  it("SalesReport agrupa perdas pela categoria do catálogo, com fallback pro texto legado", () => {
    expect(salesReport).toContain("loss_reason_id");
    expect(salesReport).toContain("d.loss_reason?.trim()");
  });
});
