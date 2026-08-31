/**
 * Cadastra o WABA da organização: o id da conta e o token de sistema.
 *
 * Feito uma vez, pelo admin. Depois disso cada pessoa só escolhe o número dela
 * em "Meu WhatsApp" — ninguém mais precisa entrar no painel da Meta, e ninguém
 * precisa de acesso ao painel do Supabase. Era esse o gargalo do modelo antigo:
 * o WhatsAppOfficialCard mandava o dono salvar o token como secret do projeto.
 *
 * Segue validate-slack-webhook: testa a credencial DE VERDADE antes de gravar,
 * para o erro aparecer aqui e não no primeiro envio.
 *
 * O token vai para whatsapp_secrets — RLS habilitada e NENHUMA política, só
 * service_role alcança. E nunca volta na resposta: quem já cadastrou não
 * consegue reler o token nem por esta função.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolverProvedor } from "../_shared/whatsapp/index.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Token de verificação do webhook. A Meta só ecoa de volta, não precisa ser secreto. */
function tokenDeVerificacao(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ ok: false, error: "Não autenticado" }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ ok: false, error: "Não autenticado" }, 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: perfil } = await admin
      .from("profiles").select("org_id").eq("id", userData.user.id).maybeSingle();
    const orgId = perfil?.org_id;
    if (!orgId) return json({ ok: false, error: "Você não pertence a nenhuma organização" }, 403);

    // Consulta direta em vez da RPC is_org_admin, pelo mesmo motivo que o
    // validate-slack-webhook registra: aquela função não tem GRANT explícito em
    // migração nenhuma.
    const { data: papel } = await admin
      .from("user_roles").select("role")
      .eq("user_id", userData.user.id).eq("org_id", orgId).maybeSingle();

    if (papel?.role !== "owner" && papel?.role !== "admin") {
      return json({ ok: false, error: "Só administradores configuram o WhatsApp da empresa" }, 403);
    }

    const corpo = await req.json().catch(() => ({}));
    const { waba_id, access_token, provider, server_url, remover } = corpo as Record<string, unknown>;

    // ---------- Desligar ----------
    // O token é apagado e a conta fica inativa, mas as conexões das pessoas
    // PERMANECEM: apagá-las perderia quem reivindicou qual número, e reconectar
    // exigiria refazer tudo. Sem token o envio falha com mensagem clara, que é
    // recuperável; conexão perdida não é.
    if (remover) {
      await admin.from("whatsapp_secrets").delete().eq("org_id", orgId);
      await admin.from("whatsapp_business_accounts")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("org_id", orgId);
      return json({ ok: true, removido: true });
    }

    const prov = resolverProvedor(typeof provider === "string" ? provider : "meta");
    const daMeta = prov.nome === "meta";

    // Os dois provedores pedem coisas diferentes, e pedir a errada é o tipo de
    // erro que faz alguém procurar um "WABA ID" que não existe na Evolution.
    if (daMeta && (typeof waba_id !== "string" || !waba_id.trim())) {
      return json({ ok: false, error: "Informe o ID da conta WhatsApp Business (WABA)." }, 400);
    }
    if (!daMeta && (typeof server_url !== "string" || !server_url.trim())) {
      return json({ ok: false, error: "Informe a URL do servidor Evolution." }, 400);
    }
    if (typeof access_token !== "string" || !access_token.trim()) {
      return json({
        ok: false,
        error: daMeta ? "Informe o token de sistema." : "Informe a chave da API (apikey).",
      }, 400);
    }

    const cred = {
      provider: prov.nome,
      token: access_token.trim(),
      wabaId: daMeta ? (waba_id as string).trim() : null,
      serverUrl: daMeta ? null : (server_url as string).trim().replace(/\/+$/, ""),
    };

    // Validar ANTES de gravar. Credencial errada gravada é pior que recusada:
    // fica parecendo configurada e falha só quando alguém tenta enviar.
    const teste = await prov.verificarCredencial(cred);
    if (!teste.ok) {
      const quem = daMeta ? "A Meta" : "O servidor Evolution";
      return json({ ok: false, error: `${quem} recusou a credencial: ${teste.erro}` }, 400);
    }

    // Já traz os números, para o admin ver na hora que o cadastro pegou o WABA
    // certo — e para descobrir agora, não depois, que a conta está sem número.
    // Na Evolution a lista nasce VAZIA e isso é o esperado: as instâncias são
    // criadas depois, uma por pessoa, ao ler o QR. Falhar aqui por lista vazia
    // impediria o cadastro de existir antes do primeiro pareamento.
    let numeros: Awaited<ReturnType<typeof prov.listarNumeros>> = [];
    try {
      numeros = await prov.listarNumeros(cred);
    } catch (e) {
      // Na Meta, listagem que falha com credencial válida é quase sempre falta
      // da permissão whatsapp_business_management — vale recusar o cadastro e
      // dizer isso, porque sem ela ninguém consegue reivindicar número.
      if (daMeta) {
        return json({
          ok: false,
          error:
            "A credencial é válida, mas não consegui listar os números. " +
            "Confira se o token tem a permissão whatsapp_business_management. " +
            `Detalhe: ${e instanceof Error ? e.message : String(e)}`,
        }, 400);
      }
      // Na Evolution não: as instâncias são criadas depois, uma por pessoa, ao
      // ler o QR. Recusar aqui impediria o cadastro de existir antes do
      // primeiro pareamento — que é a ordem obrigatória do fluxo.
      console.error("whatsapp-waba-setup: listagem da Evolution falhou", e);
    }

    // Preserva o token de verificação já cadastrado: trocá-lo quebraria o
    // webhook que a Meta já validou, e a pessoa teria de reconfigurar lá.
    const { data: existente } = await admin
      .from("whatsapp_business_accounts")
      .select("id, webhook_verify_token")
      .eq("org_id", orgId)
      .maybeSingle();

    const verifyToken = existente?.webhook_verify_token || tokenDeVerificacao();

    const { error: erroConta } = await admin
      .from("whatsapp_business_accounts")
      .upsert({
        org_id: orgId,
        provider: prov.nome,
        waba_id: cred.wabaId,
        server_url: cred.serverUrl,
        webhook_verify_token: verifyToken,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "org_id" });
    if (erroConta) throw erroConta;

    const { error: erroSegredo } = await admin
      .from("whatsapp_secrets")
      .upsert({
        org_id: orgId,
        access_token: cred.token,
        updated_at: new Date().toISOString(),
      }, { onConflict: "org_id" });
    if (erroSegredo) throw erroSegredo;

    return json({
      ok: true,
      provider: prov.nome,
      forma_de_pareamento: prov.formaDePareamento,
      waba_id: cred.wabaId,
      server_url: cred.serverUrl,
      // O admin precisa deste valor para colar no painel da Meta. Não é segredo:
      // a Meta só o ecoa de volta no handshake.
      webhook_verify_token: verifyToken,
      webhook_url: `${url}/functions/v1/whatsapp-webhook`,
      // Só o que a tela precisa mostrar. O token NUNCA volta daqui.
      numeros: numeros.map((n) => ({
        id: n.id,
        telefone: n.telefone,
        nome: n.nomeVerificado,
        qualidade: n.qualidade,
      })),
    });
  } catch (e) {
    console.error("whatsapp-waba-setup", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
