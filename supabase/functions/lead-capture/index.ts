import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fireWebhooks } from "../_shared/fire-webhooks.ts";
import { captureException } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function verifyApiKey(sb: ReturnType<typeof createClient>, apiKey: string) {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(apiKey));
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { data: keyRecord, error } = await sb
    .from("api_keys")
    .select("id, org_id, is_active, request_count")
    .eq("key_hash", hashHex)
    .eq("is_active", true)
    .single();

  if (error || !keyRecord) return null;

  await sb
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString(), request_count: (keyRecord.request_count ?? 0) + 1 })
    .eq("id", keyRecord.id);

  return keyRecord.org_id as string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Accept API key via X-Api-Key header or Bearer token
  const apiKeyHeader = req.headers.get("X-Api-Key") || req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!apiKeyHeader) {
    return new Response(JSON.stringify({ error: "API key required. Use X-Api-Key header." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const orgId = await verifyApiKey(sb, apiKeyHeader);
  if (!orgId) {
    return new Response(JSON.stringify({ error: "Invalid or revoked API key" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const {
    name,
    first_name,
    last_name,
    email,
    phone,
    title,
    company,
    source,
    notes,
    pipeline_id,
    deal_name,
    deal_value,
    tags,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    custom_fields,
  } = body as {
    name?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    title?: string;
    company?: string;
    source?: string;
    notes?: string;
    pipeline_id?: string;
    deal_name?: string;
    deal_value?: number;
    tags?: string[];
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
    custom_fields?: Record<string, unknown>;
  };

  // Resolve first/last name
  let resolvedFirstName = first_name || "";
  let resolvedLastName = last_name || "";
  if (!resolvedFirstName && name) {
    const parts = (name as string).trim().split(/\s+/);
    resolvedFirstName = parts[0];
    resolvedLastName = parts.slice(1).join(" ");
  }

  if (!resolvedFirstName) {
    return new Response(JSON.stringify({ error: "name or first_name is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Build metadata with UTM params, source, and notes
  const metadata: Record<string, unknown> = { ...(custom_fields ?? {}) };
  if (source) metadata.source = source;
  if (notes) metadata.notes = notes;
  if (utm_source) metadata.utm_source = utm_source;
  if (utm_medium) metadata.utm_medium = utm_medium;
  if (utm_campaign) metadata.utm_campaign = utm_campaign;
  if (utm_content) metadata.utm_content = utm_content;
  if (utm_term) metadata.utm_term = utm_term;

  // Create contact
  const contactPayload: Record<string, unknown> = {
    org_id: orgId,
    first_name: resolvedFirstName,
    last_name: resolvedLastName || null,
    email: email || null,
    phone: phone || null,
    title: title || null, // especialidade / cargo
    // Sem `status`: o default da coluna é 'lead'. Escrever a coluna legada é o
    // caminho por onde o ciclo de vida acaba sobrescrito sem querer.
    metadata,
  };

  const { data: contact, error: contactError } = await sb
    .from("contacts")
    .insert(contactPayload)
    .select("id, first_name, last_name, email, phone, status")
    .single();

  if (contactError) {
    return new Response(JSON.stringify({ error: contactError.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let companyId: string | null = null;
  // Create or link company if provided
  if (company) {
    const { data: existingCompany } = await sb
      .from("companies")
      .select("id")
      .eq("org_id", orgId)
      .ilike("name", company)
      .maybeSingle();

    if (existingCompany) {
      companyId = existingCompany.id;
    } else {
      const { data: newCompany } = await sb
        .from("companies")
        .insert({ org_id: orgId, name: company })
        .select("id")
        .single();
      companyId = newCompany?.id ?? null;
    }

    if (companyId) {
      await sb.from("contacts").update({ company_id: companyId }).eq("id", contact.id);
    }
  }

  // Apply tags
  if (Array.isArray(tags) && tags.length > 0) {
    for (const tagName of tags) {
      if (typeof tagName !== "string" || !tagName.trim()) continue;

      // Upsert tag
      const { data: tag } = await sb
        .from("tags")
        .upsert({ org_id: orgId, name: tagName.trim() }, { onConflict: "org_id,name" })
        .select("id")
        .single();

      if (tag) {
        await sb.from("contact_tags").upsert({ contact_id: contact.id, tag_id: tag.id });
      }
    }
  }

  // Negócio só quando o chamador PEDE.
  //
  // Antes toda captação criava um negócio no funil de entrada, com o argumento
  // de que o lead precisa de onde guardar estágio, preço e objeção. O custo era
  // maior que o benefício: quem preenche um formulário ainda não foi avaliado
  // por ninguém, e cada envio virava uma oportunidade em aberto -- inflando o
  // valor total do funil e a contagem de oportunidades com gente que ninguém
  // olhou. Esses campos passam a existir quando alguém qualifica, pela RPC
  // qualify_lead, que é onde a decisão de fato acontece.
  //
  // Também era a única entrada que se comportava diferente das outras (modal,
  // CSV, WhatsApp, API pública), o que dava duas regras para explicar.
  //
  // Passar `pipeline_id`, `deal_name` ou `deal_value` continua criando o
  // negócio: aí é pedido explícito, não suposição. Integração que dependia
  // disso segue funcionando ao nomear o que quer.
  const querNegocio = Boolean(pipeline_id || deal_name || deal_value !== undefined);

  let resolvedPipelineId: string | null = querNegocio ? (pipeline_id ?? null) : null;
  if (querNegocio && !resolvedPipelineId) {
    const { data: defaultPipeline } = await sb
      .from("pipelines")
      .select("id")
      .eq("org_id", orgId)
      .eq("is_default", true)
      .limit(1)
      .maybeSingle();
    resolvedPipelineId = defaultPipeline?.id ?? null;
  }

  let dealId: string | null = null;
  if (resolvedPipelineId) {
    // Get first stage of the pipeline
    const { data: firstStage } = await sb
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", resolvedPipelineId)
      .eq("org_id", orgId)
      .order("order", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (firstStage) {
      const fullName = [resolvedFirstName, resolvedLastName].filter(Boolean).join(" ");
      const { data: deal, error: dealError } = await sb
        .from("deals")
        .insert({
          org_id: orgId,
          title: deal_name || `Lead: ${fullName}`,
          value: deal_value ?? 0,
          stage_id: firstStage.id,
          contact_id: contact.id,
          company_id: companyId,
          status: "open",
        })
        .select("id")
        .single();

      if (!dealError && deal) {
        dealId = deal.id;
        // Fire deal.created webhook
        await fireWebhooks(sb, orgId, "deal.created", {
          deal_id: deal.id,
          contact_id: contact.id,
          pipeline_id: resolvedPipelineId,
          source: source ?? null,
        });
      }
    }
  }

  // Fire contact.created webhook
  await fireWebhooks(sb, orgId, "contact.created", {
    contact_id: contact.id,
    email: email ?? null,
    name: [resolvedFirstName, resolvedLastName].filter(Boolean).join(" "),
    source: source ?? null,
    utm_source: utm_source ?? null,
    utm_campaign: utm_campaign ?? null,
    deal_id: dealId,
  });

  return new Response(
    JSON.stringify({
      success: true,
      contact_id: contact.id,
      deal_id: dealId,
    }),
    {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
  } catch (err) {
    await captureException(err, { functionName: "lead-capture" });
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
