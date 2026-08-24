import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolverCredencialGoogle, renovarAccessToken } from "../_shared/google-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Refresh com as MESMAS credenciais que emitiram o token (BYOK ou env)

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: cl } = await supabase.auth.getClaims(token);
    if (!cl?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = cl.claims.sub;

    const { message_id, attachment_id, mime_type } = await req.json();
    if (!message_id || !attachment_id) {
      return new Response(JSON.stringify({ error: "message_id and attachment_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: prof } = await supabaseAdmin.from("profiles").select("org_id").eq("id", userId).maybeSingle();
    const orgId = prof?.org_id;
    if (!orgId) {
      return new Response(JSON.stringify({ error: "No organization" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Credenciais BYOK da org (para refresh do token com o client correto)
    const { data: cfgRow } = await supabaseAdmin
      .from("integration_configs")
      .select("config")
      .eq("org_id", orgId)
      .eq("provider", "gmail")
      .maybeSingle();
    const cfg: Record<string, unknown> = (cfgRow?.config as Record<string, unknown>) ?? {};

    // O anexo pertence à conta que sincronizou a mensagem (synced_from) —
    // usa o token DAQUELA conta, não o mais recente
    const { data: emailRow } = await supabaseAdmin
      .from("emails")
      .select("synced_from")
      .eq("org_id", orgId)
      .eq("message_id", message_id)
      .limit(1)
      .maybeSingle();

    let tokenRow: any = null;
    if (emailRow?.synced_from) {
      const { data: t } = await supabaseAdmin
        .from("gmail_oauth_tokens")
        .select("*")
        .eq("org_id", orgId)
        .eq("email", emailRow.synced_from)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      tokenRow = t;
    }
    if (!tokenRow) {
      // fallback: qualquer token da org (mensagens antigas sem synced_from)
      const { data: anyTok } = await supabaseAdmin
        .from("gmail_oauth_tokens")
        .select("*")
        .eq("org_id", orgId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      tokenRow = anyTok;
    }

    if (!tokenRow) {
      return new Response(JSON.stringify({ error: "gmail_not_connected" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessToken = tokenRow.access_token as string;
    if (new Date(tokenRow.expires_at).getTime() - Date.now() < 60_000) {
      const cred = await resolverCredencialGoogle(supabaseAdmin, orgId);
      const renovado = await renovarAccessToken(tokenRow.refresh_token as string, cred);
      if (!renovado.ok) {
        return new Response(JSON.stringify({
          error: "gmail_conexao_invalida",
          reason: renovado.motivo,
          message: "A conexão do Gmail precisa ser renovada para baixar este anexo.",
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const refreshed = { access_token: renovado.accessToken, expires_in: renovado.expiraEm };
      accessToken = refreshed.access_token;
      await supabaseAdmin.from("gmail_oauth_tokens").update({
        access_token: accessToken,
        expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", tokenRow.id);
    }

    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message_id)}/attachments/${encodeURIComponent(attachment_id)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const data = await r.json();
    if (!r.ok) {
      return new Response(JSON.stringify({ error: "gmail_fetch_failed", details: data }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // base64url -> base64
    const b64url = (data.data || "") as string;
    const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    const dataUrl = `data:${mime_type || "application/octet-stream"};base64,${b64}`;

    return new Response(JSON.stringify({ ok: true, data_url: dataUrl, size: data.size }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("gmail-attachment error:", err);
    return new Response(JSON.stringify({ error: "internal_error", message: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
