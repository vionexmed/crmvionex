import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { signState } from "../_shared/oauth-state.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// gmail.readonly foi removido: é redundante com gmail.modify, que já inclui
// leitura. Pedir os dois não muda nada na verificação e aumenta o que o usuário
// vê na tela de consentimento sem motivo.
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims } = await supabase.auth.getClaims(token);
    if (!claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub;

    const { return_to, label, purpose, scope_type } = await req.json().catch(() => ({}));

    // 'user' = caixa pessoal de quem chamou; 'org' = caixa compartilhada.
    const scopeType = scope_type === "org" ? "org" : "user";

    // Derive org_id server-side from authenticated profile (never trust client)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: callerProfile } = await supabaseAdmin
      .from("profiles").select("org_id").eq("id", userId).maybeSingle();
    const org_id = callerProfile?.org_id;
    if (!org_id) {
      return new Response(JSON.stringify({ error: "No organization" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Conectar a caixa da EMPRESA exige owner/admin. Antes não havia checagem de
    // papel nenhuma aqui: a proteção era só o RequireAdmin do front, então
    // qualquer membro podia chamar a função direto e tomar o slot da empresa.
    if (scopeType === "org") {
      const { data: isAdmin } = await supabaseAdmin.rpc("is_org_admin", {
        _user_id: userId,
        _org_id: org_id,
      });
      if (!isAdmin) {
        return new Response(
          JSON.stringify({ error: "Só owner ou admin pode conectar a caixa da empresa." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Prefer per-org credentials saved in integration_configs, fallback to env secret
    const { data: cfgRow } = await supabaseAdmin
      .from("integration_configs")
      .select("config")
      .eq("org_id", org_id)
      .eq("provider", "gmail")
      .maybeSingle();
    const cfg: any = cfgRow?.config ?? {};
    const clientId = cfg.client_id || Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
    if (!clientId) {
      return new Response(JSON.stringify({ error: "Google OAuth Client ID não configurado. Adicione em Integrações > Gmail." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const redirectUri = `${supabaseUrl}/functions/v1/gmail-oauth-callback`;

    // Assinado com HMAC e com expiração conferida no callback.
    const state = await signState({
      user_id: userId,
      org_id,
      return_to: return_to || (scopeType === "user" ? "/settings/email" : "/settings/integrations"),
      label: label || "Principal",
      purpose: purpose || "sales",
      scope_type: scopeType,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
      state,
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return new Response(JSON.stringify({ url, redirect_uri: redirectUri }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
