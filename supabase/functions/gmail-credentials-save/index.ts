/**
 * Cadastra a credencial OAuth do Google pelo CRM.
 *
 * O valor vai para google_oauth_secrets — RLS ligada e ZERO policies, só
 * service_role alcança. Isso é o que permite cadastrar pela tela SEM que o
 * segredo volte para o navegador, que era o dilema do formulário antigo: ele
 * gravava em integration_configs, tabela que o admin lê pelo front.
 *
 * Nunca devolve o client_secret. Nem para quem acabou de salvá-lo.
 *
 * Valida contra o Google ANTES de gravar, no padrão de validate-slack-webhook:
 * credencial errada gravada é pior que recusada, porque fica parecendo
 * configurada e só falha quando a primeira pessoa tenta conectar.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolverCredencialGoogle,
  validarCredencialGoogle,
} from "../_shared/google-credentials.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Não autenticado" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ ok: false, error: "Não autenticado" }, 401);
    const userId = userData.user.id;

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: perfil } = await admin
      .from("profiles").select("org_id").eq("id", userId).maybeSingle();
    const orgId = perfil?.org_id as string | undefined;
    if (!orgId) return json({ ok: false, error: "Você não pertence a nenhuma organização" }, 403);

    // Consulta direta em vez da RPC is_org_admin, pelo mesmo motivo registrado
    // em validate-slack-webhook: aquela função não tem GRANT explícito em
    // migração nenhuma.
    const { data: papel } = await admin
      .from("user_roles").select("role").eq("user_id", userId).eq("org_id", orgId).maybeSingle();

    if (papel?.role !== "owner" && papel?.role !== "admin") {
      return json({ ok: false, error: "Só administradores cadastram a credencial do Google" }, 403);
    }

    const corpo = await req.json().catch(() => ({}));
    const { client_id, client_secret, remover } = corpo as Record<string, unknown>;

    // Quantas contas dependem da credencial hoje. Usado para avisar antes e para
    // relatar depois.
    const { count: conectadas } = await admin
      .from("email_connections")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("provider", "gmail")
      .eq("is_active", true);

    // ---------- Remover ----------
    // Volta a valer o que estiver no ambiente. Não invalida conexão: se o
    // ambiente tiver a mesma credencial, nada quebra — e se tiver outra, a
    // próxima renovação marca o motivo sozinha.
    if (remover) {
      await admin.from("google_oauth_secrets").delete().eq("org_id", orgId);
      const depois = await resolverCredencialGoogle(admin, orgId);
      return json({ ok: true, removido: true, origem: depois.origem });
    }

    const novoId = typeof client_id === "string" ? client_id.trim() : "";
    const novoSecret = typeof client_secret === "string" ? client_secret.trim() : "";

    if (!novoId || !novoSecret) {
      return json({ ok: false, error: "Informe o Client ID e o Client Secret." }, 400);
    }
    if (!novoId.endsWith(".apps.googleusercontent.com")) {
      return json({
        ok: false,
        error: "O Client ID do Google termina em .apps.googleusercontent.com. Confira se não trocou os dois campos.",
      }, 400);
    }

    // Validar ANTES de gravar.
    const teste = await validarCredencialGoogle(novoId, novoSecret);
    if (!teste.ok) return json({ ok: false, error: teste.erro }, 400);

    // A credencial ATUAL, antes de trocar. Se for idêntica, não faz sentido
    // mandar todo mundo reconectar — salvar o mesmo valor não invalida token.
    const atual = await resolverCredencialGoogle(admin, orgId);
    const mudou = atual.clientId !== novoId || atual.clientSecret !== novoSecret;

    const { error: erroGravar } = await admin
      .from("google_oauth_secrets")
      .upsert({
        org_id: orgId,
        client_id: novoId,
        client_secret: novoSecret,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      }, { onConflict: "org_id" });
    if (erroGravar) throw erroGravar;

    // Trocar a credencial invalida todo refresh token já emitido: o Google exige
    // que a renovação use as mesmas credenciais que emitiram. Marcar AGORA faz o
    // motivo existir antes da primeira falha — senão a conexão morre em silêncio
    // e a pessoa descobre quando um e-mail não sai.
    let invalidadas = 0;
    if (mudou && (conectadas ?? 0) > 0) {
      const { data } = await admin.rpc("gmail_invalidar_conexoes", {
        _org_id: orgId,
        _motivo: "credenciais_trocadas",
      });
      invalidadas = Number(data ?? 0);
    }

    return json({
      ok: true,
      // Só o client_id volta, e ele é público. O segredo não.
      client_id: novoId,
      origem: "crm",
      credencial_mudou: mudou,
      conexoes_invalidadas: invalidadas,
    });
  } catch (e) {
    console.error("gmail-credentials-save", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
