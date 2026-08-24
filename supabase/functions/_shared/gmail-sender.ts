/**
 * Envio de e-mail pela conta Gmail da ORGANIZAÇÃO (server-side, service role).
 * Usado pelo motor de automações (process-automation) e pelo worker de
 * sequências (process-sequences). Mesma resolução de conta do gmail-send:
 * email_connections por finalidade → token em gmail_oauth_tokens →
 * refresh com as credenciais BYOK corretas → Gmail API → registro em emails.
 */

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

function asEmailHtml(value: string) {
  const html = value.normalize("NFC");
  if (/<!doctype|<html[\s>]/i.test(html)) return html;
  return `<!doctype html><html><head><meta charset="UTF-8"></head><body>${html}</body></html>`;
}

function encodeRaw(opts: { to: string; from: string; subject: string; html: string }) {
  const lines = [
    `To: ${opts.to}`,
    `From: ${opts.from}`,
    `Subject: ${encodeHeader(opts.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: text/html; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(utf8Base64(asEmailHtml(opts.html))),
  ];
  const b64 = utf8Base64(lines.join("\r\n"));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}


export interface OrgEmailOptions {
  orgId: string;
  to: string;
  subject: string;
  html: string;
  purpose?: "sales" | "marketing";
  contactId?: string | null;
  dealId?: string | null;
  /** usuário creditado como remetente no registro (null = sistema) */
  userId?: string | null;
}

/**
 * Envia um e-mail de automação/sequência e registra na tabela emails.
 *
 * A conta usada é a do RESPONSÁVEL PELO CONTATO, não uma caixa da empresa —
 * a operação não tem caixa compartilhada, e o e-mail de cadência deve sair do
 * endereço da pessoa que cuida do lead. Sem conexão ou com o teto diário
 * estourado, LANÇA erro com motivo legível para quem chama registrar em
 * automation_logs — nunca falha em silêncio.
 *
 * @param admin supabase client com service role
 */
export async function sendViaOrgAccount(admin: any, opts: OrgEmailOptions): Promise<{ id: string | null }> {
  const purpose = opts.purpose === "marketing" ? "marketing" : "sales";

  const { data: cfgRow } = await admin
    .from("integration_configs")
    .select("config")
    .eq("org_id", opts.orgId)
    .eq("provider", "gmail")
    .maybeSingle();
  const cfg: Record<string, unknown> = (cfgRow?.config as Record<string, unknown>) ?? {};

  // Quem é o responsável pelo contato desta mensagem.
  let ownerId: string | null = opts.userId ?? null;
  if (!ownerId && opts.contactId) {
    const { data: contato } = await admin
      .from("contacts").select("owner_id").eq("id", opts.contactId).maybeSingle();
    ownerId = (contato?.owner_id as string) ?? null;
  }

  let connection: Record<string, unknown> | null = null;

  if (ownerId) {
    const { data: contaDoDono } = await admin
      .from("email_connections")
      .select("*")
      .eq("org_id", opts.orgId)
      .eq("provider", "gmail")
      .eq("scope_type", "user")
      .eq("user_id", ownerId)
      .eq("is_active", true)
      .maybeSingle();
    connection = contaDoDono;
  }

  // Reserva: caixa compartilhada da empresa, se algum dia existir.
  if (!connection) {
    const { data: contaEmpresa } = await admin
      .from("email_connections")
      .select("*")
      .eq("org_id", opts.orgId)
      .eq("provider", "gmail")
      .eq("scope_type", "org")
      .eq("purpose", purpose)
      .eq("is_active", true)
      .maybeSingle();
    connection = contaEmpresa;
  }

  if (!connection) {
    throw new Error(
      "O responsável pelo contato não tem Gmail conectado, e não há caixa da empresa. "
      + "Peça a ele para conectar em Configurações › Meu e-mail.",
    );
  }

  // Mesmo teto diário do envio manual.
  const { data: temVaga } = await admin.rpc("reserve_email_send", {
    _connection_id: connection.id,
  });
  if (!temVaga) {
    throw new Error(
      `Limite diário de envio da conta ${connection.email_address} atingido `
      + `(${connection.daily_send_limit}). O envio foi pulado, não perdido.`,
    );
  }

  const { data: tokenRow } = await admin
    .from("gmail_oauth_tokens")
    .select("*")
    .eq("org_id", opts.orgId)
    .eq("email", connection.email_address)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!tokenRow) throw new Error("Token OAuth da conta não encontrado — reconecte a conta de e-mail");

  let accessToken = tokenRow.access_token as string;
  if (new Date(tokenRow.expires_at).getTime() - Date.now() < 60_000) {
    // Resolvedor único: a MESMA ordem do gmail-oauth-start e do callback.
    const cred = await resolverCredencialGoogle(admin, opts.orgId);
    const renovado = await renovarAccessToken(tokenRow.refresh_token as string, cred);
    if (!renovado.ok) {
      await admin
        .from("email_connections")
        .update({ invalid_since: new Date().toISOString(), invalid_reason: renovado.motivo })
        .eq("id", connection.id)
        .is("invalid_since", null);
      // Lança em vez de engolir: quem chama grava em automation_logs, e assim o
      // log diz o motivo em vez de "falhou".
      throw new Error(
        renovado.motivo === "credenciais_trocadas"
          ? "A credencial do Google da empresa mudou. O responsável pelo contato precisa reconectar em Configurações › Conectar e-mail."
          : "O acesso Google do responsável pelo contato expirou ou foi revogado. Ele precisa reconectar em Configurações › Conectar e-mail.",
      );
    }
    const refreshed = { access_token: renovado.accessToken, expires_in: renovado.expiraEm };
    accessToken = refreshed.access_token;
    await admin.from("gmail_oauth_tokens").update({
      access_token: accessToken,
      expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", tokenRow.id);
  }

  const fromEmail = connection.email_address as string;
  const fromName = (connection.from_name as string) || (cfg.from_name as string) || "";
  const from = fromName ? `${encodeHeader(fromName)} <${fromEmail}>` : fromEmail;
  const signature = (connection.signature_html as string) ? `<br/><br/>${connection.signature_html}` : "";
  const finalHtml = `${opts.html}${signature}`;

  // Pré-registra para obter o id do rastreio de abertura/clique
  const { data: preInserted, error: preErr } = await admin.from("emails").insert({
    org_id: opts.orgId,
    // Dono do registro: sem isto a policy emails_select esconde o e-mail de
    // quem não é admin, inclusive do próprio responsável pelo contato.
    user_id: opts.userId ?? ownerId ?? null,
    connection_id: connection.id,
    contact_id: opts.contactId ?? null,
    deal_id: opts.dealId ?? null,
    direction: "outbound",
    subject: opts.subject,
    body_html: finalHtml,
    from_email: fromEmail,
    to_emails: [opts.to],
    cc_emails: [],
    bcc_emails: [],
    status: "sending",
    provider: "gmail",
    is_read: true,
    synced_from: fromEmail,
  }).select("id").maybeSingle();
  // O erro era engolido: o e-mail saía pelo Gmail e nunca era registrado.
  if (preErr) throw new Error(`Falha ao registrar o e-mail antes do envio: ${preErr.message}`);
  const emailId: string | null = preInserted?.id ?? null;

  let trackedHtml = finalHtml;
  if (emailId) {
    const trackBase = `${Deno.env.get("SUPABASE_URL")}/functions/v1/email-track`;
    trackedHtml = trackedHtml.replace(
      /href="(https?:\/\/[^"]+)"/gi,
      (_m: string, u: string) => `href="${trackBase}?e=${emailId}&t=click&u=${encodeURIComponent(u)}"`,
    );
    trackedHtml += `<img src="${trackBase}?e=${emailId}&t=open" width="1" height="1" style="display:none" alt=""/>`;
  }

  const raw = encodeRaw({ to: opts.to, from, subject: opts.subject, html: trackedHtml });

  const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const sendData = await sendRes.json();
  if (!sendRes.ok) {
    if (emailId) await admin.from("emails").delete().eq("id", emailId);
    throw new Error(`gmail send failed: ${JSON.stringify(sendData).slice(0, 300)}`);
  }

  if (emailId) {
    await admin.from("emails").update({
      status: "sent",
      sent_at: new Date().toISOString(),
      thread_id: sendData.threadId ?? null,
      message_id: sendData.id ?? null,
    }).eq("id", emailId);
  }

  return { id: emailId };
}

/** Substituição de variáveis {{primeiro_nome}} etc. usada por automações e sequências */
export function renderTemplate(text: string, contact: Record<string, unknown> | null): string {
  if (!text) return "";
  const first = String(contact?.first_name ?? "");
  const last = String(contact?.last_name ?? "");
  return text
    .replace(/\{\{primeiro_nome\}\}/g, first)
    .replace(/\{\{sobrenome\}\}/g, last)
    .replace(/\{\{nome\}\}/g, `${first} ${last}`.trim())
    .replace(/\{\{email\}\}/g, String(contact?.email ?? ""));
}
