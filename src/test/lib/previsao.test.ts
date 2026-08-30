/**
 * A previsão de fechamento.
 *
 * Existiam DUAS implementações — a aba Previsão em Negócios e a aba Previsão em
 * Relatórios. Usavam os MESMOS limiares e nomes DIFERENTES para a mesma coisa:
 *
 *     prob ≥ 80   "Comprometido"   ·   "Pessimista"
 *     prob ≥ 50   "Melhor caso"    ·   "Realista"
 *     prob ≥ 30   (não existia)    ·   "Otimista"
 *
 * E a faixa ≥80 era pintada de VERDE numa tela e de VERMELHO na outra: o mesmo
 * número lido como conquista de um lado e como problema do outro.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { calcularPrevisao, totaisDaPrevisao, FAIXAS_PREVISAO } from "@/lib/previsao";

const HOJE = new Date("2026-09-15T12:00:00");
const negocio = (value: number, probability: number, close_date?: string) =>
  ({ value, probability, close_date: close_date ?? null });

describe("faixas", () => {
  it("as três, do mais confiável para o menos", () => {
    expect(FAIXAS_PREVISAO.map((f) => f.minimo)).toEqual([80, 50, 30]);
  });

  /**
   * A cor acompanha a confiança: verde no mais provável. "Pessimista" em
   * vermelho para a faixa ≥80% invertia a leitura -- vermelho diz "problema",
   * e essa é a estimativa com mais chance de se confirmar.
   */
  it("a faixa mais confiável é verde, não vermelha", () => {
    expect(FAIXAS_PREVISAO[0].cor).toBe("text-success");
    expect(FAIXAS_PREVISAO.some((f) => f.cor.includes("destructive"))).toBe(false);
  });
});

