import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Antes: esta função lia org_id do CORPO, sem nenhum header de autorização,
    // e escrevia em integration_configs com service role. Qualquer um com a URL
    // marcava a integração de qualquer organização como conectada.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims } = await supabaseAuth.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    const userId = claims?.claims?.sub;
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { from_name, signature } = await req.json();

    // org_id vem do perfil autenticado, nunca do corpo da requisição.
    const supabaseOrg = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: callerProfile } = await supabaseOrg
      .from("profiles").select("org_id").eq("id", userId).maybeSingle();
    const org_id = callerProfile?.org_id;
    if (!org_id) {
      return new Response(JSON.stringify({ error: "No organization" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Conectar a integração da empresa é ação de administrador.
    const { data: isAdmin } = await supabaseOrg.rpc("is_org_admin", {
      _user_id: userId,
      _org_id: org_id,
    });
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: "forbidden", message: "Só owner ou admin pode conectar a integração da empresa." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GOOGLE_MAIL_API_KEY = Deno.env.get("GOOGLE_MAIL_API_KEY");
    if (!LOVABLE_API_KEY || !GOOGLE_MAIL_API_KEY) {
      return new Response(
        JSON.stringify({ error: "gmail_not_linked", message: "Gmail connector not linked to project" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify by fetching the connected user's profile via Lovable gateway
    const profileRes = await fetch(`${GATEWAY_URL}/users/me/profile`, {
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_MAIL_API_KEY,
      },
    });
    if (!profileRes.ok) {
      const text = await profileRes.text();
      return new Response(
        JSON.stringify({ error: "gmail_profile_failed", message: text }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const profile = await profileRes.json();
    const email = profile.emailAddress as string;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const merged = { email, from_name: from_name || null, signature: signature || null, mode: "connector" };

    const { data: existing } = await supabaseAdmin
      .from("integration_configs")
      .select("id")
      .eq("org_id", org_id)
      .eq("provider", "gmail")
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from("integration_configs")
        .update({ config: merged, is_active: true, connected_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin.from("integration_configs").insert({
        org_id,
        provider: "gmail",
        config: merged,
        is_active: true,
        connected_at: new Date().toISOString(),
      });
    }

    return new Response(JSON.stringify({ ok: true, email }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("gmail-connect error:", err);
    return new Response(JSON.stringify({ error: "internal_error", message: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
