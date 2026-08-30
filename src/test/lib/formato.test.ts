/**
 * Formatadores compartilhados.
 *
 * `formatCurrency` estava reescrito em 13 arquivos, e em 12 deles o
 * `Intl.NumberFormat` era construído dentro da função — um formatador novo por
 * célula renderizada.
 *
 * Estes testes são de comportamento, não de leitura de arquivo: aqui há lógica
 * de verdade para verificar.
 */
import { describe, it, expect } from "vitest";
import {
  formatarMoeda,
  formatarMoedaCurta,
  formatarData,
  formatarDataCurta,
  formatarDataHora,
  formatarTempoRelativo,
  diasAte,
} from "@/lib/formato";

// O Intl em pt-BR separa símbolo e número com espaço NÃO SEPARÁVEL (U+00A0),
// não com espaço comum -- então comparar com "R$ 1.234,50" digitado à mão falha
// por um caractere invisível. Escrito por escape em vez de literal: o caractere
// cru no código é indistinguível de um espaço normal ao ler.
const NBSP = "\u00a0";
const normalizar = (s: string) => s.split(NBSP).join(" ");

describe("moeda", () => {
  it("formata em real", () => {
    expect(normalizar(formatarMoeda(1234.5))).toBe("R$ 1.234,50");
  });

  /**
   * Aceitar null é o que permite `formatarMoeda(deal.value)` sem cada chamador
   * repetir `Number(x) || 0` — que é o que os 13 originais faziam.
   */
  it("trata ausência como zero", () => {
    for (const v of [null, undefined, NaN]) {
      expect(normalizar(formatarMoeda(v as number | null))).toBe("R$ 0,00");
    }
  });

  it("respeita a moeda do registro", () => {
    // deals.currency é por linha: uma lista pode misturar BRL e USD.
    expect(formatarMoeda(10, "USD")).toContain("US$");
  });

  it("moeda vazia cai em real, não quebra", () => {
    expect(normalizar(formatarMoeda(1, ""))).toBe("R$ 1,00");
  });

  it("forma curta para eixo de gráfico", () => {
    expect(formatarMoedaCurta(1_500)).toContain("mil");
    expect(formatarMoedaCurta(2_400_000)).toContain("mi");
    expect(normalizar(formatarMoedaCurta(50))).toBe("R$ 50,00");
  });
});

describe("data", () => {
  const d = new Date("2026-09-12T14:30:00");

  it("curta, sem ano", () => {
    // Dentro de chip e de linha, o ano é ruído.
    expect(formatarDataCurta(d)).toMatch(/12/);
    expect(formatarDataCurta(d)).not.toMatch(/2026/);
  });

  it("completa quando o ano importa", () => {
    expect(formatarData(d)).toContain("2026");
  });

  it("com hora, para registro", () => {
    expect(formatarDataHora(d)).toMatch(/14:30/);
  });

  /**
   * Data inválida vinha de string malformada do banco e produzia "Invalid Date"
   * na tela em várias das 18 cópias.
   */
  it("nunca imprime Invalid Date", () => {
    for (const v of [null, undefined, "", "não é data"]) {
      for (const f of [formatarData, formatarDataCurta, formatarDataHora]) {
        expect(f(v as string | null)).toBe("—");
      }
    }
  });

  it("aceita string ISO do banco", () => {
    expect(formatarData("2026-09-12T00:00:00Z")).toContain("2026");
  });
});

describe("tempo relativo", () => {
  /**
   * Nativo, custa zero byte. O `formatDistanceToNow` do date-fns dá o mesmo
   * resultado ao preço do locale pt-BR inteiro — e é mais verboso: "há menos de
   * um minuto" tem 21 caracteres, e foi o que quebrou o layout do card.
   */
  it("é curto o bastante para caber em card", () => {
    const ontem = new Date(Date.now() - 86_400_000);
    expect(formatarTempoRelativo(ontem).length).toBeLessThan(16);
  });

  it("passado e futuro", () => {
    expect(formatarTempoRelativo(new Date(Date.now() - 3 * 86_400_000))).toContain("há");
    expect(formatarTempoRelativo(new Date(Date.now() + 3 * 86_400_000))).toContain("em");
  });

  it("agora não vira 'há 0 segundos'", () => {
    expect(formatarTempoRelativo(new Date())).toBe("agora");
  });

  it("data ausente não quebra", () => {
    expect(formatarTempoRelativo(null)).toBe("—");
  });
});

describe("diasAte", () => {
  /**
   * Comparação por DIA, não por instante: vencer hoje não está atrasado. É o
   * mesmo critério do chip de prazo no card do kanban.
   */
  it("hoje é zero, independente da hora", () => {
    const hojeCedo = new Date();
    hojeCedo.setHours(1, 0, 0, 0);
    expect(diasAte(hojeCedo)).toBe(0);
    const hojeTarde = new Date();
    hojeTarde.setHours(23, 0, 0, 0);
    expect(diasAte(hojeTarde)).toBe(0);
  });

  it("ontem é negativo, amanhã é positivo", () => {
    expect(diasAte(new Date(Date.now() - 86_400_000))).toBe(-1);
    expect(diasAte(new Date(Date.now() + 86_400_000))).toBe(1);
  });

  it("ausência devolve null, não zero", () => {
    // Zero significaria "vence hoje", que é afirmação diferente de "não sei".
    expect(diasAte(null)).toBeNull();
    expect(diasAte("qualquer coisa")).toBeNull();
  });
});
