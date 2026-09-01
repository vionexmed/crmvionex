/**
 * Valida e guarda o token de acesso do Meta Ads.
 *
 * Mesmo padrão de validate-slack-webhook: testa a credencial CONTRA O PROVEDOR
 * antes de gravar, para o dono descobrir o erro aqui — e não na primeira
 * sincronização, quando já ninguém lembra o que digitou.
 *
 * O token vai para `org_secrets`, que tem RLS habilitada e NENHUMA política: só
 * service_role a alcança. Ele NÃO pode ficar em `integration_configs`, onde
 * estava: aquela tabela é lida por qualquer membro da organização, então o
 * token de anúncio da empresa ficava visível para o time inteiro. É o mesmo
 * defeito que tirou o token do WhatsApp de lá.
 *
 * POR ORGANIZAÇÃO, e não num secret do projeto. `meta-ads-sync` lia
 * `Deno.env.get('META_ACCESS_TOKEN')` — um valor só para o Supabase inteiro —
 * enquanto o formulário do CRM gravava em outro lugar. Duas consequências: o
 * campo do formulário não fazia nada, e duas organizações teriam de dividir a
 * mesma conta de anúncio.
 *
 * Exige ADMINISTRADOR, não só sessão: trocar a credencial de anúncio da empresa
 * não é ação de membro comum.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Consulta direta em vez de RPC para is_org_admin: aquela função não tem
    // GRANT explícito em migração nenhuma, então depender dela é depender de
    // estado de permissão que ninguém declarou.
    const { data: papel } = await admin
      .from("user_roles").select("role")
      .eq("user_id", userData.user.id).eq("org_id", orgId).maybeSingle();

    if (papel?.role !== "owner" && papel?.role !== "admin") {
      return json({ ok: false, error: "Só administradores configuram integrações" }, 403);
    }

    const { access_token, ad_account_id, remover } = await req.json();

    // Desligar: apaga o segredo e encerra. Sem token, o sync vira no-op.
    if (remover) {
      await admin.from("org_secrets").delete()
        .eq("org_id", orgId).eq("key_name", "meta_access_token");
      return json({ ok: true, removido: true });
    }

    const token = typeof access_token === "string" ? access_token.trim() : "";
    if (!token) return json({ ok: false, error: "Cole o token de acesso do Meta." }, 400);

    /*
      TESTA CONTRA A GRAPH API antes de gravar.

      Um token do Meta expira, é revogado, ou vem sem a permissão
      `ads_read` — e nenhum desses casos se distingue olhando a string. Sem este
      passo, o erro só apareceria na sincronização, com uma mensagem da Meta que
      não diz o que fazer.

      `/me/adaccounts` é a chamada certa para conferir: ela exige exatamente a
      permissão que o sync usa, então passar aqui significa que o sync funciona.
    */
    const teste = await fetch(
      `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name&limit=1&access_token=${encodeURIComponent(token)}`,
    );
    const corpo = await teste.json().catch(() => null);

    if (!teste.ok || corpo?.error) {
      const motivo = corpo?.error?.message || `A Meta respondeu ${teste.status}`;
      return json({ ok: false, error: `A Meta recusou o token: ${motivo}` }, 400);
    }

    const contas = Array.isArray(corpo?.data) ? corpo.data.length : 0;
    if (contas === 0) {
      return json({
        ok: false,
        error: "O token é válido, mas não enxerga nenhuma conta de anúncio. Confira se ele foi gerado com a permissão ads_read e no Business certo.",
      }, 400);
    }

    await admin.from("org_secrets").upsert(
      { org_id: orgId, key_name: "meta_access_token", key_value: token },
      { onConflict: "org_id,key_name" },
    );

    // O que NÃO é segredo continua em integration_configs, legível pelos
    // membros: o id da conta identifica, não autentica.
    const { data: existente } = await admin
      .from("integration_configs").select("id, config")
      .eq("org_id", orgId).eq("provider", "meta").maybeSingle();

    const config = {
      ...((existente?.config ?? {}) as Record<string, unknown>),
      ad_account_id: typeof ad_account_id === "string" ? ad_account_id.trim() : undefined,
    };
    // O token nunca volta para cá, nem por acidente de spread do que já existia.
    delete (config as Record<string, unknown>).access_token;

    if (existente?.id) {
      await admin.from("integration_configs")
        .update({ config, is_active: true }).eq("id", existente.id);
    } else {
      await admin.from("integration_configs").insert({
        org_id: orgId, provider: "meta", config, is_active: true,
        connected_by: userData.user.id,
      });
    }

    return json({ ok: true, contas });
  } catch (e) {
    console.error("meta-ads-save", e);
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
