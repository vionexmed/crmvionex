/**
 * A tela de Leads saiu, e o kanban assumiu a qualificação.
 *
 * O ciclo de vida avançava assim:
 *
 *   lead                      no cadastro
 *   lead -> contatado         automático, na primeira abordagem registrada
 *   contatado -> oportunidade SÓ pelo botão "Aprovar" da tela de Leads
 *
 * Apagar a tela sem mais nada quebraria o funil: ninguém passaria de
 * "contatado", porque `qualify_lead` era chamada de UM lugar só. O gráfico de
 * ciclo de vida achataria e "Oportunidades geradas" pararia de crescer.
 *
 * A saída aproveita uma coincidência: o painel JÁ define oportunidade como
 * "negócio que saiu da etapa de entrada". As duas noções viviam separadas e
 * podiam discordar -- um contato "contatado" com negócio na terceira coluna era
 * possível, e nenhuma tela mostrava a contradição. Agora a etapa manda.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NAV_GRUPOS, MENU_DA_CONTA, grupoDaRota } from "@/components/layout/navegacao";

const ler = (f: string) => readFileSync(f, "utf8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** A última migração que declara a função — a que vale depois de aplicar tudo. */
const DIR = "supabase/migrations";
function migracaoVigente(fn: string): string {
  const marca = new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${fn}\\s*\\(`);
  const achado = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort().reverse()
    .find((f) => marca.test(ler(join(DIR, f))));
  if (!achado) throw new Error(`nenhuma migração declara ${fn}`);
  return ler(join(DIR, achado));
}

describe("a etapa do negócio move o ciclo de vida", () => {
  const SQL = migracaoVigente("tg_negocio_move_ciclo");

  it("o gatilho observa etapa, status E contato", () => {
    expect(SQL).toMatch(/AFTER INSERT OR UPDATE OF stage_id, status, contact_id ON public\.deals/);
  });

  /**
   * `contact_id` na lista importa: vincular um contato a um negócio que JÁ está
   * avançado precisa promover esse contato, senão o vínculo feito depois deixa o
   * ciclo de vida atrasado para sempre.
   */
  it("sair da etapa de entrada vira oportunidade", () => {
    expect(SQL).toMatch(/NEW\.stage_id <> v_entrada/);
    expect(SQL).toMatch(/avancar_ciclo_do_contato\(NEW\.contact_id, 'opportunity'\)/);
  });

  it("ganho vira cliente", () => {
    expect(SQL).toMatch(/NEW\.status = 'won'/);
    expect(SQL).toMatch(/avancar_ciclo_do_contato\(NEW\.contact_id, 'customer'\)/);
  });

  /**
   * Decisão declarada do usuário. Negócio perdido quase sempre significa "não
   * agora" -- preço, timing -- e não "essa pessoa não serve". Descartar faria
   * reengajar exigir voltar o estágio à mão, e os gatilhos deste projeto nunca
   * regridem.
   */
  it("perdido NÃO mexe no contato", () => {
    // Ramo de uma linha que RETORNA: é a prova, e é por isso que a segunda
    // asserção olha o backfill em vez de tentar provar a mesma coisa de novo.
    // A primeira versão usava /'lost'[\s\S]{0,200}avancar_ciclo/ e reprovava o
    // backfill, onde `<> 'lost'` aparece perto da chamada de forma legítima --
    // janela de tamanho fixo achando vizinhança onde não há relação.
    expect(SQL).toMatch(/IF NEW\.status = 'lost' THEN RETURN NEW; END IF;/);
  });

  it("o backfill também pula os perdidos", () => {
    // Senão a migração faria, uma vez, exatamente o que o gatilho se recusa a
    // fazer sempre.
    expect(SQL).toMatch(/ELSIF r\.status <> 'lost'/);
  });

  it("usa a MESMA definição de etapa de entrada que o painel", () => {
    // Se divergirem, o card "Oportunidades geradas" e o gráfico de ciclo de vida
    // voltam a se contradizer -- que é o defeito que isto vem resolver.
    expect(SQL).toContain("public.etapa_de_entrada(");
  });

  it("negócio sem contato não quebra", () => {
    // Acontece: negócio criado à mão, fora do fluxo de cadastro.
    expect(SQL).toMatch(/IF NEW\.contact_id IS NULL THEN RETURN NEW; END IF;/);
  });
});

describe("o ciclo de vida nunca regride", () => {
  const SQL = migracaoVigente("avancar_ciclo_do_contato");

  /**
   * Arrastar um card para trás para reorganizar o quadro NÃO pode apagar a
   * qualificação: o ciclo de vida é histórico do relacionamento, não espelho da
   * coluna atual. E o histórico em `contact_lifecycle_events` registraria uma
   * regressão que ninguém decidiu.
   */
  it("só avança, comparando por ordem", () => {
    expect(SQL).toMatch(/ordem_do_ciclo\(_para\) > public\.ordem_do_ciclo\(c\.lifecycle_stage\)/);
  });

  it("descartado não é tocado por movimento de card", () => {
    expect(SQL).toMatch(/c\.lifecycle_stage <> 'disqualified'/);
  });

  /**
   * Descartado é 0 e fica FORA da escala. Com 6 pareceria o topo do funil; com 1
   * seria desfeito pelo primeiro avanço de card.
   */
  it("descartado está fora da escala, não no fim dela", () => {
    const ordem = migracaoVigente("ordem_do_ciclo");
    expect(ordem).toMatch(/WHEN 'disqualified' THEN 0/);
    expect(ordem).toMatch(/WHEN 'customer'\s+THEN 5/);
  });

  it("a base atual é corrigida, só para frente", () => {
    // Sem backfill, quem já tem negócio avançado continuaria "contatado" e a
    // mudança pareceria não ter funcionado.
    expect(SQL).toContain("DO $$");
    expect(SQL).not.toMatch(/UPDATE contacts[\s\S]{0,300}SET lifecycle_stage = 'lead'/);
  });
});

describe("a tela de Leads saiu inteira", () => {
  it("o arquivo não existe mais", () => {
    expect(existsSync("src/pages/Leads.tsx")).toBe(false);
  });

  it("nenhum destino aponta para /leads", () => {
    const urls = [...NAV_GRUPOS.flatMap((g) => g.items), ...MENU_DA_CONTA].map((i) => i.url);
    expect(urls).not.toContain("/leads");
  });

  /**
   * A rota CONTINUA existindo, redirecionando. Link salvo e favorito não podem
   * virar 404 -- mesma escolha de /tasks e /setup.
   */
  it("a rota redireciona para o filtro em Contatos", () => {
    const app = semComentarios(ler("src/App.tsx"));
    expect(app).toMatch(/path="\/leads"[\s\S]{0,120}Navigate to="\/contacts\?estagio=lead"/);
  });

  it("os cartões do painel apontam para o filtro", () => {
    const painel = semComentarios(ler("src/pages/Dashboard.tsx"));
    expect(painel).not.toMatch(/href: "\/leads"/);
    expect(painel).toMatch(/href: "\/contacts\?estagio=lead"/);
  });

  it("Contatos entende o parâmetro", () => {
    const tela = semComentarios(ler("src/pages/Contacts.tsx"));
    expect(tela).toMatch(/searchParams\.get\("estagio"\)/);
    // O painel de filtros abre: lista filtrada em silêncio lê-se como base vazia.
    expect(tela).toMatch(/setShowFilters\(true\)/);
  });

  /**
   * O selo contava leads abrindo uma assinatura de realtime em `contacts` para a
   * organização inteira -- só para desenhar um número ao lado de um item de menu
   * que não existe mais.
   */
  it("o selo de contagem saiu da lateral, e a assinatura com ele", () => {
    const barra = semComentarios(ler("src/components/layout/AppSidebar.tsx"));
    expect(barra).not.toMatch(/leadCount/);
    expect(barra).not.toMatch(/leads-count/);
  });

  it("nada mais chama listLeads nem useLeads", () => {
    for (const f of ["src/lib/api/contacts.ts", "src/hooks/queries/useContacts.ts"]) {
      expect(ler(f), f).not.toMatch(/listLeads|useLeads/);
    }
  });

  /** O grupo "Trabalho" continua existindo, com os dois que sobraram. */
  it("a lateral segue coerente", () => {
    expect(grupoDaRota("/dashboard")).toBe("Trabalho");
    expect(grupoDaRota("/activities")).toBe("Trabalho");
    expect(grupoDaRota("/contacts")).toBe("Registros");
  });
});

describe("a importação não cria duplicado", () => {
  const src = semComentarios(ler("src/components/crm/CSVImportModal.tsx"));

  it("compara por e-mail e por telefone", () => {
    expect(src).toContain("chaveEmail");
    expect(src).toContain("chaveTelefone");
  });

  /**
   * Os últimos 8 dígitos: o mesmo número aparece com e sem o 9, com e sem +55,
   * com e sem parênteses. É o mesmo critério que o webhook do WhatsApp usa.
   */
  it("o telefone casa pelos últimos 8 dígitos", () => {
    expect(src).toMatch(/so\.slice\(-8\)/);
  });

  /**
   * A base pode passar de 1000 contatos, e o PostgREST corta EM SILÊNCIO. Um
   * teto aqui é pior que não deduplicar: a partir do contato 1001 a comparação
   * diria "não existe" para gente que existe, e a importação criaria duplicata
   * PARECENDO ter conferido.
   */
  it("lê a base em blocos, sem teto silencioso", () => {
    // Ancorado na CHAMADA, não no nome. A primeira versão fazia
    // `toContain("buscarEmBlocos")` e passava com a função trocada, porque a
    // linha de `import` ainda continha o nome -- o mesmo furo que já apareceu
    // duas vezes nesta sessão.
    const semImports = src.replace(/^import .*$/gm, "");
    expect(semImports).toMatch(/await buscarEmBlocos</);
    expect(semImports).toMatch(/\.range\(inicio, fim\)/);
  });

  it("dedupa também dentro do próprio arquivo", () => {
    // Duas listas encaminhadas coladas numa aba só é o caso mais comum.
    expect(src).toMatch(/if \(e\) emails\.add\(e\)/);
    expect(src).toMatch(/if \(t\) telefones\.add\(t\)/);
  });

  it("diz quantos foram ignorados", () => {
    // Importar 200 e ver "50 importados" sem explicação parece falha do sistema.
    expect(src).toMatch(/repetidos > 0/);
  });
});
