/**
 * A conta entre o número do card e a lista que o explica.
 *
 * O risco que estes testes cobrem não é visual: é o painel mostrar "8" e listar
 * um nome só, sem dizer por quê. O usuário lê isso como dashboard quebrado — foi
 * exatamente a queixa que originou o drill-down.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  resumoDrilldown,
  type LinhaDrilldown,
  type MetricDrilldownKey,
} from "@/hooks/useSdrMetricLeads";
import { CANAL } from "@/components/dashboard/canais";

function linha(toques: number, i = 0): LinhaDrilldown {
  return {
    id: `id-${i}`,
    tipo: "contact",
    titulo: `Lead ${i}`,
    subtitulo: null,
    detalhe: null,
    quando: "2026-08-15T14:22:00Z",
    toques,
    respondeu: null,
    valor: null,
    autor: null,
    canal: null,
    conteudo: null,
  };
}

const linhas = (...toques: number[]) => toques.map((t, i) => linha(t, i));

function resumo(over: Partial<Parameters<typeof resumoDrilldown>[0]> = {}) {
  return resumoDrilldown({
    metric: "abordagens" as MetricDrilldownKey,
    total: 8,
    linhas: linhas(1, 1, 1),
    limite: 5,
    admin: true,
    ...over,
  });
}

describe("resumoDrilldown() — soma dos toques", () => {
  it("soma toques, não linhas: 3 leads podem ser 8 abordagens", () => {
    expect(resumo({ linhas: linhas(5, 2, 1) }).visivel).toBe(8);
  });

  it("lista vazia soma zero", () => {
    expect(resumo({ linhas: [] }).visivel).toBe(0);
  });
});

describe("resumoDrilldown() — quando a conta fecha", () => {
  it("não explica nada quando a lista cobre o total", () => {
    const r = resumo({ linhas: linhas(5, 2, 1) });
    expect(r.resto).toBe(0);
    expect(r.textoResto).toBeNull();
  });

  it("nunca devolve resto negativo", () => {
    // Não deveria acontecer, mas se a lista somar mais que o card — filtros
    // fora de sincronia entre sdr_metrics e sdr_metric_leads — a tela não pode
    // exibir "+-3".
    const r = resumo({ total: 2, linhas: linhas(5) });
    expect(r.resto).toBe(0);
    expect(r.textoResto).toBeNull();
  });

  it("não explica nada quando o card não tem valor", () => {
    expect(resumo({ total: null }).textoResto).toBeNull();
  });
});

describe("resumoDrilldown() — a diferença explicada", () => {
  it("para admin, a diferença é toque sem lead vinculado", () => {
    const r = resumo({ total: 8, linhas: linhas(1, 1, 1), admin: true });
    expect(r.resto).toBe(5);
    expect(r.textoResto).toBe("+5 sem lead vinculado");
  });

  it("para comercial, a diferença inclui carteira alheia", () => {
    const r = resumo({ total: 8, linhas: linhas(1, 1, 1), admin: false });
    expect(r.resto).toBe(5);
    expect(r.textoResto).toBe("+5 de outros responsáveis ou sem lead vinculado");
  });
});

describe("resumoDrilldown() — lista truncada não é lista recortada", () => {
  it("calada quando a lista bateu no limite: a diferença ali é paginação", () => {
    // 5 linhas com limite 5 → pode haver mais. Chamar isso de "outros
    // responsáveis" seria mentira; o rodapé "ver a lista completa" resolve.
    const r = resumo({ total: 40, linhas: linhas(1, 1, 1, 1, 1), limite: 5 });
    expect(r.truncado).toBe(true);
    expect(r.textoResto).toBeNull();
  });

  it("não truncada quando veio menos que o limite", () => {
    expect(resumo({ linhas: linhas(1, 1, 1), limite: 5 }).truncado).toBe(false);
  });

  it("explica a diferença assim que a lista deixa de estar truncada", () => {
    const r = resumo({ total: 8, linhas: linhas(1, 1, 1), limite: 5, admin: true });
    expect(r.truncado).toBe(false);
    expect(r.textoResto).toBe("+5 sem lead vinculado");
  });
});

describe("resumoDrilldown() — taxa de resposta é percentual", () => {
  it("não faz aritmética de resto sobre uma porcentagem", () => {
    // total 8 aqui é "8%", não oito leads. Subtrair linhas de uma porcentagem
    // produziria uma frase absurda.
    const r = resumoDrilldown({
      metric: "taxaResposta",
      total: 8,
      linhas: linhas(1, 1),
      limite: 5,
      admin: false,
    });
    expect(r.resto).toBe(0);
    expect(r.textoResto).toBeNull();
  });
});

describe("o painel lateral e a prévia contam a mesma história", () => {
  it("o painel lateral usa resumoDrilldown", () => {
    // Ele nasceu sem: eu separei o painel da prévia do hover e deixei a linha do
    // resto atrás. O hover explicava a diferença, o painel mostrava a lista
    // crua — e "4 abordagens" com uma linha só lê como número errado.
    const painel = readFileSync("src/components/dashboard/MetricLeadsSheet.tsx", "utf8");
    expect(painel).toContain("resumoDrilldown");
    expect(painel).toContain("textoResto");
  });

  it("o painel recebe o total do card", () => {
    // Sem o total não há com o que comparar a soma dos toques.
    const painel = readFileSync("src/components/dashboard/MetricLeadsSheet.tsx", "utf8");
    expect(painel).toMatch(/total:\s*number\s*\|\s*null/);
    expect(readFileSync("src/pages/Dashboard.tsx", "utf8")).toMatch(/total=\{/);
  });
});

describe("abordagens são rastreáveis", () => {
  const SQL = "supabase/migrations/20260826120000_rastrear_abordagens.sql";
  const sql = readFileSync(SQL, "utf8");

  it("a função devolve autor, canal e conteúdo", () => {
    for (const col of ["autor", "canal", "conteudo"]) {
      expect(sql).toContain(col);
    }
  });

  it("abordagens não agrupa por contato", () => {
    // Agrupar fazia o card dizer 4 e a lista mostrar 1: os eventos sem
    // contact_id entravam na contagem e não tinham nome para aparecer.
    const ramo = sql.slice(sql.indexOf("ELSIF _metric = 'abordagens'"), sql.indexOf("ELSIF _metric = 'taxaResposta'"));
    expect(ramo).not.toContain("GROUP BY");
  });

  it("abordagem sem contato vinculado aparece na lista", () => {
    const ramo = sql.slice(sql.indexOf("ELSIF _metric = 'abordagens'"), sql.indexOf("ELSIF _metric = 'taxaResposta'"));
    expect(ramo).toContain("Sem lead vinculado");
    // LEFT JOIN, não JOIN: com JOIN o evento órfão sumiria de novo.
    expect(ramo).toContain("LEFT JOIN public.contacts");
  });

  it("quem não é admin vê a própria ação, mesmo em lead de outro", () => {
    // Sem a segunda metade da condição, a pessoa não veria a abordagem que ela
    // mesma fez a um lead que não é dela.
    const ramo = sql.slice(sql.indexOf("ELSIF _metric = 'abordagens'"), sql.indexOf("ELSIF _metric = 'taxaResposta'"));
    expect(ramo).toContain("ev.user_id = auth.uid()");
  });

  it("a interface desenha o canal e o autor", () => {
    const row = readFileSync("src/components/dashboard/LeadRow.tsx", "utf8");
    expect(row).toContain("linha.canal");
    expect(row).toContain("linha.autor");
    expect(row).toContain("linha.conteudo");
  });
});

describe("abordagem REALIZADA, não apenas registrada", () => {
  const CORRIGE = readFileSync("supabase/migrations/20260826140000_abordagem_realizada.sql", "utf8");
  const LISTA = readFileSync("supabase/migrations/20260826120000_rastrear_abordagens.sql", "utf8");

  it("o card só conta atividade concluída", () => {
    // Sem isto, reunião agendada para semana que vem contava como abordagem
    // feita hoje — e o card se chama "Abordagens realizadas".
    expect(CORRIGE).toContain("a.completed_at IS NOT NULL");
  });

  it("conta pela data da conclusão, não da criação", () => {
    // Por created_at, ligação criada em julho e feita em agosto apareceria no
    // mês errado — e o número de um mês fechado mudaria depois de fechado.
    expect(CORRIGE).toMatch(/_from IS NULL OR a\.completed_at >= _from/);
    expect(CORRIGE).toMatch(/a\.completed_at::date/);
  });

  it("corrige o card E o gráfico na mesma migração", () => {
    // Corrigir um só faria o gráfico contradizer o card logo acima dele.
    expect(CORRIGE).toContain("public.sdr_metrics");
    expect(CORRIGE).toContain("public.sdr_series");
  });

  it("a lista de eventos usa o mesmo critério", () => {
    const ramo = LISTA.slice(
      LISTA.indexOf("ELSIF _metric = 'abordagens'"),
      LISTA.indexOf("ELSIF _metric = 'taxaResposta'"),
    );
    expect(ramo).toContain("a.completed_at IS NOT NULL");
  });

  /**
   * Este teste já afirmou o contrário, e a justificativa estava errada: dizia
   * que em `emails` o created_at "É a data do envio". Não é — a linha nasce no
   * pré-registro do gmail-send, antes de o Google receber qualquer coisa. Quem
   * sabe a hora do envio é sent_at, e só existe quando o envio deu certo.
   */
  it("o e-mail segue pela hora do envio, não do rascunho", () => {
    expect(CORRIGE).toContain("coalesce(e.sent_at, e.created_at) >= _from");
    // completed_at não existe em emails; o equivalente é o status.
    expect(CORRIGE).not.toMatch(/e\.completed_at/);
    expect(CORRIGE).toContain("e.status = 'sent'");
  });
});

