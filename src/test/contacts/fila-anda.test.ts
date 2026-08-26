/**
 * A fila de leads tem de andar.
 *
 * `lifecycle_stage` tem seis valores e 'contacted' era inalcançável: nada no
 * sistema jamais escrevia esse valor. Consequência, depois de corrigir a
 * derivação que fazia todo mundo nascer 'qualified': toda pessoa entra em 'lead'
 * e fica lá para sempre. A fila cresce sem parar e a etapa "Contatados" do funil
 * SDR fica em zero permanente.
 *
 * Estes testes travam as duas metades: a promoção existe com o critério certo, e
 * a lista não tem teto silencioso.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const MIG = "supabase/migrations/20260826160000_lead_contatado.sql";
const sql = readFileSync(MIG, "utf8");

describe("promoção de lead para contatado", () => {
  it("existe uma função de promoção", () => {
    expect(sql).toContain("promover_lead_para_contatado");
  });

  /**
   * Sem SECURITY DEFINER a promoção falha em silêncio justamente nos casos que
   * importam: a RLS de `contacts` é por dono, e um vendedor pode abordar lead de
   * outro. O UPDATE seria bloqueado e ninguém saberia.
   */
  it("roda com privilégio próprio, senão a RLS por dono a bloqueia", () => {
    expect(sql).toMatch(/promover_lead_para_contatado[\s\S]{0,300}SECURITY DEFINER/);
  });

  /**
   * O guard `lifecycle_stage = 'lead'` faz três coisas: torna idempotente,
   * impede regressão de quem já avançou, e evita reescrever lifecycle_changed_at
   * a cada mensagem enviada.
   */
  it("nunca regride quem já passou de lead", () => {
    expect(sql).toMatch(/SET lifecycle_stage = 'contacted'[\s\S]{0,200}lifecycle_stage = 'lead'/);
  });
});

describe("o critério de abordagem é o mesmo do painel", () => {
  // Divergir aqui faria o card "Abordagens realizadas" e o estágio do contato
  // discordarem sobre o mesmo evento.
  const painel = readFileSync(
    "supabase/migrations/20260826140000_abordagem_realizada.sql",
    "utf8",
  );

  it("atividade: concluída", () => {
    expect(sql).toContain("completed_at IS NOT NULL");
    expect(painel).toContain("completed_at IS NOT NULL");
  });

  it("e-mail: enviado", () => {
    expect(sql).toContain("status = 'sent'");
    expect(painel).toContain("e.status = 'sent'");
  });

  it("whatsapp: aceito pela Meta", () => {
    expect(sql).toContain("IN ('sent', 'delivered', 'read')");
    expect(painel).toContain("IN ('sent', 'delivered', 'read')");
  });

  it("nota e tarefa não são abordagem", () => {
    expect(sql).toContain("IN ('call', 'email', 'meeting')");
    expect(sql).not.toMatch(/IN \('call', 'email', 'meeting', 'note'/);
  });

  it("só saída conta — quem escreve para nós não foi 'contatado' por nós", () => {
    expect(sql).toContain("direction = 'outbound'");
    expect(sql).not.toContain("direction = 'inbound'");
  });
});

describe("os triggers disparam no UPDATE, não só no INSERT", () => {
  /**
   * O e-mail não nasce enviado: gmail-send grava 'sending' para ter id de
   * rastreio e só depois promove para 'sent'. Um trigger só de INSERT nunca
   * veria um e-mail sair. Idem WhatsApp (nasce na tentativa) e atividade
   * (quase sempre criada agendada). Na prática o UPDATE é o caminho principal.
   */
  const tabelas = ["activities", "emails", "whatsapp_messages"];

  it.each(tabelas)("%s tem trigger de INSERT e UPDATE", (t) => {
    const re = new RegExp(`AFTER INSERT OR UPDATE OF [^\\n]*ON public\\.${t}`);
    expect(sql).toMatch(re);
  });

  it("o e-mail é observado pela coluna status", () => {
    expect(sql).toMatch(/AFTER INSERT OR UPDATE OF status[^\n]*ON public\.emails/);
  });
});

describe("quem já foi abordado sai da fila", () => {
  it("a migração inclui backfill", () => {
    // Sem ele os triggers só valem para o futuro, e todo lead já trabalhado
    // continuaria na fila -- fazendo a correção parecer não ter funcionado.
    expect(sql).toMatch(/UPDATE public\.contacts c[\s\S]*SET lifecycle_stage = 'contacted'/);
  });

  it("o backfill só avança, nunca rebaixa", () => {
    const bf = sql.slice(sql.indexOf("UPDATE public.contacts c"));
    expect(bf).toContain("c.lifecycle_stage = 'lead'");
  });

  it("os EXISTS têm índice por contact_id", () => {
    expect(sql).toContain("idx_emails_contact_direction");
    expect(sql).toContain("idx_whatsapp_messages_contact_direction");
    expect(sql).toContain("idx_activities_contact_completed");
  });

  /**
   * A ordem é o ponto: o backfill faz três EXISTS por contato. Se os índices
   * fossem criados depois dele, cada EXISTS viraria varredura completa das
   * tabelas de e-mail e de mensagem -- justamente as maiores. O SQL rodaria
   * igual, só levaria muito mais tempo, e ninguém ligaria a lentidão à ordem
   * de duas seções do arquivo.
   */
  it("os índices são criados ANTES do backfill", () => {
    expect(sql.indexOf("idx_emails_contact_direction"))
      .toBeLessThan(sql.indexOf("UPDATE public.contacts c"));
  });

  /**
   * A função move contatos de outros donos, contornando a RLS. Se estivesse
   * exposta, qualquer membro poderia chamá-la direto pela API e mexer no ciclo
   * de vida de leads que não são dele.
   */
  it("a função de promoção não fica exposta na API", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.promover_lead_para_contatado");
  });
});

describe("a lista de leads não tem teto silencioso", () => {
  const api = readFileSync("src/lib/api/contacts.ts", "utf8");

  it("listLeads pagina em blocos", () => {
    const bloco = api.slice(api.indexOf("listLeads:"), api.indexOf("updateLifecycleStage:"));
    expect(bloco).toContain(".range(");
    expect(bloco).toContain("CHUNK");
  });

  it("o selo do menu usa a mesma fonte da tela", () => {
    const barra = readFileSync("src/components/layout/AppSidebar.tsx", "utf8");
    expect(barra).toContain('.in("lifecycle_stage", LEAD_STAGES)');
    expect(barra).not.toMatch(/\.eq\("status",\s*"lead"\)/);
  });
});
