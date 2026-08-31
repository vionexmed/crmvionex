import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolverCredencialGoogle } from "../_shared/google-credentials.ts";
import { verifyStateDetalhado } from "../_shared/oauth-state.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

/**
 * Devolve a pessoa ao CRM com o resultado nos parâmetros da URL.
 *
 * NÃO renderiza HTML aqui, e não é escolha de estilo: a plataforma de Edge
 * Functions rebaixa `text/html` para `text/plain` e manda `nosniff` junto —
 * proteção contra phishing no domínio compartilhado *.supabase.co. Comprovado:
 * uma resposta JSON mantém `application/json`, uma resposta HTML vira texto.
 * Resultado: a página de "Gmail conectado" aparecia como código-fonte, com os
 * acentos quebrados.
 *
 * Redirecionar resolve de vez e ainda é melhor: a pessoa cai direto no CRM sem
 * a espera de 1,8s, e a mensagem é renderizada pelo app — no idioma e no visual
 * dele, não num HTML solto dentro de uma edge function.
 *
 * Os motivos viajam como CÓDIGO. Quem traduz é a tela, igual ao invalid_reason
 * de email_connections.
 */
function redirecionar(destino: string, params: Record<string, string>) {
  const base = baseDoApp();

  // Sem APP_BASE_URL não há para onde voltar. Aqui o texto puro é aceitável: é
  // erro de configuração do servidor, não fluxo normal.
  if (!base) {
    return new Response(
      "O CRM não sabe para onde te devolver: falta configurar APP_BASE_URL nos "
        + "secrets do projeto. Avise um administrador.",
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const url = new URL(destino.startsWith("http") ? destino : `${base}${destino}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

/** Falha: volta ao CRM com o código do motivo. */
const falhar = (destino: string, motivo: string, detalhe?: string) =>
  redirecionar(destino, { gmail: "erro", motivo, ...(detalhe ? { detalhe: detalhe.slice(0, 200) } : {}) });

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

  if (errorParam) return falhar(finalReturn, "google_recusou", errorParam);

  if (stateParam && !resultadoState.ok) {
    // Vai para o log da função: é o que permite diagnosticar sem pedir print.
    console.error("gmail-oauth-callback: state recusado", { motivo: resultadoState.motivo });
    return falhar(finalReturn, `state_${resultadoState.motivo}`);
  }
  if (!code || !state.user_id || !state.org_id) {
    return falhar(finalReturn, "parametros_invalidos");
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
    if (!clientId || !clientSecret) return falhar(finalReturn, "sem_credencial");

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
      // O objeto inteiro vai para o log; o usuário recebe só o código.
      console.error("token exchange failed:", { status: tokenRes.status, tok, redirectUri });

      // O `error_description` do Google costuma ser "Bad Request" — texto que
      // não diz nada e não sugere ação. Quem carrega a informação útil é o
      // campo `error`, então é ele que decide a mensagem.
      const codigo = typeof tok?.error === "string" ? tok.error : "";
      const motivo =
        codigo === "invalid_grant"
          ? "codigo_usado_ou_expirado"
          : codigo === "redirect_uri_mismatch"
            ? "uri_divergente"
            : codigo === "invalid_client"
              ? "credencial_recusada"
              : "troca_de_token";

      return falhar(finalReturn, motivo, codigo || `HTTP ${tokenRes.status}`);
    }

    // Fetch user email
    const profRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const prof = await profRes.json();
    const email = prof.email;
    if (!email) return falhar(finalReturn, "sem_email");

    // ---------- Google Ads: guarda o refresh token e sai ----------
    //
    // Sai ANTES de tocar em `gmail_oauth_tokens` e `email_connections`: esta
    // autorização não é de caixa de e-mail, e criar conexão de e-mail a partir
    // dela faria aparecer uma caixa que ninguém conectou -- com o escopo errado,
    // então toda leitura falharia depois.
    //
    // O refresh token vai para `google_oauth_secrets`, que tem RLS ligada SEM
    // policy: só service_role lê. Ele dá acesso a gastar dinheiro em campanha.
    if (state.finalidade === "ads") {
      if (!tok.refresh_token) {
        // Acontece quando o Google já concedeu antes e não repete o refresh.
        // `prompt=consent` deveria evitar, mas vale dizer o que fazer.
        return falhar(finalReturn, "sem_refresh_token");
      }
      const { error: erroAds } = await supabaseAdmin
        .from("google_oauth_secrets")
        .update({
          ads_refresh_token: tok.refresh_token,
          updated_at: new Date().toISOString(),
        })
        .eq("org_id", state.org_id);
      if (erroAds) {
        console.error("google ads refresh token:", erroAds);
        return falhar(finalReturn, "falha_ao_salvar");
      }
      return redirecionar(finalReturn, { google_ads: "ok" });
    }

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
      return falhar(finalReturn, "falha_ao_salvar");
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

    return redirecionar(finalReturn, { gmail: "conectado", conta: email });
  } catch (err) {
    console.error("callback error:", err);
    return falhar(finalReturn, "erro_inesperado", (err as Error).message);
  }
});
