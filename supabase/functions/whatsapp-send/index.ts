/**
 * Envio de WhatsApp.
 *
 * Passou a falar com o PROVEDOR em vez de com a Graph API. Antes esta função
 * cravava `graph.facebook.com`, lia a tabela antiga `whatsapp_config` e pegava o
 * token de `META_WHATSAPP_TOKEN` no ambiente — enquanto o resto do sistema já
 * usava whatsapp_business_accounts + whatsapp_secrets e o contrato de provedor.
 * Duas pilhas paralelas, e a ligada era a antiga.
 *
 * O CAMINHO LEGADO CONTINUA, E É DE PROPÓSITO
 *
 * Quem já usa a Meta não tem linha em `whatsapp_connections`: o número é da
 * organização, em `whatsapp_config`. Exigir conexão pessoal derrubaria o envio
 * dessas empresas no deploy. Então: se a pessoa tem conexão, usa o provedor; se
 * não tem e existe `whatsapp_config`, segue pelo caminho antigo.
 *
 * O caminho legado morre quando toda organização tiver migrado. Está marcado
 * abaixo para ser fácil de achar e apagar.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { captureException } from "../_shared/sentry.ts";
import {
  carregarCredencial,
  explicarAusencia,
  resolverProvedor,
} from "../_shared/whatsapp/index.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const normalize = (phone: string) => phone.replace(/\D/g, "");

type Template = { name: string; language: string; components?: unknown[] };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: claims, error: cErr } = await supabase.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (cErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const to = normalize(String(body.to || ""));
    const text = body.text ? String(body.text).slice(0, 4000) : null;
    const template = body.template as Template | undefined;
    const contactId = body.contactId || null;
    const dealId = body.dealId || null;

    if (!to || (!text && !template)) {
      return json({ error: 'Missing "to" and ("text" or "template")' }, 400);
    }

    const { data: prof } = await admin
      .from("profiles").select("org_id").eq("id", userId).maybeSingle();
    const orgId = prof?.org_id;
    if (!orgId) return json({ error: "No organization" }, 400);

    const corpoMensagem = text || `[template:${template?.name}]`;
    const tipoMensagem = template ? "template" : "text";

    /** Grava o que aconteceu, dando certo ou não. Um envio sem registro é um
     *  envio que a conversa não mostra e o painel não conta. */
    const registrar = (campos: Record<string, unknown>) =>
      admin.from("whatsapp_messages").insert({
        org_id: orgId,
        contact_id: contactId,
        deal_id: dealId,
        direction: "outbound",
        to_number: to,
        body: corpoMensagem,
        message_type: tipoMensagem,
        ...campos,
      });

    // ---------- caminho novo: conexão da pessoa + provedor ----------
    const { data: conexao } = await admin
      .from("whatsapp_connections")
      .select("id, phone_number_id, instance_name, display_phone_number, provider")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (conexao) {
      const credencial = await carregarCredencial(admin, orgId);
      if (!credencial.ok) {
        return json({ error: explicarAusencia(credencial.motivo) }, 400);
      }

      const prov = resolverProvedor(credencial.cred.provider);
      const rota = {
        // Na Meta é o phone_number_id; na Evolution é o nome da instância. As
        // duas colunas guardam o mesmo valor quando o provedor é a Evolution,
        // então preferir `instance_name` quando existe é só clareza.
        origem: (conexao.instance_name as string | null) ?? (conexao.phone_number_id as string),
        para: to,
      };

      const r = template
        ? await prov.enviarTemplate(credencial.cred, rota, {
            name: template.name,
            language: template.language,
            components: template.components,
          })
        : await prov.enviarTexto(credencial.cred, rota, text!);

      const de = (conexao.display_phone_number as string | null) ?? "";

      if (!r.ok) {
        await registrar({
          user_id: userId,
          connection_id: conexao.id,
          from_number: de,
          status: "failed",
          error_message: (r.erro ?? "").slice(0, 500),
          raw: r.bruto,
        });
        return json({ error: r.erro ?? "Falha no envio", details: r.bruto }, 400);
      }

      await registrar({
        user_id: userId,
        connection_id: conexao.id,
        from_number: de,
        wa_message_id: r.idMensagem,
        status: "sent",
        raw: r.bruto,
      });
      return json({ ok: true, wa_message_id: r.idMensagem });
    }

    // ---------- LEGADO: número da organização em whatsapp_config ----------
    // Apagar quando toda organização tiver conexão pessoal. Só serve à Meta.
    const { data: cfg } = await admin
      .from("whatsapp_config").select("*").eq("org_id", orgId).maybeSingle();

    if (!cfg || !cfg.is_active) {
      return json({
        error: "Você ainda não conectou um número de WhatsApp. Vá em Integrações para conectar.",
      }, 400);
    }

    const META_TOKEN = Deno.env.get("META_WHATSAPP_TOKEN") || Deno.env.get("META_ACCESS_TOKEN");
    if (!META_TOKEN) return json({ error: "META_WHATSAPP_TOKEN não configurado" }, 500);

    const payload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to,
      recipient_type: "individual",
      ...(template
        ? {
            type: "template",
            template: {
              name: template.name,
              language: { code: template.language || "pt_BR" },
              components: template.components || [],
            },
          }
        : { type: "text", text: { body: text } }),
    };

    const resp = await fetch(`${GRAPH}/${cfg.phone_number_id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${META_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const respJson = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      await registrar({
        user_id: userId,
        from_number: cfg.display_phone_number || "",
        status: "failed",
        error_message: JSON.stringify(respJson).slice(0, 500),
        raw: respJson,
      });
      return json({ error: "Meta API error", details: respJson }, 400);
    }

    const wamid = respJson?.messages?.[0]?.id || null;
    await registrar({
      user_id: userId,
      from_number: cfg.display_phone_number || "",
      wa_message_id: wamid,
      status: "sent",
      raw: respJson,
    });

    return json({ ok: true, wa_message_id: wamid });
  } catch (e) {
    await captureException(e, { functionName: "whatsapp-send" });
    console.error("whatsapp-send error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
