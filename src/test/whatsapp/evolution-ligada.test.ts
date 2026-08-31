/**
 * A Evolution ligada de ponta a ponta.
 *
 * O contrato de provedor existia desde antes, mas NADA em produção passava por
 * ele: `whatsapp-send` cravava a Graph API, lia a tabela antiga
 * `whatsapp_config` e pegava o token do ambiente, e `whatsapp-webhook` tinha o
 * formato da Meta inline. Duas pilhas paralelas, e a ligada era a antiga —
 * implementar `evolution.ts` sozinho teria produzido código que ninguém alcança.
 *
 * Estes testes leem código porque é o que dá para verificar sem um servidor
 * Evolution de pé. Eles travam a FIAÇÃO; o comportamento do provedor está em
 * provedor.test.ts, que exercita funções de verdade.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ler = (f: string) => readFileSync(f, "utf8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const FN = "supabase/functions";

describe("o envio passa pelo provedor", () => {
  const src = semComentarios(ler(`${FN}/whatsapp-send/index.ts`));

  it("resolve o provedor em vez de cravar a Meta", () => {
    expect(src).toContain("resolverProvedor");
    expect(src).toContain("carregarCredencial");
  });

  it("usa a conexão da pessoa", () => {
    expect(src).toMatch(/from\("whatsapp_connections"\)/);
  });

  /**
   * O caminho legado é intencional e precisa CONTINUAR existindo até toda
   * organização migrar: quem usa a Meta hoje não tem linha em
   * whatsapp_connections, e exigi-la derrubaria o envio dessas empresas no
   * deploy. O teste existe para que ninguém o apague por engano.
   */
  it("o caminho legado da Meta continua, para não quebrar quem não migrou", () => {
    expect(src).toMatch(/from\("whatsapp_config"\)/);
    expect(src).toContain("META_WHATSAPP_TOKEN");
  });

  it("grava quem enviou e por qual conexão", () => {
    // Sem isso o painel não sabe atribuir a abordagem a ninguém.
    expect(src).toContain("user_id: userId");
    expect(src).toContain("connection_id: conexao.id");
  });
});

