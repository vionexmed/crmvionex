/**
 * Os números do painel depois de uma importação.
 *
 * DEFEITO REAL, relatado no uso: importar 93 contatos não mudava nada no Painel
 * de SDR. Duas causas somadas:
 *
 * 1. A tela de Contatos invalidava só `["contacts", orgId]`. As consultas do
 *    painel vivem em `sdr-metrics`, `sdr-charts` e `sdr-metric-leads` — nenhuma
 *    era tocada.
 * 2. O `staleTime` global é de 5 minutos, então navegar até o painel também não
 *    revalidava.
 *
 * O sintoma engana: parece que a importação não funcionou. A pessoa reimporta, e
 * aí produz duplicata ou "já estavam cadastrados" — dois caminhos ruins a partir
 * de um número velho na tela.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PREFIXOS_DO_PAINEL } from "@/lib/invalidar-painel";

const ler = (f: string) => readFileSync(f, "utf8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("a lista de prefixos não divergiu dos hooks", () => {
  /**
   * A regra que impede o esquecimento: se um hook novo do painel aparecer com
   * prefixo próprio e não entrar na lista, este teste reprova. Sem ele, o
   * esquecimento seria INVISÍVEL — nada quebra, só um número fica velho.
   */
  it("todo prefixo `sdr-*` usado em hook está na lista", () => {
    const usados = new Set<string>();
    for (const nome of readdirSync("src/hooks")) {
      if (!nome.endsWith(".ts")) continue;
      for (const m of ler(join("src/hooks", nome)).matchAll(/\["(sdr-[a-z-]+)"/g)) {
        usados.add(m[1]);
      }
    }
    expect([...usados].sort()).toEqual([...PREFIXOS_DO_PAINEL].sort());
  });
});

describe("quem muda o dado avisa o painel", () => {
  it.each([
    "src/pages/Contacts.tsx",
    "src/hooks/queries/useContacts.ts",
    "src/hooks/queries/useDeals.ts",
  ])("%s chama invalidarPainel", (arquivo) => {
    expect(semComentarios(ler(arquivo))).toContain("invalidarPainel(qc, orgId)");
  });

  /**
   * Prefixo e não chave exata: as consultas carregam período e perfil na chave
   * (`["sdr-metrics", orgId, "mes"]`). Invalidar por igualdade deixaria de fora
   * todo período que a pessoa não estava vendo — ela trocaria o filtro e veria o
   * número velho de novo.
   */
  it("invalida por PREFIXO, não por chave exata", () => {
    const lib = semComentarios(ler("src/lib/invalidar-painel.ts"));
    expect(lib).toMatch(/queryKey: \[prefixo, orgId\]/);
  });
});

describe("o painel revalida ao ser aberto", () => {
  /**
   * A rede de segurança que não dá para esquecer: mesmo que uma mutação nova
   * apareça sem chamar `invalidarPainel`, abrir o painel busca de novo.
   *
   * Necessária porque o `staleTime` global é de 5 minutos e
   * `refetchOnWindowFocus` está desligado — sem isto, o número velho sobrevive à
   * navegação.
   */
  it.each(["src/hooks/useSdrMetrics.ts", "src/hooks/useSdrCharts.ts"])(
    "%s revalida sempre no mount",
    (arquivo) => {
      expect(semComentarios(ler(arquivo))).toMatch(/refetchOnMount: "always"/);
    },
  );

  it("e o staleTime global continua em 5 min, que é o motivo disto existir", () => {
    // Se alguém baixar o staleTime a zero, este teste vira ruído e o
    // `refetchOnMount` deixa de ser necessário -- vale saber.
    expect(semComentarios(ler("src/App.tsx"))).toMatch(/staleTime: 5 \* 60 \* 1000/);
  });
});
