import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolverCredencialGoogle, renovarAccessToken } from "../_shared/google-credentials.ts";
import { montarAssinaturaHtml } from "../_shared/email-signature.ts";
import { captureException } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function utf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value.normalize("NFC"));
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

function wrapBase64(value: string) {
  return value.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function encodeHeader(value: string) {
  const normalized = value.normalize("NFC");
  return /[^\x20-\x7E]/.test(normalized) ? `=?UTF-8?B?${utf8Base64(normalized)}?=` : normalized;
}

function encodeAddressHeader(value: string) {
  return value
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      const match = trimmed.match(/^(.*)<([^>]+)>$/);
      if (!match) return trimmed;
      const name = match[1].trim().replace(/^"|"$/g, "");
      const email = match[2].trim();
      return name ? `${encodeHeader(name)} <${email}>` : email;
    })
    .join(", ");
}

function asEmailHtml(value: string) {
  const html = value.normalize("NFC");
  if (/<!doctype|<html[\s>]/i.test(html)) return html;
  return `<!doctype html><html><head><meta charset="UTF-8"></head><body>${html}</body></html>`;
}

function encodeRaw(opts: { to: string; from: string; cc?: string; bcc?: string; subject: string; html?: string; text?: string }) {
  const content = opts.html ? asEmailHtml(opts.html) : (opts.text ?? "").normalize("NFC");
  const lines = [`To: ${encodeAddressHeader(opts.to)}`, `From: ${encodeAddressHeader(opts.from)}`];
  if (opts.cc) lines.push(`Cc: ${opts.cc}`);
  if (opts.bcc) lines.push(`Bcc: ${opts.bcc}`);
  lines.push(
    `Subject: ${encodeHeader(opts.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: text/${opts.html ? "html" : "plain"}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(utf8Base64(content)),
  );
  const raw = lines.join("\r\n");
  const b64 = utf8Base64(raw);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}


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

    const body = await req.json();
    const { contact_id, deal_id, to, cc, bcc, subject, html, text } = body;
    const purpose: string = body.purpose === "marketing" ? "marketing" : "sales";
    if (!to || !subject || (!html && !text)) {
      return new Response(JSON.stringify({ error: "to, subject and html/text required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // SECURITY: derive org_id server-side from authenticated user — never trust client-supplied org_id
    const { data: profile } = await supabaseAdmin
      .from("profiles").select("org_id").eq("id", userId).maybeSingle();
    const org_id = profile?.org_id;
    if (!org_id) {
      return new Response(JSON.stringify({ error: "No organization" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Antes: `if (!isAdmin) purpose = "sales"` forçava todo vendedor a enviar
    // pela conta da empresa, e o remetente saía como o endereço corporativo.
    // Agora cada pessoa envia pela própria conta — a resolução está abaixo.

    // Load integration config first to decide auth mode (connector vs oauth_byok)
    const { data: cfgRow } = await supabaseAdmin
      .from("integration_configs")
      .select("config")
      .eq("org_id", org_id)
      .eq("provider", "gmail")
      .maybeSingle();
    const cfg: any = cfgRow?.config ?? {};
    const mode: string = cfg.mode || "oauth_byok";

    // Resolvida uma vez, usada na renovação abaixo. Mesma ordem do
    // gmail-oauth-start e do callback — ver _shared/google-credentials.
    const cred = await resolverCredencialGoogle(supabaseAdmin, org_id);

    let accessToken = "";
    let fromEmail = "";
    let useConnector = false;
    let connectorApiKey = "";
    let lovableApiKey = "";
    let connection: any = null;

    if (mode === "connector") {
      connectorApiKey = Deno.env.get("GOOGLE_MAIL_API_KEY") ?? "";
      lovableApiKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
      if (!connectorApiKey || !lovableApiKey) {
        return new Response(JSON.stringify({ error: "gmail_not_connected", message: "Conector Gmail não está vinculado ao projeto." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      useConnector = true;
      fromEmail = cfg.email || "";
    } else {
      // 1º: a conta pessoal de quem está enviando. É o que faz o e-mail sair do
      // endereço da própria pessoa.
      const { data: minhaConta } = await supabaseAdmin
        .from("email_connections")
        .select("*")
        .eq("org_id", org_id)
        .eq("provider", "gmail")
        .eq("scope_type", "user")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();

      connection = minhaConta;

      // 2º: caixa compartilhada da empresa, se existir para esta finalidade.
      if (!connection) {
        const { data: contaEmpresa } = await supabaseAdmin
          .from("email_connections")
          .select("*")
          .eq("org_id", org_id)
          .eq("provider", "gmail")
          .eq("scope_type", "org")
          .eq("purpose", purpose)
          .eq("is_active", true)
          .maybeSingle();
        connection = contaEmpresa;
      }

      if (!connection) {
        return new Response(JSON.stringify({
          error: "gmail_not_connected",
          message: "Você ainda não conectou seu Gmail. Conecte em Configurações › Meu e-mail.",
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Teto diário por conexão. Sem isto, uma automação em laço consome a cota
      // do Gmail (2.000/dia no Workspace) e sinaliza a reputação do domínio.
      const { data: temVaga } = await supabaseAdmin.rpc("reserve_email_send", {
        _connection_id: connection.id,
      });
      if (!temVaga) {
        return new Response(JSON.stringify({
          error: "daily_limit_reached",
          message: `Limite diário de ${connection.daily_send_limit} envios desta conta foi atingido. Ele reinicia amanhã.`,
        }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Token da conta da org (conectado por qualquer admin)
      const { data: tokenRow } = await supabaseAdmin
        .from("gmail_oauth_tokens")
        .select("*")
        .eq("org_id", org_id)
        .eq("email", connection.email_address)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!tokenRow) {
        return new Response(JSON.stringify({ error: "gmail_not_connected", message: "Token da conta não encontrado. Reconecte a conta em Integrações." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      accessToken = tokenRow.access_token as string;
      if (new Date(tokenRow.expires_at).getTime() - Date.now() < 60_000) {
        const renovado = await renovarAccessToken(tokenRow.refresh_token as string, cred);
        if (!renovado.ok) {
          // Marca o motivo ANTES de devolver erro, para a tela da pessoa
          // explicar o que aconteceu em vez de só falhar o envio.
          await supabaseAdmin
            .from("email_connections")
            .update({ invalid_since: new Date().toISOString(), invalid_reason: renovado.motivo })
            .eq("id", connection.id)
            .is("invalid_since", null);

          return new Response(JSON.stringify({
            error: "gmail_conexao_invalida",
            reason: renovado.motivo,
            message: renovado.motivo === "credenciais_trocadas"
              ? "A credencial do Google da empresa mudou. Reconecte sua conta em Configurações › Conectar e-mail."
              : "O acesso da sua conta Google expirou ou foi revogado. Reconecte em Configurações › Conectar e-mail.",
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
      fromEmail = tokenRow.email as string;
    }

    const fromName = connection?.from_name || cfg.from_name || "";
    const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

    // Fallback: per-user default signature stored in email_signatures
    const { data: sigRow } = await supabaseAdmin
      .from("email_signatures")
      .select("html")
      .eq("user_id", userId)
      .eq("is_default", true)
      .maybeSingle();
    const fallbackSignatureHtml: string = sigRow?.html ?? "";

    const buildSignatureHtml = (): string => {
      // 1º: a assinatura DA PESSOA, montada na tela e guardada pronta.
      if (connection?.signature_html) return `<br/><br/>${connection.signature_html}`;

      // 2º: a da organização. Antes era renderizada aqui por um segundo
      // template — e os dois divergiram: a tela mostrava um desenho e o e-mail
      // enviado saía com ícones que não renderizam em cliente nenhum e um azul
      // que não é da marca. Agora os dois usam o MESMO construtor.
      const daOrg = montarAssinaturaHtml({
        nome: cfg.signature_name as string | undefined,
        cargo: cfg.signature_role as string | undefined,
        empresa: cfg.signature_company as string | undefined,
        telefone: cfg.signature_phone as string | undefined,
        email: cfg.signature_email as string | undefined,
        site: cfg.signature_website as string | undefined,
        fotoUrl: cfg.signature_logo_url as string | undefined,
        extra: cfg.signature_extra as string | undefined,
      });
      if (daOrg) return `<br/><br/>${daOrg}`;

      // 3º e 4º: formatos antigos, mantidos para quem ainda os tem gravados.
      if (cfg.signature) return `<br/><br/>${(cfg.signature as string).replace(/\n/g, "<br/>")}`;
      if (fallbackSignatureHtml) return `<br/><br/>${fallbackSignatureHtml}`;
      return "";
    };

    const signatureHtml = buildSignatureHtml();
    const alreadyHasSignature = !!(html && signatureHtml && html.includes(signatureHtml.slice(0, 80)));
    const finalHtml = html ? (alreadyHasSignature ? html : `${html}${signatureHtml}`) : (signatureHtml || undefined);
    const plainSig = cfg.signature || (fallbackSignatureHtml ? fallbackSignatureHtml.replace(/<[^>]+>/g, "") : "");
    const finalText = !html && text ? (plainSig ? `${text}\n\n${plainSig}` : text) : text;

    // VÍNCULO AUTOMÁTICO no envio.
    //
    // O compositor só manda contact_id quando a pessoa abriu o e-mail de dentro
    // de um contato. Quem clica "Novo e-mail" e digita o endereço à mão deixa a
    // abordagem sem vínculo — ela conta na métrica e desaparece da ficha do
    // lead, então o próximo a falar com aquela pessoa não vê que já houve
    // contato.
    //
    // Vincular no ENVIO, e não ao abrir a tela: o que importa é a mensagem que
    // saiu, não a intenção de escrever.
    //
    // Só CASA com contato existente, nunca cria: criar contato a partir do
    // destinatário encheria a base de endereço interno, de teste e de
    // fornecedor. Sem correspondência, segue sem vínculo — e a lista de
    // abordagens mostra isso em vez de esconder.
    let contatoResolvido: string | null = contact_id ?? null;
    if (!contatoResolvido) {
      const primeiro = (Array.isArray(to) ? to[0] : String(to).split(",")[0] || "").trim();
      if (primeiro) {
        const { data: achado } = await supabaseAdmin
          .from("contacts")
          .select("id")
          .eq("org_id", org_id)
          .ilike("email", primeiro)
          .maybeSingle();
        contatoResolvido = achado?.id ?? null;
      }
    }

    const toList = Array.isArray(to) ? to : String(to).split(",").map((s: string) => s.trim()).filter(Boolean);
    const ccList = cc ? (Array.isArray(cc) ? cc : String(cc).split(",").map((s: string) => s.trim()).filter(Boolean)) : [];
    const bccList = bcc ? (Array.isArray(bcc) ? bcc : String(bcc).split(",").map((s: string) => s.trim()).filter(Boolean)) : [];

    // Pré-registra o e-mail para obter o id usado no rastreio de abertura/clique
    const { data: preInserted, error: preErr } = await supabaseAdmin.from("emails").insert({
      org_id,
      user_id: userId,
      connection_id: connection?.id ?? null,
      contact_id: contatoResolvido,
      deal_id: deal_id ?? null,
      direction: "outbound",
      subject,
      body_html: finalHtml ?? finalText ?? "",
      from_email: fromEmail,
      to_emails: toList,
      cc_emails: ccList,
      bcc_emails: bccList,
      status: "sending",
      provider: "gmail",
      is_read: true,
      synced_from: fromEmail,
    }).select("id").maybeSingle();
    // O erro era engolido aqui: o e-mail era enviado e nunca registrado, porque
    // o CHECK de status não aceitava 'sending' (corrigido na migração).
    if (preErr) {
      console.error("pre-insert email error:", preErr);
      return new Response(JSON.stringify({
        error: "email_not_recorded",
        message: `Não foi possível registrar o e-mail antes do envio: ${preErr.message}`,
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const emailId = preInserted?.id as string | undefined;

    // Injeta pixel de abertura + reescreve links para contagem de cliques
    let trackedHtml = finalHtml;
    if (emailId && trackedHtml) {
      const trackBase = `${Deno.env.get("SUPABASE_URL")}/functions/v1/email-track`;
      trackedHtml = trackedHtml.replace(
        /href="(https?:\/\/[^"]+)"/gi,
        (_m: string, u: string) => `href="${trackBase}?e=${emailId}&t=click&u=${encodeURIComponent(u)}"`,
      );
      trackedHtml += `<img src="${trackBase}?e=${emailId}&t=open" width="1" height="1" style="display:none" alt=""/>`;
    }

    const raw = encodeRaw({
      to: toList.join(", "),
      from,
      cc: ccList.length ? ccList.join(", ") : undefined,
      bcc: bccList.length ? bccList.join(", ") : undefined,
      subject,
      html: trackedHtml,
      text: finalText,
    });

    const sendUrl = useConnector
      ? "https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/messages/send"
      : "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
    const sendHeaders: Record<string, string> = useConnector
      ? {
          Authorization: `Bearer ${lovableApiKey}`,
          "X-Connection-Api-Key": connectorApiKey,
          "Content-Type": "application/json",
        }
      : { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

    const sendRes = await fetch(sendUrl, {
      method: "POST",
      headers: sendHeaders,
      body: JSON.stringify({ raw }),
    });
    const sendData = await sendRes.json();
    if (!sendRes.ok) {
      console.error("gmail send error", sendData);
      // Remove o pré-registro — o e-mail não saiu
      if (emailId) await supabaseAdmin.from("emails").delete().eq("id", emailId);
      return new Response(JSON.stringify({ error: "gmail_send_failed", details: sendData }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (emailId) {
      await supabaseAdmin.from("emails").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        thread_id: sendData.threadId ?? null,
        message_id: sendData.id ?? null,
      }).eq("id", emailId);
    }

    return new Response(JSON.stringify({ ok: true, id: sendData.id, threadId: sendData.threadId, email_id: emailId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    await captureException(err, { functionName: "gmail-send" });
    console.error("gmail-send error:", err);
    return new Response(JSON.stringify({ error: "internal_error", message: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
