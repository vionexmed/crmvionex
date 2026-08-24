import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolverCredencialGoogle } from "../_shared/google-credentials.ts";
import { verifyStateDetalhado, type FalhaState } from "../_shared/oauth-state.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(s: string) {
  return String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/**
 * Base para onde devolver a pessoa depois do callback.
 *
 * TEM de ser APP_BASE_URL, nunca o referer. No callback do OAuth o referer é
 * `accounts.google.com` — foi o Google que redirecionou o navegador até aqui.
 * Usar o referer como base transformava o caminho relativo em
 * `https://accounts.google.com/settings/integrations`, ou seja, mandava a
 * pessoa para dentro do Google. Pior: o referer também entrava na lista de
 * hosts confiáveis, o que é redirecionamento aberto — o valor vem do navegador.
 */
function baseDoApp(): string {
  const appBase = Deno.env.get("APP_BASE_URL");
  if (appBase) {
    try { return new URL(appBase).origin; } catch { /* cai no vazio */ }
  }
  return "";
}

/** Caminho relativo, ou URL absoluta no host do próprio app. Nada mais. */
function sanitizeReturnTo(raw: string | undefined | null): string {
  const fallback = "/settings/email";
  if (!raw || typeof raw !== "string") return fallback;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const u = new URL(raw);
    const base = baseDoApp();
    if (base && u.host === new URL(base).host) return u.toString();
  } catch { /* ignore */ }
  return fallback;
}