describe("vínculo do e-mail acontece no envio", () => {
  const ENVIO = readFileSync("supabase/functions/gmail-send/index.ts", "utf8");

  it("tenta casar o destinatário com um contato existente", () => {
    expect(ENVIO).toContain("contatoResolvido");
    expect(ENVIO).toMatch(/\.ilike\("email"/);
  });

  it("nunca cria contato a partir do destinatário", () => {
    // Criaria contato de endereço interno, de teste e de fornecedor.
    const trecho = ENVIO.slice(ENVIO.indexOf("contatoResolvido"), ENVIO.indexOf("const toList"));
    expect(trecho).not.toContain(".insert(");
  });
});

/**
 * O selo de canal só existe se as duas metades concordarem.
 *
 * O banco escolhe a string; o frontend a traduz. Quando o banco passa a emitir
 * um valor que o mapa não conhece, o selo simplesmente não aparece — nada quebra,
 * nada avisa, e a linha volta a não dizer de onde veio a abordagem. Foi assim que
 * "ativ" sobreviveu: ninguém tinha como notar.
 */
describe("selo de canal", () => {
  const sql = readFileSync(
    "supabase/migrations/20260826120000_rastrear_abordagens.sql",
    "utf8",
  );
  const CANAIS = ["ligacao", "reuniao", "email_manual", "e-mail", "whatsapp"];

  it.each(CANAIS)("o banco emite %s e o frontend sabe traduzir", (canal) => {
    expect(sql).toContain(`'${canal}'`);
    expect(CANAL[canal]).toBeTruthy();
  });

  it("o mapa não tem rótulo além dos canais que o banco emite", () => {
    expect(Object.keys(CANAL).sort()).toEqual([...CANAIS].sort());
  });

  it("nenhum rótulo é abreviação obscura", () => {
    for (const { rotulo } of Object.values(CANAL)) {
      expect(rotulo.length).toBeGreaterThan(4);
      expect(rotulo).not.toMatch(/^(ativ|whats|em)$/);
    }
  });
});

/**
 * Card, gráfico e lista contam a MESMA coisa.
 *
 * As três vivem em funções SQL separadas, e cada canal tem um campo diferente
 * dizendo se a abordagem aconteceu de verdade. Basta uma das três esquecer o
 * filtro para o painel se contradizer: já aconteceu com completed_at, e o card
 * mostrava reunião de semana que vem como feita hoje.
 */
describe("abordagem só conta quando aconteceu", () => {
  const metrics = readFileSync(
    "supabase/migrations/20260826140000_abordagem_realizada.sql",
    "utf8",
  );
  const leads = readFileSync(
    "supabase/migrations/20260826120000_rastrear_abordagens.sql",
    "utf8",
  );

  // O card e o gráfico moram no mesmo arquivo; a lista, no outro.
  const fontes: Array<[string, string]> = [
    ["sdr_metrics + sdr_series", metrics],
    ["sdr_metric_leads", leads],
  ];

  it.each(fontes)("%s exige atividade concluída", (_nome, sql) => {
    expect(sql).toContain("a.completed_at IS NOT NULL");
  });

  it.each(fontes)("%s exige e-mail enviado", (_nome, sql) => {
    expect(sql).toContain("e.status = 'sent'");
  });

  it.each(fontes)("%s exige WhatsApp aceito pela Meta", (_nome, sql) => {
    expect(sql).toMatch(/w\.status IN \('sent', 'delivered', 'read'\)|FILTER \(WHERE status IN \('sent', 'delivered', 'read'\)\)/);
  });

  it.each(fontes)("%s janela o e-mail pela hora do envio", (_nome, sql) => {
    expect(sql).toContain("coalesce(e.sent_at, e.created_at)");
  });

  /**
   * A taxa de entrega precisa contar TODA tentativa no denominador. Se ela
   * passasse a usar `enviado`, as recusas da Meta sairiam da conta e a taxa
   * subiria justamente quando o envio estivesse falhando.
   */
  it("a taxa de entrega mantém as recusas no denominador", () => {
    expect(metrics).toContain("count(*) AS total");
    expect(metrics).toContain("THEN round(entregue * 100.0 / total)");
    expect(metrics).toContain("(SELECT enviado FROM envio)");
  });
});
