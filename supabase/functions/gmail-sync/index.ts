import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolverCredencialGoogle, renovarAccessToken } from "../_shared/google-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

function decodeBase64Url(s: string): string {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const bytes = atob(b64 + pad);
    return decodeURIComponent(escape(bytes));
  } catch {
    return "";
  }
}

function getHeader(headers: any[], name: string): string | null {
  const h = headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

function extractBody(payload: any): { html: string; text: string } {
  let html = "";
  let text = "";
  const walk = (part: any) => {
    if (!part) return;
    const mt = part.mimeType || "";
    const filename = part.filename || "";
    // Skip attachments from body extraction
    if (filename) {
      if (Array.isArray(part.parts)) part.parts.forEach(walk);
      return;
    }
    if (part.body?.data) {
      const decoded = decodeBase64Url(part.body.data);
      if (mt === "text/html" && !html) html = decoded;
      else if (mt === "text/plain" && !text) text = decoded;
    }
    if (Array.isArray(part.parts)) part.parts.forEach(walk);
  };
  walk(payload);
  return { html, text };
}

function extractAttachments(payload: any): Array<{ filename: string; mime_type: string; size: number; attachment_id: string; part_id?: string }> {
  const out: Array<any> = [];
  const walk = (part: any) => {
    if (!part) return;
    const filename = part.filename || "";
    if (filename && part.body?.attachmentId) {
      out.push({
        filename,
        mime_type: part.mimeType || "application/octet-stream",
        size: Number(part.body.size || 0),
        attachment_id: part.body.attachmentId,
        part_id: part.partId,
      });
    }
    if (Array.isArray(part.parts)) part.parts.forEach(walk);
  };
  walk(payload);
  return out;
}

function parseAddrList(s: string | null): string[] {
  if (!s) return [];
  return s.split(",").map((p) => {
    const m = p.match(/<([^>]+)>/);
    return (m ? m[1] : p).trim();
  }).filter(Boolean);
}

function parseSingleAddr(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim();
}


async function oauthFetch(path: string, accessToken: string) {
  const res = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gmail ${path} ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

// O refresh usa as MESMAS credenciais que emitiram o token (BYOK da org
// quando houver, senão as do ambiente) — senão o Google dá invalid_client.

type GmailMessageFetcher = (path: string) => Promise<any>;

/**
 * Sincroniza uma lista de mensagens do Gmail para a tabela emails.
 *
 * `syncedFrom` marca de qual conta o e-mail veio. `connectionId` e `ownerId`
 * são o que torna o e-mail VISÍVEL: a policy emails_select exige
 * `user_id = auth.uid()` para quem não é admin, e antes este insert não gravava
 * user_id nenhum — todo e-mail sincronizado ficava invisível para o vendedor.
 */
async function syncMessages(opts: {
  supabaseAdmin: any;
  orgId: string;
  fetcher: GmailMessageFetcher;
  max: number;
  syncedFrom: string | null;
  connectionId?: string | null;
  ownerId?: string | null;
  query?: string;
}): Promise<number> {
  const { supabaseAdmin, orgId, fetcher, max, syncedFrom, connectionId, ownerId, query } = opts;

  const qs = new URLSearchParams({ maxResults: String(Math.min(max, 100)), labelIds: "INBOX" });
  if (query) qs.set("q", query);
  const list = await fetcher(`/users/me/messages?${qs.toString()}`);
  const ids: string[] = (list.messages ?? []).map((m: any) => m.id);
  if (ids.length === 0) return 0;

  // Skip ones we already have
  const { data: existing } = await supabaseAdmin
    .from("emails")
    .select("message_id")
    .eq("org_id", orgId)
    .in("message_id", ids);
  const have = new Set((existing ?? []).map((e: any) => e.message_id));
  const toFetch = ids.filter((id) => !have.has(id));

  let synced = 0;
  for (const id of toFetch) {
    try {
      const msg = await fetcher(`/users/me/messages/${id}?format=full`);
      const headers = msg.payload?.headers ?? [];
      const subject = getHeader(headers, "Subject");
      const fromEmail = parseSingleAddr(getHeader(headers, "From"));
      const toEmails = parseAddrList(getHeader(headers, "To"));
      const ccEmails = parseAddrList(getHeader(headers, "Cc"));
      const dateHeader = getHeader(headers, "Date");
      const sentAt = dateHeader ? new Date(dateHeader).toISOString() : new Date(Number(msg.internalDate)).toISOString();
      const { html, text } = extractBody(msg.payload);
      const attachments = extractAttachments(msg.payload);
      const isUnread = (msg.labelIds ?? []).includes("UNREAD");
      // As LABELS da mensagem, como o Gmail as informa.
      //
      // Antes só `UNREAD` era lido e o resto era jogado fora -- então o CRM não
      // sabia em que pasta a mensagem está, e as sete "pastas" da tela eram
      // flags locais inventadas aqui, sem relação com o Gmail.
      //
      // Guardamos os IDs, não os nomes: o nome é editável pela pessoa a qualquer
      // momento, e uma pasta renomeada tornaria toda mensagem dela órfã.
      const labels: string[] = msg.labelIds ?? [];

      // Try to match contact by from_email
      let contactId: string | null = null;
      if (fromEmail) {
        const { data: c } = await supabaseAdmin
          .from("contacts")
          .select("id")
          .eq("org_id", orgId)
          .ilike("email", fromEmail)
          .maybeSingle();
        contactId = c?.id ?? null;
      }

      await supabaseAdmin.from("emails").insert({
        labels,
        org_id: orgId,
        user_id: ownerId ?? null,
        connection_id: connectionId ?? null,
        contact_id: contactId,
        direction: "inbound",
        subject: subject || "(sem assunto)",
        body_html: html || `<pre style="white-space:pre-wrap;font-family:inherit">${(text || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string))}</pre>`,
        from_email: fromEmail,
        to_emails: toEmails,
        cc_emails: ccEmails,
        status: "received",
        provider: "gmail",
        message_id: id,
        thread_id: msg.threadId ?? null,
        is_read: !isUnread,
        sent_at: sentAt,
        attachments,
        synced_from: syncedFrom,
      });
      synced++;
    } catch (e) {
      console.error("sync msg fail", id, e);
    }
  }
  return synced;
}

/**
 * Sincroniza todas as contas Gmail ativas de UMA organização.
 * Extraído para servir os dois chamadores: o usuário na Inbox e o cron.
 */
async function syncOrg(
  supabaseAdmin: any,
  orgId: string,
  max: number,
  purpose?: string,
): Promise<{ synced: number; accounts: Record<string, number | string> }> {
  const { data: cfgRow } = await supabaseAdmin
    .from("integration_configs")
    .select("config")
    .eq("org_id", orgId)
    .eq("provider", "gmail")
    .maybeSingle();
  const cfg: any = cfgRow?.config ?? {};

  let connQuery = supabaseAdmin
    .from("email_connections")
    .select("*")
    .eq("org_id", orgId)
    .eq("provider", "gmail")
    .eq("is_active", true);
  if (purpose === "sales" || purpose === "marketing") {
    connQuery = connQuery.eq("purpose", purpose);
  }
  const { data: connections } = await connQuery;

  let totalSynced = 0;
  const perAccount: Record<string, number | string> = {};

  for (const conn of connections ?? []) {
    try {
      const { data: tokenRow } = await supabaseAdmin
        .from("gmail_oauth_tokens")
        .select("*")
        .eq("org_id", orgId)
        .eq("email", conn.email_address)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!tokenRow) {
        perAccount[conn.email_address] = "token_missing";
        continue;
      }

      let accessToken = tokenRow.access_token as string;
      if (new Date(tokenRow.expires_at).getTime() - Date.now() < 60_000) {
        const cred = await resolverCredencialGoogle(supabaseAdmin, orgId);
        const renovado = await renovarAccessToken(tokenRow.refresh_token as string, cred);
        if (!renovado.ok) {
          // Não interrompe o laço: uma conta inválida não pode impedir a
          // sincronização das outras. Marca o motivo e segue.
          await supabaseAdmin
            .from("email_connections")
            .update({ invalid_since: new Date().toISOString(), invalid_reason: renovado.motivo })
            .eq("id", conn.id)
            .is("invalid_since", null);
          perAccount[conn.email_address] = `invalida:${renovado.motivo}`;
          continue;
        }
        const refreshed = { access_token: renovado.accessToken, expires_in: renovado.expiraEm };
        accessToken = refreshed.access_token;
        await supabaseAdmin.from("gmail_oauth_tokens").update({
          access_token: accessToken,
          expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", tokenRow.id);
      }

      // Sync incremental: busca a partir do último sync (margem de 1 dia
      // para cobrir atrasos de entrega); primeira vez = janela padrão do max
      let query: string | undefined;
      if (conn.last_synced_at) {
        const afterUnix = Math.floor((new Date(conn.last_synced_at).getTime() - 86_400_000) / 1000);
        query = `after:${afterUnix}`;
      }

      const synced = await syncMessages({
        supabaseAdmin,
        orgId,
        fetcher: (path) => oauthFetch(path, accessToken),
        max,
        syncedFrom: conn.email_address,
        connectionId: conn.id,
        // Conta pessoal: o e-mail pertence a quem é dono da conexão. Caixa
        // compartilhada: fica sem dono, e a policy libera para a org.
        ownerId: conn.scope_type === "user" ? conn.user_id : null,
        query,
      });

      await supabaseAdmin
        .from("email_connections")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", conn.id);

      perAccount[conn.email_address] = synced;
      totalSynced += synced;
    } catch (e) {
      console.error("account sync fail", conn.email_address, e);
      perAccount[conn.email_address] = `error: ${(e as Error).message}`;
    }
  }

  return { synced: totalSynced, accounts: perAccount };
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

    const { max = 25, purpose, all_orgs } = await req.json().catch(() => ({}));

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Modo cron: chamado com a service role key, sincroniza todas as orgs que
    // têm conta conectada. É o que substitui o botão manual na Inbox.
    const token = authHeader.replace("Bearer ", "");
    const ehServico = token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (all_orgs) {
      if (!ehServico) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: orgs } = await supabaseAdmin
        .from("email_connections")
        .select("org_id")
        .eq("provider", "gmail")
        .eq("is_active", true);

      const unicas = [...new Set((orgs ?? []).map((o: { org_id: string }) => o.org_id))];
      const resultado: Record<string, unknown> = {};
      for (const oid of unicas) {
        try {
          resultado[oid] = await syncOrg(supabaseAdmin, oid, Number(max) || 25, undefined);
        } catch (e) {
          resultado[oid] = `error: ${(e as Error).message}`;
        }
      }
      return new Response(JSON.stringify({ scheduled: true, orgs: resultado }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Modo usuário: sincroniza a org de quem chamou.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Derive org_id server-side from authenticated profile
    const { data: callerProfile } = await supabaseAdmin
      .from("profiles").select("org_id").eq("id", userData.user.id).maybeSingle();
    const org_id = callerProfile?.org_id;
    if (!org_id) {
      return new Response(JSON.stringify({ error: "No organization" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: cfgRow } = await supabaseAdmin
      .from("integration_configs")
      .select("config, is_active")
      .eq("org_id", org_id)
      .eq("provider", "gmail")
      .maybeSingle();
    /*
      O MODO "connector" SAIU, e com ele a leitura de `cfg.mode`.

      Era o caminho legado: uma caixa de e-mail única do projeto, servida pelo
      gateway da Lovable com `LOVABLE_API_KEY`. Este CRM não usa a Lovable, e
      sem a chave o ramo já respondia `gmail_not_linked` -- ou seja, quem
      tivesse `mode: "connector"` gravado não sincronizava de jeito nenhum.

      Removê-lo troca um erro pelo caminho que funciona: o OAuth por conta, que
      é o padrão e o único que a tela de Integrações configura. Sobra um caminho
      só, então não há mais o que ramificar.
    */

    // ── Sincroniza todas as contas conectadas da org ──
    const resultado = await syncOrg(supabaseAdmin, org_id, Number(max) || 25, purpose);

    if (Object.keys(resultado.accounts).length === 0) {
      return new Response(JSON.stringify({
        error: "gmail_not_connected",
        message: "Nenhuma conta Gmail conectada. Conecte a sua em Configurações › Meu e-mail.",
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, ...resultado }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("gmail-sync error:", err);
    return new Response(JSON.stringify({ error: "internal_error", message: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
