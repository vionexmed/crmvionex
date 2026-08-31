/**
 * Cadastra o que o Google Ads precisa e o navegador não pode ver.
 *
 * Duas coisas vão para `google_oauth_secrets`, que tem RLS ligada SEM policy —
 * só service_role lê:
 *
 *   ads_developer_token   dá acesso à API em nome da empresa
 *   (o refresh token entra pelo callback do OAuth, não por aqui)
 *
 * E uma vai para `google_ads_accounts`, que é legível pelo admin: o ID da conta
 * de anúncio não é segredo — é um identificador que aparece no painel do Google.
 *
 * Por que edge function e não gravar da tela: `integration_configs` tem policy
 * `FOR ALL USING (user_belongs_to_org)`, então QUALQUER membro leria o developer
 * token pelo navegador. É o defeito que já existe no cartão do Meta Ads.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Só dígitos: o painel do Google mostra "123-456-7890" e a API recusa hífens. */
const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Não autenticado" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ ok: false, error: "Não autenticado" }, 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: perfil } = await admin
      .from("profiles").select("org_id").eq("id", userData.user.id).maybeSingle();
    const orgId = perfil?.org_id;
    if (!orgId) return json({ ok: false, error: "Você não pertence a nenhuma organização" }, 403);

    // Configurar anúncio da empresa é ato de administrador: envolve segredo que
    // gasta dinheiro.
    const { data: papel } = await admin
      .from("user_roles").select("role")
      .eq("user_id", userData.user.id).eq("org_id", orgId).maybeSingle();
    if (papel?.role !== "owner" && papel?.role !== "admin") {
      return json({ ok: false, error: "Só administradores configuram o Google Ads da empresa" }, 403);
    }

    const corpo = await req.json().catch(() => ({}));
    const { developer_token, customer_id, login_customer_id, remover } = corpo as Record<string, unknown>;

    // ---------- desligar ----------
    if (remover) {
      // O developer token sai; a CONTA fica inativa mas não é apagada, e as
      // métricas já sincronizadas permanecem. Mesmo princípio do WhatsApp:
      // desligar não pode apagar histórico.
      await admin.from("google_oauth_secrets")
        .update({ ads_developer_token: null, ads_refresh_token: null, updated_at: new Date().toISOString() })
        .eq("org_id", orgId);
      await admin.from("google_ads_accounts")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("org_id", orgId);
      return json({ ok: true, removido: true });
    }

    const conta = soDigitos(customer_id);
    if (conta.length < 8) {
      return json({
        ok: false,
        error: "O ID da conta de anúncio tem 10 dígitos e aparece no topo do painel do Google Ads (ex.: 123-456-7890).",
      }, 400);
    }
    if (typeof developer_token !== "string" || !developer_token.trim()) {
      return json({
        ok: false,
        error: "Informe o developer token. Ele é obtido no API Center de uma conta gerenciadora (MCC) e passa por aprovação do Google.",
      }, 400);
    }

    // Precisa existir linha em google_oauth_secrets para o UPDATE pegar: quem
    // nunca cadastrou o client_id do Google cai aqui, e a mensagem diz a ordem.
    const { data: existe } = await admin
      .from("google_oauth_secrets").select("id, client_id").eq("org_id", orgId).maybeSingle();
    if (!existe?.client_id) {
      return json({
        ok: false,
        error: "Cadastre primeiro o Client ID e o Client Secret do Google, no cartão de credenciais OAuth.",
      }, 400);
    }

    const { error: erroSeg } = await admin.from("google_oauth_secrets")
      .update({ ads_developer_token: developer_token.trim(), updated_at: new Date().toISOString() })
      .eq("org_id", orgId);
    if (erroSeg) throw erroSeg;

    // Uma conta ativa por organização: desativa a anterior antes de gravar,
    // senão o índice único parcial recusa a segunda.
    await admin.from("google_ads_accounts")
      .update({ is_active: false }).eq("org_id", orgId).eq("is_active", true).neq("customer_id", conta);

    const { data: gravada, error: erroConta } = await admin.from("google_ads_accounts")
      .upsert({
        org_id: orgId,
        customer_id: conta,
        login_customer_id: soDigitos(login_customer_id) || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "customer_id" })
      .select("id, customer_id, login_customer_id")
      .single();
    if (erroConta) throw erroConta;

    return json({
      ok: true,
      conta: gravada,
      // O token NUNCA volta daqui.
      autorizacao_pendente: true,
    });
  } catch (e) {
    console.error("google-ads-config", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
