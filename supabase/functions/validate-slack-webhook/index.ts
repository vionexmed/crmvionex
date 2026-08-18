/**
 * Valida e guarda o Incoming Webhook do Slack.
 *
 * Segue o padrão de validate-resend-key: testa a credencial de verdade antes de
 * gravar, para o dono descobrir o erro aqui e não às 20h de um dia qualquer.
 *
 * A URL vai para `org_secrets`, que tem RLS habilitada e NENHUMA política — só
 * service_role a alcança. Uma URL de webhook é credencial: quem a tem posta no
 * canal da empresa. Por isso não pode ficar em `integration_configs`, que os
 * membros leem.
 *
 * Diferença deliberada em relação ao validate-resend-key: aqui exige
 * ADMINISTRADOR, não apenas usuário autenticado. Aquele conferia só a sessão, o
 * que deixava qualquer membro trocar a credencial de envio da empresa.
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

    const { webhook_url, channel, stale_days, remover } = await req.json();

    // Desligar: apaga o segredo e encerra. Sem webhook, o cron vira no-op.
    if (remover) {
      await admin.from("org_secrets").delete()
        .eq("org_id", orgId).eq("key_name", "slack_webhook_url");
      return json({ ok: true, removido: true });
    }

    if (typeof webhook_url !== "string" || !webhook_url.startsWith("https://hooks.slack.com/")) {
      return json({
        ok: false,
        error: "A URL precisa começar com https://hooks.slack.com/ — copie do Slack em Apps → Incoming Webhooks.",
      }, 400);
    }

    // Testa de verdade. O Slack responde "ok" em texto puro, não JSON.
    const teste = await fetch(webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: ":white_check_mark: VIONEX conectado. O resumo do dia chega aqui às 20h.",
      }),
    });

    const resposta = await teste.text();
    if (!teste.ok) {
      const dica = teste.status === 404
        ? "Webhook não encontrado — pode ter sido revogado no Slack."
        : resposta.slice(0, 120);
      return json({ ok: false, error: `O Slack recusou: ${dica}` }, 400);
    }

    await admin.from("org_secrets").upsert(
      { org_id: orgId, key_name: "slack_webhook_url", key_value: webhook_url },
      { onConflict: "org_id,key_name" },
    );

    const { data: existente } = await admin
      .from("integration_configs").select("id, config")
      .eq("org_id", orgId).eq("provider", "slack").maybeSingle();

    // O que não é segredo fica aqui, legível pelos membros.
    const config = {
      ...((existente?.config ?? {}) as Record<string, unknown>),
      channel: channel || "",
      stale_days: Number(stale_days) > 0 ? Number(stale_days) : 7,
      daily_summary: true,
      webhook_configurado: true,
    };

    if (existente) {
      await admin.from("integration_configs")
        .update({ config, is_active: true }).eq("id", existente.id);
    } else {
      await admin.from("integration_configs").insert({
        org_id: orgId, provider: "slack", config, is_active: true,
        connected_by: userData.user.id, connected_at: new Date().toISOString(),
      });
    }

    return json({ ok: true, testado: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ level: "error", function: "validate-slack-webhook", error: msg }));
    return json({ ok: false, error: msg }, 500);
  }
});