function htmlResponse(message: string, ok: boolean, returnTo: string) {
  const color = ok ? "#16a34a" : "#dc2626";
  const title = ok ? "Gmail conectado!" : "Falha ao conectar";
  const safeReturn = escapeHtml(returnTo);
  const safeMsg = escapeHtml(message);
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0b0b0c;color:#fff}
    .card{max-width:420px;text-align:center;padding:32px;border:1px solid #27272a;border-radius:12px;background:#111}
    h1{color:${color};margin:0 0 8px;font-size:18px}
    p{color:#a1a1aa;font-size:13px;margin:0 0 16px}
    a{display:inline-block;background:#fff;color:#000;padding:8px 14px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:500}</style></head>
    <body><div class="card"><h1>${title}</h1><p>${safeMsg}</p>
    <a href="${safeReturn}">Voltar ao app</a></div>
    <script>setTimeout(()=>{window.location.href=${JSON.stringify(returnTo)}},1800)</script>
    </body></html>`,
    // 200 mesmo na falha, de propósito. Isto é uma PÁGINA para uma pessoa ler,
    // não resposta de API: o navegador só renderiza o que vier. E com status de
    // erro a plataforma reescrevia o Content-Type para text/plain, o que somado
    // ao nosniff fazia o HTML aparecer como código-fonte, com os acentos
    // quebrados. O sucesso ou fracasso é dito pelo conteúdo.
    { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 200 },
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  // O state agora é assinado com HMAC e tem expiração conferida. Antes era
  // base64 puro: forjável, e user_id/org_id vindos dele iam direto para INSERT
  // com service role.
  const resultadoState = stateParam
    ? await verifyStateDetalhado<any>(stateParam)
    : ({ ok: false, motivo: "formato" } as const);
  const state: any = resultadoState.ok ? resultadoState.payload : {};

  const base = baseDoApp();
  const sanitizedReturn = sanitizeReturnTo(state.return_to);
  const finalReturn = sanitizedReturn.startsWith("http")
    ? sanitizedReturn
    : `${base}${sanitizedReturn}`;

  if (errorParam) return htmlResponse(`Google retornou: ${errorParam}`, false, finalReturn);

  if (stateParam && !resultadoState.ok) {
    // Cada motivo pede uma ação diferente. Antes os três viravam a mesma frase,
    // e quem lia não sabia se era só tentar de novo ou se havia algo errado.
    const explicacao: Record<FalhaState, string> = {
      expirado:
        "A autorização demorou mais do que a janela permitida. Volte ao CRM e clique em Conectar de novo — agora você tem 30 minutos.",
      assinatura:
        "A assinatura do link não confere. Isso costuma acontecer quando o link foi reaproveitado de uma tentativa antiga. Comece de novo pelo CRM.",
      formato: "O link de autorização veio incompleto. Comece de novo pelo CRM.",
      erro: "Não foi possível ler o link de autorização. Comece de novo pelo CRM.",
    };
    // Vai para o log da função: é o que permite diagnosticar sem pedir print.
    console.error("gmail-oauth-callback: state recusado", { motivo: resultadoState.motivo });
    return htmlResponse(explicacao[resultadoState.motivo], false, finalReturn);
  }
  if (!code || !state.user_id || !state.org_id) {
    return htmlResponse("Parâmetros inválidos.", false, finalReturn);
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolvedor único — a mesma ordem do gmail-oauth-start e do refresh.
    const cred = await resolverCredencialGoogle(supabaseAdmin, state.org_id);
    const clientId = cred.clientId;
    const clientSecret = cred.clientSecret;
    if (!clientId || !clientSecret) return htmlResponse("Credenciais OAuth não configuradas.", false, finalReturn);

    // `cfg` segue sendo lido adiante para preservar assinatura e demais chaves
    // do integration_configs no upsert final. Não carrega mais credencial: a
    // migração 20260824130000 removeu client_id/client_secret de lá.
    const { data: cfgRow } = await supabaseAdmin
      .from("integration_configs")
      .select("config")
      .eq("org_id", state.org_id)
      .eq("provider", "gmail")
      .maybeSingle();
    const cfg: Record<string, unknown> = (cfgRow?.config as Record<string, unknown>) ?? {};

    const redirectUri = `${Deno.env.get("SUPABASE_URL")!}/functions/v1/gmail-oauth-callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tok = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("token exchange failed:", tok);
      return htmlResponse(tok.error_description || "Falha na troca de tokens.", false, finalReturn);
    }

    // Fetch user email
    const profRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const prof = await profRes.json();
    const email = prof.email;
    if (!email) return htmlResponse("Não foi possível obter o e-mail Google.", false, finalReturn);

    const expiresAt = new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString();

    // supabaseAdmin already created above

    const { error: upErr } = await supabaseAdmin
      .from("gmail_oauth_tokens")
      .upsert({
        user_id: state.user_id,
        org_id: state.org_id,
        email,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token, // present because prompt=consent + access_type=offline
        expires_at: expiresAt,
        scope: tok.scope ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,email" });

    if (upErr) {
      console.error("upsert tokens error:", upErr);
      return htmlResponse("Erro ao salvar tokens.", false, finalReturn);
    }

    const purpose = state.purpose || "sales";
    const scopeType = state.scope_type === "org" ? "org" : "user";

    // Desativa apenas a conexão anterior DO MESMO ESCOPO. Antes isto desativava
    // por (org_id, purpose), então a segunda pessoa a conectar derrubava a
    // conexão da primeira — o bug que impedia uma conta por vendedor.
    const desativar = supabaseAdmin
      .from("email_connections")
      .update({ is_active: false })
      .eq("org_id", state.org_id)
      .eq("scope_type", scopeType)
      .eq("is_active", true)
      .neq("email_address", email);

    if (scopeType === "user") {
      // Conta pessoal: só a conta anterior da MESMA pessoa sai.
      await desativar.eq("user_id", state.user_id);
    } else {
      // Caixa da empresa: uma ativa por finalidade.
      await desativar.eq("purpose", purpose);
    }

    await supabaseAdmin.from("email_connections").upsert({
      user_id: state.user_id,
      org_id: state.org_id,
      provider: "gmail",
      email_address: email,
      label: state.label || "Principal",
      purpose,
      scope_type: scopeType,
      is_active: true,
      connected_at: new Date().toISOString(),
    }, { onConflict: "org_id,provider,email_address" });

    // Also upsert integration_configs so the existing UI lights up "Conectado"
    const { data: existing } = await supabaseAdmin
      .from("integration_configs")
      .select("id")
      .eq("org_id", state.org_id)
      .eq("provider", "gmail")
      .maybeSingle();

    // Preserve user-provided client_id/client_secret + other fields
    const mergedCfg = { ...cfg, email, mode: "oauth_byok" };
    if (existing) {
      await supabaseAdmin.from("integration_configs")
        .update({ config: mergedCfg, is_active: true, connected_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin.from("integration_configs").insert({
        org_id: state.org_id,
        provider: "gmail",
        config: mergedCfg,
        is_active: true,
        connected_at: new Date().toISOString(),
        connected_by: state.user_id,
      });
    }

    return htmlResponse(`${email} conectado com sucesso.`, true, finalReturn);
  } catch (err) {
    console.error("callback error:", err);
    return htmlResponse((err as Error).message, false, finalReturn);
  }
});
