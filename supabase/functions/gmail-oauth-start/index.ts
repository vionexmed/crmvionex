import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolverCredencialGoogle, validarCredencialGoogle } from "../_shared/google-credentials.ts";
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

/**
 * Google Ads pede escopo PRÓPRIO, e ele é pedido SOZINHO.
 *
 * Juntar `adwords` com os de Gmail faria a tela de consentimento pedir acesso a
 * e-mail de quem só quer autorizar anúncio — e vice-versa. São autorizações de
 * naturezas diferentes, dadas por pessoas diferentes em momentos diferentes: o
 * Gmail é de cada vendedor, o Ads é da empresa.
 *
 * `userinfo.email` acompanha porque o callback usa o e-mail para saber QUEM
 * autorizou, e sem ele não haveria o que registrar.
 */
const SCOPES_ADS = [
  "https://www.googleapis.com/auth/adwords",
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

    const { return_to, label, purpose, scope_type, finalidade } = await req.json().catch(() => ({}));
    /** "ads" autoriza Google Ads; qualquer outra coisa é o fluxo de Gmail. */
    const paraAds = finalidade === "ads";

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

    // Resolvedor único: a MESMA ordem usada no callback e no refresh. Divergir
    // aqui é o que produz invalid_client depois. Ver _shared/google-credentials.
    const cred = await resolverCredencialGoogle(supabaseAdmin, org_id);
    const clientId = cred.clientId;
    if (!clientId || !cred.clientSecret) {
      return new Response(JSON.stringify({
        error: "gmail_sem_credencial",
        // A mensagem antiga mandava o admin para "Integrações > Gmail" e citava
        // um formulário que gravava a credencial onde o navegador lê.
        message: "A credencial do Google não está cadastrada. Um administrador precisa cadastrá-la em Integrações.",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Não envie o usuário para accounts.google.com com uma credencial expirada,
    // apagada ou de outro projeto. Sem esta checagem o Google só exibe o opaco
    // "401 invalid_client" depois de ele escolher a conta, e o CRM não consegue
    // explicar nem corrigir a causa. O teste usa um refresh token propositalmente
    // inválido: `invalid_grant` confirma que o par de credenciais é válido.
    const teste = await validarCredencialGoogle(clientId, cred.clientSecret);
    if (!teste.ok) {
      return new Response(JSON.stringify({
        error: "gmail_credencial_invalida",
        message: `A credencial OAuth do Google configurada para esta organização não é válida. Um administrador deve atualizá-la em Integrações. ${teste.erro ?? ""}`.trim(),
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const redirectUri = `${supabaseUrl}/functions/v1/gmail-oauth-callback`;

    // Assinado com HMAC e com expiração conferida no callback.
    const state = await signState({
      user_id: userId,
      org_id,
      return_to: return_to || (paraAds ? "/settings/integrations" : scopeType === "user" ? "/settings/email" : "/settings/integrations"),
      label: label || "Principal",
      purpose: purpose || "sales",
      scope_type: scopeType,
      finalidade: paraAds ? "ads" : "gmail",
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: paraAds ? SCOPES_ADS : SCOPES,
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
