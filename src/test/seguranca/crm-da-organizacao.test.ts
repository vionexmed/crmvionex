/**
 * Todo o CRM é da organização — e o que ficou fora disso.
 *
 * O defeito que isto tranca não aparece em captura de tela nenhuma: a lista de
 * Contatos abria certinha, com o número certo no topo -- só que o número era o
 * da carteira de quem estava olhando. Quem cadastrava um contato era a única
 * pessoa do time a enxergá-lo, e ninguém recebia erro, aviso ou lista vazia que
 * explicasse o porquê. O mesmo valia para negócio, atividade, e-mail e conversa.
 *
 * São DOIS lados, e o segundo é o que importa mais com o tempo: o que abriu, e
 * o que continua fechado. Informação de CRM abriu; credencial, não. Uma
 * abertura futura que passe por cima dessa linha reprova aqui.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** Comentário explica a armadilha; varredura que o lê reprova a explicação. */
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

const ler = (p: string) => semComentarios(readFileSync(p, "utf8"));

const ABERTURA = ler("supabase/migrations/20260909120000_contatos_da_organizacao.sql");
const RBAC = ler("supabase/migrations/20260702110000_rbac_comercial.sql");
const CRM = ler("supabase/migrations/20260909140000_crm_da_organizacao.sql");
const TEAM = readFileSync("src/pages/Team.tsx", "utf8");
const CONTATOS = readFileSync("src/pages/Contacts.tsx", "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/.*$/gm, "");

/**
 * Corpo de uma policy. Termina no `;` ou no `$sql$` que a fecha, o que vier
 * primeiro: a migração do CRM escreve cada comando dentro de `$sql$…$sql$`,
 * para passar por um guarda de existência de tabela antes de rodar.
 */
const policy = (sql: string, nome: string) => {
  const i = sql.indexOf(`CREATE POLICY "${nome}"`);
  expect(i, `policy ${nome} não encontrada`).toBeGreaterThan(-1);
  const fins = [sql.indexOf(";", i), sql.indexOf("$sql$", i)].filter((n) => n > -1);
  return sql.slice(i, Math.min(...fins));
};

describe("qualquer pessoa da organização vê e edita contato", () => {
  for (const acao of ["contacts_select", "contacts_insert", "contacts_update"]) {
    it(`${acao} não pergunta quem é o dono`, () => {
      const p = policy(ABERTURA, acao);
      expect(p).toContain("user_belongs_to_org(auth.uid(), org_id)");
      expect(p, "o recorte por carteira é justamente o que sai").not.toContain("owner_id");
      // `is_org_admin` aqui não estreitaria nada -- estaria num OR com uma
      // condição já verdadeira para todo mundo --, mas deixaria a policy
      // parecendo ter dois níveis de acesso onde só existe um.
      expect(p).not.toContain("is_org_admin");
    });
  }

  /**
   * A operação sem desfazer continua sendo de admin, e o CLAUDE.md registra o
   * porquê: apagar contato esbarra em negócio e atividade vinculados, e o
   * PostgREST não expõe transação -- os filhos vão primeiro, e se o pai falhar
   * sobra registro sem histórico.
   */
  it("excluir continua sendo de admin", () => {
    expect(ABERTURA, "abrir a leitura não é abrir a exclusão")
      .not.toContain('CREATE POLICY "contacts_delete"');
    expect(policy(RBAC, "contacts_delete")).toContain("is_org_admin(auth.uid(), org_id)");
  });
});

describe("o resto do CRM abriu junto", () => {
  /**
   * O UPDATE de negócio abre com o SELECT, e não é simetria: arrastar card no
   * kanban é UPDATE, e o PostgREST devolve linha recusada pela RLS como
   * sucesso. O card voltaria para a coluna de origem sem uma palavra.
   */
  for (const acao of [
    "deals_select", "deals_insert", "deals_update",
    "activities_select", "activities_insert", "activities_update",
    "emails_select", "whatsapp_messages_select", "instagram_messages_select",
    "sales_goals_select", "meta_insights_select", "lead_score_history_select",
  ]) {
    it(`${acao} é da organização`, () => {
      const p = policy(CRM, acao);
      expect(p).toContain("user_belongs_to_org(auth.uid(), org_id)");
      expect(p).not.toMatch(/owner_id\s*=\s*auth\.uid\(\)|user_id\s*=\s*auth\.uid\(\)/);
      expect(p).not.toContain("is_org_admin");
    });
  }

  /**
   * A tela de Atendimento lê a view `mensagens_do_atendimento`, e a view tem
   * `security_invoker = on` -- ela obedece à RLS das tabelas-base. Abrir as duas
   * tabelas de mensagem é o que faz a tela funcionar para quem não é admin, sem
   * tocar na view. Se alguém trocar o `security_invoker`, a view passa a rodar
   * com os direitos de quem a criou e vira vazamento entre organizações.
   */
  it("a tela de atendimento chega às mensagens pela RLS, não por cima dela", () => {
    const view = ler("supabase/migrations/20260901120000_canal_instagram.sql");
    expect(view).toContain("security_invoker = on");
    for (const t of ["whatsapp_messages", "instagram_messages"]) {
      expect(CRM).toContain(`CREATE POLICY "${t}_select" ON public.${t}`);
    }
  });

  /**
   * TODO comando passa por um guarda de existência. `whatsapp_conversations`
   * está na lista de tabelas do RBAC e NÃO EXISTE neste banco -- sem o guarda a
   * migração morre na primeira linha que a cita, e nenhuma das outras chega a
   * ser aplicada. Já aconteceu: foi assim que esta migração falhou na primeira
   * tentativa.
   */
  it("tabela ausente não derruba a migração inteira", () => {
    expect(CRM).toContain("to_regclass(alvo) IS NULL");
    expect(CRM).toContain("CONTINUE;");
    const criados = CRM.match(/CREATE POLICY "/g)?.length ?? 0;
    const guardados = CRM.match(/\$sql\$CREATE POLICY "/g)?.length ?? 0;
    expect(guardados, "toda policy tem de estar dentro do laço com guarda").toBe(criados);
  });

  /** O anexo segue a conversa: a fronteira passa a ser a organização, que é o
   *  primeiro segmento do caminho <org_id>/<contact_id>/<arquivo>. */
  it("a mídia da conversa acompanha, e a organização continua sendo o limite", () => {
    const p = policy(CRM, "whatsapp_media_select");
    expect(p).toContain("bucket_id = 'whatsapp-media'");
    expect(p).toContain("user_belongs_to_org");
    expect(p).not.toContain("c.owner_id = auth.uid()");
  });
});

describe("o que continua fechado, e é de propósito", () => {
  /**
   * A LINHA QUE NÃO PODE SER CRUZADA. Abrir o CRM é abrir informação; token,
   * chave e segredo não são informação de CRM -- são a chave da casa. O
   * repositório já tem teste dedicado a isso (credencial-fora-do-alcance), e
   * este aqui garante que a abertura não passou por cima dele.
   *
   * `whatsapp_config` está na lista por um motivo que não é óbvio pelo nome:
   * ela guarda `webhook_verify_token`.
   */
  const SEGREDOS = [
    "org_secrets", "api_keys", "integration_configs", "webhooks",
    "whatsapp_config", "whatsapp_instance_secrets", "instagram_app_secrets",
    "gmail_oauth_tokens", "google_oauth_tokens", "invitations",
  ];
  for (const t of SEGREDOS) {
    it(`${t} não é tocada pela abertura`, () => {
      expect(CRM, `${t} guarda credencial ou acesso, não informação`)
        .not.toContain(`ON public.${t}`);
    });
  }

  /**
   * Conexão é a PORTA; mensagem é a correspondência. As mensagens abriram; a
   * conta conectada, não -- ela carrega o vínculo com a credencial e é de quem
   * conectou.
   */
  it("a conta conectada continua de quem conectou", () => {
    for (const t of ["email_connections", "whatsapp_connections", "instagram_connections"]) {
      expect(CRM).not.toContain(`ON public.${t}`);
    }
  });

  /** Apagar segue sem desfazer, nas duas tabelas que têm filho vinculado. */
  it("excluir contato e negócio continua de admin", () => {
    expect(CRM).not.toContain('CREATE POLICY "deals_delete"');
    expect(CRM).not.toContain('CREATE POLICY "contacts_delete"');
    for (const acao of ["contacts_delete", "deals_delete"]) {
      expect(policy(RBAC, acao)).toContain("is_org_admin(auth.uid(), org_id)");
    }
  });

  /** Apagar atividade alheia sumiria com histórico que alimenta o painel. */
  it("apagar atividade continua de quem a registrou (ou admin)", () => {
    expect(CRM).not.toContain('CREATE POLICY "activities_delete"');
    expect(policy(RBAC, "activities_delete")).toMatch(/user_id = auth\.uid\(\)/);
  });
});

describe("o filtro conta o mesmo que a lista", () => {
  /**
   * `origens_de_contato` é SECURITY DEFINER por causa do corte em 1000 linhas
   * do PostgREST, e por isso repunha o recorte por carteira à mão. Mantê-lo
   * faria o filtro do topo oferecer "planilha X (3)" com 300 na lista abaixo.
   */
  it("origens_de_contato conta a organização inteira", () => {
    const i = ABERTURA.indexOf("FUNCTION public.origens_de_contato");
    expect(i).toBeGreaterThan(-1);
    const corpo = ABERTURA.slice(i);
    expect(corpo).toContain("FROM public.contacts c");
    expect(corpo, "o recorte à mão é o que sai daqui").not.toContain("c.owner_id = auth.uid()");
    // A checagem de organização fica: SECURITY DEFINER sem ela leria org alheia.
    expect(corpo).toContain("user_belongs_to_org(auth.uid(), _org_id)");
  });
});

describe("a tela de Equipe não contradiz o banco", () => {
  /**
   * A tabela de permissões é escrita à mão e não consulta o banco. Enquanto ela
   * disser "só os próprios", o administrador vai continuar procurando o
   * problema no lugar errado.
   */
  it("nenhuma linha sobre contato promete carteira", () => {
    const linhas = TEAM.match(/\{ label: "[^"]*[Cc]ontato[^"]*"[^}]*\}/g) ?? [];
    expect(linhas.length).toBeGreaterThan(0);
    for (const l of linhas) {
      const membro = l.match(/member: "([^"]*)"/)?.[1] ?? "";
      expect(membro, l).not.toMatch(/próprio/i);
    }
  });
});

describe("a tela devolve o que a abertura tirou", () => {
  /**
   * Antes, tudo que um comercial via já era dele -- responsável era informação
   * redundante, e por isso o filtro e a visão por vendedor eram de gestor.
   * Com 800 pessoas na lista, "quais são os meus?" passou a não ter resposta na
   * tela. Abrir a base sem abrir isto troca um problema por outro.
   */
  it("filtrar e ver por responsável não é mais só de admin", () => {
    expect(CONTATOS).not.toMatch(/viewMode === "owner" && isAdmin/);
    expect(CONTATOS).toMatch(/<Label className="text-xs">Responsável<\/Label>/);
    const i = CONTATOS.indexOf('<Label className="text-xs">Responsável</Label>');
    expect(CONTATOS.slice(Math.max(0, i - 200), i), "o filtro de responsável não pode voltar a ser de admin")
      .not.toMatch(/isAdmin && \($/m);
  });

  /** E o que NÃO afrouxou junto: exportar a base e excluir contato seguem de
   *  quem responde pela organização. */
  it("exportar e excluir continuam de admin", () => {
    expect(CONTATOS).toMatch(/isAdmin && \([\s\S]{0,300}exportCSV/);
    expect(CONTATOS).toMatch(/isAdmin && \([\s\S]{0,300}pedirExclusao/);
  });
});

describe("o painel mostra o desempenho de todos", () => {
  /**
   * Era a última coisa do CRM que dizia "somente administradores" com todas as
   * letras -- e dizia em DOIS lugares, o que é o motivo deste teste existir:
   * abrir só a tela deixaria a função recusando, e abrir só a função deixaria
   * o gráfico escondido. Quem tentasse consertar um lado veria o sintoma
   * continuar.
   *
   * Por que abrir não expõe nada: o gráfico soma abordagem, reunião e venda por
   * pessoa, e cada evento que compõe esses números já está à vista da equipe
   * desde que atividade, e-mail e conversa passaram a ser da organização.
   */
  it("sdr_by_owner não recusa mais quem não é admin", () => {
    const i = CRM.indexOf("FUNCTION public.sdr_by_owner");
    const corpo = CRM.slice(i, CRM.indexOf("$$;", i));
    expect(corpo).not.toContain("Somente administradores");
    expect(corpo).not.toContain("is_org_admin");
    // A checagem de organização fica: SECURITY DEFINER sem ela leria org alheia.
    expect(corpo).toContain("user_belongs_to_org");
  });

  it("a tela não esconde o gráfico de quem não é admin", () => {
    const painel = readFileSync("src/components/dashboard/SdrChartsPanel.tsx", "utf8")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(painel).toContain("GraficoPessoas");
    expect(painel).not.toContain("isAdmin");

    const hook = readFileSync("src/hooks/useSdrCharts.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(hook, "a consulta não pode voltar a ser condicional")
      .not.toMatch(/isAdmin \?[\s\S]{0,80}sdr_by_owner/);
  });
});

describe("saber que o canal existe não é ler a credencial", () => {
  const CONVERSAS = readFileSync("src/pages/Conversations.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  /**
   * `whatsapp_config` guarda `webhook_verify_token`. A tela consultava a tabela
   * só para saber se o canal existe -- e como ela é de admin, quem era Comercial
   * recebia vazio e via "WhatsApp ainda não está conectado", com link para uma
   * página de administrador. Mentira, e sem saída.
   *
   * A resposta veio de uma função que devolve DOIS BOOLEANOS. Não dá para
   * extrair segredo de um `true`, e a tabela continua fechada.
   */
  it("a tela não lê mais a tabela de configuração", () => {
    expect(CONVERSAS).not.toMatch(/from\("whatsapp_config"\)/);
    expect(CONVERSAS).toContain('rpc("canais_do_atendimento"');
  });

  it("a função devolve só booleanos, e checa a organização", () => {
    const i = CRM.indexOf("FUNCTION public.canais_do_atendimento");
    expect(i).toBeGreaterThan(-1);
    const corpo = CRM.slice(i, CRM.indexOf("$$;", i));
    expect(corpo).toContain("RETURNS TABLE (whatsapp boolean, instagram boolean)");
    expect(corpo, "SECURITY DEFINER sem checagem lê org alheia")
      .toContain("user_belongs_to_org(auth.uid(), _org_id)");
    expect(corpo, "nenhuma coluna de configuração pode sair daqui")
      .not.toMatch(/webhook_verify_token|phone_number_id|waba_id|access_token/);
  });
});