describe("o webhook atende os dois, e nenhum dos dois sem credencial", () => {
  const src = semComentarios(ler(`${FN}/whatsapp-webhook/index.ts`));

  it("o parse saiu de dentro da função", () => {
    expect(src).toContain("prov.lerWebhook");
    // O formato da Meta não pode voltar a estar inline aqui.
    expect(src).not.toMatch(/value\.messages/);
    expect(src).not.toMatch(/entry\s*\|\|\s*\[\]/);
  });

  /**
   * A guarda que fecha o desvio: sem ela, quem descobrisse o token de
   * verificação de uma conta Meta poderia mandar POST com `?token=` e pular a
   * assinatura HMAC inteira — injetando mensagem falsa no CRM.
   */
  it("o token na URL só vale para conta Evolution", () => {
    expect(src).toMatch(/!==\s*"evolution"/);
  });

  it("sem META_APP_SECRET, recusa em vez de processar", () => {
    // Falha FECHADA. Antes isto só avisava e seguia, o que deixava qualquer
    // pessoa na internet criar contato e conversa.
    expect(src).toContain("META_APP_SECRET");
    expect(src).toMatch(/503/);
  });

  it("compara a assinatura em tempo constante", () => {
    expect(src).toMatch(/diff \|=/);
  });

  it("resolve a conexão por instance_name na Evolution", () => {
    expect(src).toMatch(/"instance_name"\s*:\s*"phone_number_id"/);
  });

  /**
   * Mensagem de instância de OUTRA organização, chegando com o token desta,
   * entraria na empresa errada. É o pior defeito possível num sistema
   * multiempresa: dado de um cliente aparecendo no CRM de outro.
   */
  it("recusa evento cuja conexão é de outra organização", () => {
    expect(src).toMatch(/orgDoToken && conexao\.org_id !== orgDoToken/);
  });

  it("cria contato por lifecycle_stage, nunca por status", () => {
    // A armadilha do CLAUDE.md: no INSERT o status legado manda sobre o
    // lifecycle_stage, então escrever status é como o contato nasce no estágio
    // errado e some da tela de Leads.
    expect(src).toContain('lifecycle_stage: "lead"');
    expect(src).not.toMatch(/status:\s*["']lead["']/);
  });
});

describe("o pareamento por QR", () => {
  const src = semComentarios(ler(`${FN}/whatsapp-pair/index.ts`));

  /**
   * Nome determinístico. Se fosse aleatório, fechar a tela e voltar criaria uma
   * segunda instância: o aparelho seguiria pareado à primeira e o QR novo nunca
   * conectaria, com a tela dizendo "aguardando" para sempre.
   */
  it("o nome da instância sai do par organização + pessoa", () => {
    expect(src).toContain("function nomeDaInstancia");
    expect(src).toMatch(/vionex-\$\{oito\(orgId\)\}-\$\{oito\(userId\)\}/);
  });

  it("recusa quando o provedor da empresa não parea por QR", () => {
    expect(src).toMatch(/formaDePareamento !== "qrcode"/);
  });

  it("aponta o webhook com o token da organização", () => {
    expect(src).toContain("apontarWebhook");
    expect(src).toContain("token=${encodeURIComponent(credencial.verifyToken)}");
  });

  /**
   * `consultar` é chamado em intervalo enquanto o QR está na tela. Um insert
   * simples bateria no índice único no segundo retorno "conectado" e a pessoa
   * veria erro DEPOIS de ter dado certo.
   */
  it("consultar repetido não quebra no índice único", () => {
    expect(src).toMatch(/if \(existente\)/);
    expect(src).toContain("23505");
  });
});

describe("desconectar derruba a instância no servidor", () => {
  const src = semComentarios(ler(`${FN}/whatsapp-disconnect/index.ts`));

  /**
   * Só desativar a linha deixaria o aparelho pareado: o próximo pareamento
   * encontraria a instância conectada e voltaria "conectado" na hora, sem QR —
   * e o botão pareceria não funcionar.
   */
  it("chama encerrarInstancia antes de desativar", () => {
    expect(src).toContain("encerrarInstancia");
    expect(src.indexOf("encerrarInstancia")).toBeLessThan(src.indexOf("is_active: false"));
  });

  it("falha do provedor não impede a desativação", () => {
    // Instância órfã no servidor é recuperável; linha que não desativa prende a
    // pessoa a um número que ela não usa mais.
    expect(src).toContain("avisoProvedor");
  });
});

describe("o cadastro do servidor não pede o que não existe", () => {
  const src = semComentarios(ler(`${FN}/whatsapp-waba-setup/index.ts`));

  it("WABA só para a Meta, server_url só para a Evolution", () => {
    expect(src).toMatch(/daMeta && \(typeof waba_id/);
    expect(src).toMatch(/!daMeta && \(typeof server_url/);
  });

  it("grava a URL do servidor", () => {
    expect(src).toContain("server_url: cred.serverUrl");
  });

  /**
   * Na Evolution a lista de instâncias nasce vazia — elas são criadas depois,
   * uma por pessoa. Recusar o cadastro por isso impediria o primeiro
   * pareamento, que só pode acontecer DEPOIS do cadastro.
   */
  it("lista vazia não impede o cadastro da Evolution", () => {
    expect(src).toMatch(/if \(daMeta\) \{[\s\S]{0,400}whatsapp_business_management/);
  });
});

describe("os dois cartões não aparecem juntos", () => {
  /**
   * Oferecer os dois caminhos depois de a empresa ter escolhido um é convite
   * para alguém configurar os dois e não saber por qual as mensagens saem.
   */
  it("o cartão da Meta some quando a empresa está na Evolution", () => {
    const src = semComentarios(ler("src/components/crm/WhatsAppOfficialCard.tsx"));
    expect(src).toMatch(/if \(outroProvedor\) return null;/);
  });

  it("o cartão da Evolution some quando a empresa está na Meta", () => {
    const src = semComentarios(ler("src/components/crm/WhatsAppEvolutionCard.tsx"));
    expect(src).toMatch(/conta\.provider !== "evolution"\) return null/);
  });

  it("o QR tem fundo branco fixo", () => {
    // Preto sobre transparente vira preto sobre preto no tema escuro, e a
    // câmera não lê.
    const src = ler("src/components/crm/WhatsAppEvolutionCard.tsx");
    expect(src).toMatch(/bg-white/);
  });

  it("a tela para o relógio ao desmontar", () => {
    // setInterval órfão seguiria batendo no servidor Evolution até a aba fechar.
    const src = semComentarios(ler("src/components/crm/WhatsAppEvolutionCard.tsx"));
    expect(src).toMatch(/useEffect\(\(\) => pararRelogio, \[pararRelogio\]\)/);
  });
});

describe("o erro de envio diz o que fazer", () => {
  const src = semComentarios(ler(`${FN}/_shared/whatsapp/evolution.ts`));

  /**
   * MEDIDO contra a v2.3.7 rodando em Docker: enviar por uma instância sem
   * sessão pareada devolve HTTP 500 com
   * `{"response":{"message":"Cannot read properties of undefined (reading
   * 'find')"}}` -- um crash interno do Baileys. Quem visse isso na tela não
   * teria como saber que só precisa reler o QR code.
   */
  it("consulta o estado quando o envio falha", () => {
    expect(src).toContain("explicarFalhaDeEnvio");
    expect(src).toMatch(/instance\/connectionState/);
  });

  it("a consulta extra roda SÓ na falha", () => {
    // Checar antes de cada envio custaria uma ida ao servidor por mensagem.
    const iFalha = src.indexOf("if (!r.ok)");
    const iChamada = src.indexOf("explicarFalhaDeEnvio(cred");
    expect(iFalha).toBeGreaterThan(-1);
    expect(iChamada).toBeGreaterThan(iFalha);
  });

  it("404 e desconectado têm mensagens diferentes", () => {
    expect(src).toMatch(/não está mais pareado/);
    expect(src).toMatch(/Leia o QR code de novo/);
  });
});

describe("existe como provar o provedor contra um servidor real", () => {
  /**
   * `evolution.ts` foi escrito contra a documentação. Teste de unidade não
   * cobre o que pode estar errado -- nome de rota, forma do corpo, onde o QR vem
   * embrulhado -- e um mock só confirmaria as minhas próprias suposições.
   *
   * O script fica FORA de `npm test` de propósito: a suíte não pode depender de
   * Docker.
   */
  it("o script existe e não entra na suíte", () => {
    const script = readFileSync("scripts/provar-evolution.mjs", "utf8");
    expect(script).toContain("provedorEvolution");
    expect(script).toContain("iniciarPareamento");
    expect(script).toContain("encerrarInstancia");
  });

  it("aponta para outro servidor por variável de ambiente", () => {
    const script = readFileSync("scripts/provar-evolution.mjs", "utf8");
    expect(script).toMatch(/process\.env\.EVO_URL/);
    expect(script).toMatch(/process\.env\.EVO_KEY/);
  });
});