describe("calcularPrevisao", () => {
  it("soma cada faixa cumulativamente", () => {
    // Um negócio de 90% entra nas TRÊS faixas: é ≥80, ≥50 e ≥30. As faixas são
    // cumulativas, não fatias exclusivas -- e a barra empilhada por isso subtrai
    // uma da outra.
    const [mes] = calcularPrevisao([negocio(100, 90, "2026-09-20")], { hoje: HOJE });
    expect(mes.comprometido).toBe(100);
    expect(mes.provavel).toBe(100);
    expect(mes.possivel).toBe(100);
    expect(mes.pipeline).toBe(100);
  });

  it("probabilidade no limiar entra na faixa", () => {
    const [mes] = calcularPrevisao([negocio(100, 80, "2026-09-20")], { hoje: HOJE });
    expect(mes.comprometido).toBe(100);
  });

  it("um ponto abaixo fica de fora", () => {
    const [mes] = calcularPrevisao([negocio(100, 79, "2026-09-20")], { hoje: HOJE });
    expect(mes.comprometido).toBe(0);
    expect(mes.provavel).toBe(100);
  });

  it("valor sempre entra no pipeline, mesmo com probabilidade zero", () => {
    const [mes] = calcularPrevisao([negocio(100, 0, "2026-09-20")], { hoje: HOJE });
    expect(mes.pipeline).toBe(100);
    expect(mes.possivel).toBe(0);
  });

  /**
   * As duas implementações já faziam isso, e é o certo: descartar o negócio sem
   * data esconderia valor da soma total.
   */
  it("negócio sem data de fechamento cai no mês corrente", () => {
    const meses = calcularPrevisao([negocio(100, 90)], { hoje: HOJE });
    expect(meses).toHaveLength(1);
    expect(meses[0].chave).toBe("2026-09");
  });

  /**
   * `close_date` é coluna DATE: chega como "2026-09-01", sem hora.
   * `new Date("2026-09-01")` é meia-noite **UTC**, e no Brasil (UTC−3) isso é
   * 31 de agosto às 21h -- então `getMonth()` devolvia agosto.
   *
   * Efeito: TODO negócio que fecha no primeiro dia do mês era contado no mês
   * ANTERIOR. As duas implementações originais tinham o defeito, então erravam
   * igual e a divergência nunca apareceu.
   */
  it("dia 1º conta no próprio mês, não no anterior", () => {
    const [mes] = calcularPrevisao([negocio(100, 90, "2026-09-01")], { hoje: HOJE });
    expect(mes.chave).toBe("2026-09");
  });

  it("string com hora continua sendo um instante", () => {
    // "2026-09-01T10:00:00Z" é um momento de verdade; converter para o fuso
    // local é o certo aí. Só a data-pura precisa da leitura local.
    const [mes] = calcularPrevisao([negocio(100, 90, "2026-09-01T10:00:00Z")], { hoje: HOJE });
    expect(mes.chave).toBe("2026-09");
  });

  it("agrupa por mês e ordena cronologicamente", () => {
    const meses = calcularPrevisao(
      [negocio(1, 90, "2026-11-05"), negocio(2, 90, "2026-09-05"), negocio(3, 90, "2026-10-05")],
      { hoje: HOJE },
    );
    expect(meses.map((m) => m.chave)).toEqual(["2026-09", "2026-10", "2026-11"]);
  });

  describe("janela fixa", () => {
    /**
     * Sem os meses vazios, o gráfico pula de setembro para novembro quando
     * outubro não tem negócio -- e a lacuna parece dado em vez de ausência.
     */
    it("cria o mês mesmo sem negócio nenhum", () => {
      const meses = calcularPrevisao([negocio(100, 90, "2026-09-20")], { meses: 3, hoje: HOJE });
      expect(meses.map((m) => m.chave)).toEqual(["2026-09", "2026-10", "2026-11"]);
      expect(meses[1].pipeline).toBe(0);
    });

    /**
     * Um relatório de 3 meses não deve somar fechamento previsto para o ano que
     * vem. Sem janela, todos os meses entram.
     */
    it("descarta o que está fora da janela", () => {
      const meses = calcularPrevisao(
        [negocio(100, 90, "2026-09-20"), negocio(999, 90, "2027-06-01")],
        { meses: 3, hoje: HOJE },
      );
      expect(totaisDaPrevisao(meses).pipeline).toBe(100);
    });

    it("sem janela, nada é descartado", () => {
      const meses = calcularPrevisao(
        [negocio(100, 90, "2026-09-20"), negocio(999, 90, "2027-06-01")],
        { hoje: HOJE },
      );
      expect(totaisDaPrevisao(meses).pipeline).toBe(1099);
    });
  });

  it("data inválida não quebra nem entra na conta", () => {
    const meses = calcularPrevisao([negocio(100, 90, "não é data")], { hoje: HOJE });
    expect(meses).toEqual([]);
  });

  it("lista vazia devolve lista vazia", () => {
    expect(calcularPrevisao([], { hoje: HOJE })).toEqual([]);
  });
});

describe("as duas telas usam a mesma fonte", () => {
  const TELAS = [
    "src/components/crm/DealsForecast.tsx",
    "src/components/reports/ForecastReport.tsx",
  ];

  it.each(TELAS)("%s importa lib/previsao", (arquivo) => {
    expect(readFileSync(arquivo, "utf8")).toContain('from "@/lib/previsao"');
  });

  it.each(TELAS)("%s não recalcula por conta própria", (arquivo) => {
    const src = readFileSync(arquivo, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // Os limiares literais são a marca do cálculo duplicado.
    expect(src).not.toMatch(/prob >= 80|prob >= 50|prob >= 30/);
  });

  it("o vocabulário antigo não sobreviveu em nenhuma", () => {
    for (const arquivo of TELAS) {
      const src = readFileSync(arquivo, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const termo of ["Pessimista", "Realista", "Otimista", "Melhor Caso", "Melhor caso"]) {
        expect(src, `"${termo}" ainda em ${arquivo}`).not.toContain(termo);
      }
    }
  });
});
