import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";
import { createLogger } from "../_shared/logger.ts";
import { sendViaOrgAccount, renderTemplate } from "../_shared/gmail-sender.ts";
import {
  carregarCredencial,
  explicarAusencia,
  resolverProvedor,
} from "../_shared/whatsapp/index.ts";

const log = createLogger("process-automation");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Avalia condições + executa ações de UMA automação, com stats e log. */
async function runAutomation(supabase: any, auto: any, trigger_payload: any): Promise<{ status: string; actions?: any[] }> {
  const start = Date.now();
  const org_id = auto.org_id;

  // Evaluate conditions (simplified)
  const conditions = auto.conditions || [];
  let conditionsMet = true;
  for (const cond of conditions) {
    const fieldVal = trigger_payload?.[cond.field];
    switch (cond.operator) {
      case "equals":
        if (String(fieldVal) !== String(cond.value)) conditionsMet = false;
        break;
      case "not_equals":
        if (String(fieldVal) === String(cond.value)) conditionsMet = false;
        break;
      case "greater_than":
        if (Number(fieldVal) <= Number(cond.value)) conditionsMet = false;
        break;
      case "less_than":
        if (Number(fieldVal) >= Number(cond.value)) conditionsMet = false;
        break;
      case "contains":
        if (!String(fieldVal).includes(String(cond.value))) conditionsMet = false;
        break;
      case "not_contains":
        if (String(fieldVal).includes(String(cond.value))) conditionsMet = false;
        break;
    }
    if (!conditionsMet) break;
  }

  if (!conditionsMet) {
    await supabase.from("automation_logs").insert({
      org_id,
      automation_id: auto.id,
      status: "skipped",
      trigger_payload,
      actions_result: { reason: "Conditions not met" },
      duration_ms: Date.now() - start,
    });
    return { status: "skipped" };
  }

  // Execute actions sequentially
  const actionsResult: any[] = [];
  for (const action of auto.actions || []) {
    try {
      const result = await executeAction(supabase, org_id, action, trigger_payload);
      actionsResult.push({ type: action.type, status: "ok", result });
    } catch (err: any) {
      actionsResult.push({ type: action.type, status: "error", error: err.message });
      // Continue executing remaining actions
    }
  }

  const hasErrors = actionsResult.some((r) => r.status === "error");
  const duration = Date.now() - start;

  await supabase
    .from("automations")
    .update({
      run_count: (auto.run_count || 0) + 1,
      error_count: hasErrors ? (auto.error_count || 0) + 1 : auto.error_count,
      last_run_at: new Date().toISOString(),
    })
    .eq("id", auto.id);

  await supabase.from("automation_logs").insert({
    org_id,
    automation_id: auto.id,
    status: hasErrors ? "partial_error" : "success",
    trigger_payload,
    actions_result: actionsResult,
    duration_ms: duration,
    error_message: hasErrors
      ? actionsResult.filter((r) => r.status === "error").map((r) => r.error).join("; ")
      : null,
  });

  return { status: hasErrors ? "partial_error" : "success", actions: actionsResult };
}

/** Uma automação casa com um evento da fila? (mapeamento gatilho × evento) */
function automationMatchesEvent(auto: any, event: { event_type: string; payload: any }): boolean {
  const t = auto.trigger?.type as string;
  const cfg = auto.trigger?.config || {};
  const p = event.payload || {};

  switch (event.event_type) {
    case "contact.created":
      return t === "contact.created";
    case "contact.updated": {
      if (t === "contact.updated") return true;
      if (t === "field.changed") {
        const changed: string[] = Array.isArray(p.changed_fields) ? p.changed_fields : [];
        return !cfg.field || changed.includes(cfg.field);
      }
      if (t === "score.threshold") {
        const threshold = Number(cfg.threshold ?? 70);
        const oldScore = Number(p.old_lead_score ?? 0);
        const newScore = Number(p.lead_score ?? 0);
        return (cfg.direction === "below")
          ? oldScore > threshold && newScore <= threshold
          : oldScore < threshold && newScore >= threshold;
      }
      return false;
    }
    case "deal.stage_changed":
      return t === "deal.stage_changed";
    case "deal.won":
      return t === "deal.won";
    case "deal.lost":
      return t === "deal.lost";
    case "activity.created":
      return t === "activity.created";
    default:
      return false;
  }
}

/** Modo agendado (cron): drena a fila de eventos + gatilhos de data relativa */
async function runScheduledBatch(supabase: any) {
  const summary = { events: 0, executed: 0, date_relative: 0 };

  // 1. Eventos pendentes
  const { data: events } = await supabase
    .from("automation_events")
    .select("*")
    .is("processed_at", null)
    .order("created_at", { ascending: true })
    .limit(100);

  if (events?.length) {
    const { data: autos } = await supabase
      .from("automations")
      .select("*")
      .eq("is_active", true);

    for (const event of events) {
      const matching = (autos || []).filter(
        (a: any) => a.org_id === event.org_id && automationMatchesEvent(a, event)
      );
      for (const auto of matching) {
        try {
          await runAutomation(supabase, auto, event.payload);
          summary.executed++;
        } catch (e) {
          console.error("automation run failed", auto.id, e);
        }
      }
      await supabase
        .from("automation_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", event.id);
      summary.events++;
    }
  }

  // 2. Gatilhos de data relativa (inatividade) — avaliados a cada execução
  const { data: dateAutos } = await supabase
    .from("automations")
    .select("*")
    .eq("is_active", true)
    .eq("trigger->>type", "date.relative");

  for (const auto of dateAutos || []) {
    const cfg = auto.trigger?.config || {};
    const daysInactive = Number(cfg.days_inactive ?? 14);
    const cutoff = new Date(Date.now() - daysInactive * 86_400_000).toISOString();
    const entity = cfg.entity === "deal" ? "deals" : "contacts";
    const idKey = cfg.entity === "deal" ? "deal_id" : "contact_id";

    const { data: stale } = await supabase
      .from(entity)
      .select("id")
      .eq("org_id", auto.org_id)
      .lt("updated_at", cutoff)
      .limit(20);

    for (const row of stale || []) {
      // Dedup: não dispara de novo para a mesma entidade nos últimos 7 dias
      const { data: prior } = await supabase
        .from("automation_logs")
        .select("id")
        .eq("automation_id", auto.id)
        .eq(`trigger_payload->>${idKey}`, row.id)
        .gte("executed_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
        .limit(1);
      if (prior?.length) continue;

      try {
        await runAutomation(supabase, auto, { [idKey]: row.id, days_inactive: daysInactive });
        summary.date_relative++;
      } catch (e) {
        console.error("date.relative run failed", auto.id, e);
      }
    }
  }

  return summary;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const bearer = authHeader.replace("Bearer ", "").trim();

    const body = await req.json().catch(() => ({}));

    // ── Modo agendado (pg_cron chama com a service role key) ──
    if (body.scheduled === true) {
      if (bearer !== serviceKey) return json({ error: "Unauthorized" }, 401);
      const summary = await runScheduledBatch(supabase);
      return json({ ok: true, ...summary });
    }

    // ── Modo manual (usuário autenticado dispara uma automação específica) ──
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const { data: profile } = await supabase.from("profiles").select("org_id").eq("id", userData.user.id).maybeSingle();
    const callerOrgId = profile?.org_id;
    if (!callerOrgId) return json({ error: "No organization" }, 403);

    const { automation_id, trigger_payload } = body;
    if (!automation_id) return json({ error: "Missing automation_id" }, 400);

    const { data: auto, error: autoErr } = await supabase
      .from("automations")
      .select("*")
      .eq("id", automation_id)
      .eq("org_id", callerOrgId)
      .maybeSingle();

    if (autoErr || !auto) return json({ error: "Automation not found" }, 404);
    if (!auto.is_active) return json({ error: "Automation is not active" }, 400);

    const result = await runAutomation(supabase, auto, trigger_payload);
    return json(result);
  } catch (err: any) {
    await captureException(err, { functionName: "process-automation" });
    log.error("automation failed", { message: err?.message });
    return json({ error: err.message }, 500);
  }
});

async function executeAction(supabase: any, orgId: string, action: any, payload: any) {
  const cfg = action.config || {};

  switch (action.type) {
    case "create_task": {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (cfg.due_days || 1));
      const { error } = await supabase.from("activities").insert({
        org_id: orgId,
        type: "task",
        title: cfg.title || "Tarefa automática",
        body: cfg.body || `Criada pela automação. Prioridade: ${cfg.priority || "medium"}`,
        due_date: dueDate.toISOString(),
        deal_id: payload?.deal_id || null,
        contact_id: payload?.contact_id || null,
        company_id: payload?.company_id || null,
      });
      if (error) throw new Error(`create_task: ${error.message}`);
      return { created: true };
    }

    case "create_note": {
      const { error } = await supabase.from("activities").insert({
        org_id: orgId,
        type: "note",
        title: "Nota automática",
        body: cfg.body || "Nota criada por automação",
        deal_id: payload?.deal_id || null,
        contact_id: payload?.contact_id || null,
      });
      if (error) throw new Error(`create_note: ${error.message}`);
      return { created: true };
    }

    case "move_deal_stage": {
      if (!payload?.deal_id) throw new Error("No deal_id in payload");
      // Find stage by name
      const { data: stages } = await supabase
        .from("pipeline_stages")
        .select("id,name")
        .eq("org_id", orgId)
        .ilike("name", `%${cfg.to_stage}%`)
        .limit(1);
      const stageId = stages?.[0]?.id;
      if (!stageId) throw new Error(`Stage '${cfg.to_stage}' not found`);
      const { error } = await supabase.from("deals").update({ stage_id: stageId }).eq("id", payload.deal_id);
      if (error) throw new Error(`move_deal_stage: ${error.message}`);
      return { moved_to: stageId };
    }

    case "assign_owner": {
      const entityTable = payload?.deal_id ? "deals" : payload?.contact_id ? "contacts" : null;
      const entityId = payload?.deal_id || payload?.contact_id;
      if (!entityTable || !entityId) throw new Error("No entity to assign");

      let ownerId = cfg.user_id;
      if (cfg.strategy === "round_robin") {
        const { data: members } = await supabase.from("profiles").select("id").eq("org_id", orgId);
        if (members?.length) {
          ownerId = members[Math.floor(Math.random() * members.length)].id;
        }
      }
      if (!ownerId) throw new Error("No owner to assign");
      const { error } = await supabase.from(entityTable).update({ owner_id: ownerId }).eq("id", entityId);
      if (error) throw new Error(`assign_owner: ${error.message}`);
      return { assigned: ownerId };
    }

    case "add_tag": {
      if (!cfg.tag_name) throw new Error("No tag name");
      // Find or create tag
      let { data: existing } = await supabase.from("tags").select("id").eq("org_id", orgId).eq("name", cfg.tag_name).single();
      if (!existing) {
        const { data: created, error } = await supabase.from("tags").insert({ org_id: orgId, name: cfg.tag_name }).select("id").single();
        if (error) throw new Error(`add_tag create: ${error.message}`);
        existing = created;
      }
      if (payload?.deal_id) {
        await supabase.from("deal_tags").insert({ deal_id: payload.deal_id, tag_id: existing.id });
      } else if (payload?.contact_id) {
        await supabase.from("contact_tags").insert({ contact_id: payload.contact_id, tag_id: existing.id });
      }
      return { tag_added: cfg.tag_name };
    }

    case "call_webhook": {
      if (!cfg.url) throw new Error("No webhook URL");
      // SSRF protection: only allow HTTPS to public hosts
      let parsed: URL;
      try { parsed = new URL(cfg.url); } catch { throw new Error("Invalid webhook URL"); }
      if (parsed.protocol !== "https:") throw new Error("Only HTTPS webhook URLs are allowed");
      const host = parsed.hostname.toLowerCase();
      const blockedPrefixes = ["169.254.", "10.", "127.", "192.168.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.", "0."];
      const blockedExact = ["localhost", "::1", "metadata.google.internal"];
      if (blockedExact.includes(host) || blockedPrefixes.some((p) => host.startsWith(p)) || host.endsWith(".internal") || host.endsWith(".local")) {
        throw new Error("Webhook host not allowed");
      }
      const resp = await fetch(cfg.url, {
        method: cfg.method || "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, automation_action: action.type }),
        redirect: "manual",
      });
      const text = await resp.text();
      return { status: resp.status, body: text.slice(0, 500) };
    }

    case "wait": {
      // In a real system, this would schedule the next action
      // For now, just log the delay
      return { delay_days: cfg.days || 1, note: "Delay logged; real scheduling requires pg_cron" };
    }

    case "notify_user":
      // Placeholder: in production, use push/email/slack
      return { notified: true, message: cfg.message };

    /**
     * Envio de WhatsApp pela automação.
     *
     * ERA CÓDIGO MORTO. Lia `whatsapp_instances` e escrevia
     * `whatsapp_conversations` — as duas apagadas por 20260513181405 — e
     * gravava `content`/`type`/`is_ai` em `whatsapp_messages`, que hoje tem
     * `body`/`message_type`. Toda automação com ação de WhatsApp morria em
     * "Nenhuma instância WhatsApp ativa encontrada". O comentário de
     * `_shared/whatsapp/types.ts` já nomeava este arquivo como a sobra.
     *
     * Agora passa pelo MESMO caminho de `whatsapp-send`: credencial da
     * organização por `carregarCredencial`, número por `whatsapp_connections`
     * e envio pelo contrato de provedor. Sem variável de ambiente nova.
     */
    case "send_whatsapp": {
      let phone = cfg.phone_override || "";
      let contactId: string | null = null;
      // De quem é o contato: define por qual número a mensagem sai.
      let donoDoContato: string | null = null;
      // Local, e não `cfg.message`: o objeto da ação é o MESMO em toda a
      // rodada do lote, então escrever nele fazia o segundo contato receber a
      // mensagem já personalizada com o nome do primeiro.
      let mensagem = cfg.message || "";

      if (cfg.phone_source === "contact" && payload?.contact_id) {
        const { data: contact } = await supabase
          .from("contacts")
          .select("id, phone, first_name, last_name, owner_id, descadastrado_em")
          .eq("id", payload.contact_id)
          .single();
        if (!contact?.phone) throw new Error("Contato sem telefone cadastrado");
        if (contact.descadastrado_em) throw new Error("Contato não autoriza contato comercial (LGPD)");
        phone = contact.phone;
        contactId = contact.id;
        donoDoContato = contact.owner_id ?? null;
        mensagem = mensagem.replace(
          /\{\{nome\}\}/g,
          `${contact.first_name || ""} ${contact.last_name || ""}`.trim(),
        );
      }
      if (!phone) throw new Error("Nenhum telefone definido para envio");
      if (!mensagem) mensagem = "Mensagem automática";

      const credencial = await carregarCredencial(supabase, orgId);
      if (!credencial.ok) throw new Error(explicarAusencia(credencial.motivo));

      // Automação não tem sessão de usuário, então não há "a conexão de quem
      // clicou". Sai pelo número do DONO do contato quando ele tem um — é o
      // número que a pessoa já reconhece — e por qualquer conexão ativa da
      // organização quando não tem.
      const { data: conexoes } = await supabase
        .from("whatsapp_connections")
        .select("id, user_id, phone_number_id, instance_name, display_phone_number")
        .eq("org_id", orgId)
        .eq("is_active", true);

      const ativas = (conexoes || []) as any[];
      if (!ativas.length) {
        throw new Error("Nenhum número de WhatsApp conectado nesta organização. Conecte um em Integrações.");
      }
      const conexao =
        (donoDoContato && ativas.find((c) => c.user_id === donoDoContato)) || ativas[0];

      const destino = String(phone).replace(/\D/g, "");
      const prov = resolverProvedor(credencial.cred.provider);
      const envio = await prov.enviarTexto(
        credencial.cred,
        {
          // Meta: phone_number_id. Evolution: nome da instância. Mesma
          // preferência de `whatsapp-send`.
          origem: (conexao.instance_name as string | null) ?? (conexao.phone_number_id as string),
          para: destino,
        },
        mensagem,
      );

      /** Sem registro, a conversa não mostra a mensagem e o painel não a conta. */
      const registrar = (campos: Record<string, unknown>) =>
        supabase.from("whatsapp_messages").insert({
          org_id: orgId,
          contact_id: contactId,
          deal_id: payload?.deal_id || null,
          user_id: conexao.user_id,
          connection_id: conexao.id,
          direction: "outbound",
          from_number: (conexao.display_phone_number as string | null) ?? "",
          to_number: destino,
          body: mensagem,
          message_type: "text",
          ...campos,
        });

      if (!envio.ok) {
        await registrar({
          status: "failed",
          error_message: (envio.erro ?? "").slice(0, 500),
          raw: envio.bruto,
        });
        throw new Error(`send_whatsapp: ${envio.erro ?? "falha no envio"}`);
      }

      const { error: erroDoRegistro } = await registrar({
        wa_message_id: envio.idMensagem,
        status: "sent",
        raw: envio.bruto,
      });

      // A MENSAGEM JÁ CHEGOU AO LEAD. Lançar por falha de gravação faria o log
      // da automação acusar erro para um envio que deu certo — e alguém
      // reenviaria à mão. O prejuízo (linha faltando na conversa) vai no
      // resultado da ação, onde dá para ver sem virar "erro".
      return {
        sent: true,
        phone: destino,
        wa_message_id: envio.idMensagem,
        ...(erroDoRegistro ? { log_error: erroDoRegistro.message } : {}),
      };
    }

    case "send_email_template": {
      if (!payload?.contact_id) throw new Error("Sem contato para enviar e-mail");
      const { data: contact } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, email, descadastrado_em")
        .eq("id", payload.contact_id)
        .maybeSingle();
      if (!contact?.email) throw new Error("Contato sem e-mail cadastrado");
      if (contact.descadastrado_em) throw new Error("Contato não autoriza contato comercial (LGPD)");

      let subject = cfg.subject || "";
      let bodyHtml = cfg.body_html || "";
      if (cfg.template_id) {
        const { data: tpl } = await supabase
          .from("email_templates")
          .select("subject, body_html")
          .eq("id", cfg.template_id)
          .maybeSingle();
        if (!tpl) throw new Error("Template de e-mail não encontrado");
        subject = tpl.subject || subject;
        bodyHtml = tpl.body_html || bodyHtml;
      }
      if (!subject || !bodyHtml) throw new Error("Template sem assunto ou corpo");

      const { id } = await sendViaOrgAccount(supabase, {
        orgId,
        to: contact.email,
        subject: renderTemplate(subject, contact),
        html: renderTemplate(bodyHtml, contact),
        purpose: "sales",
        contactId: contact.id,
        dealId: payload?.deal_id ?? null,
      });
      return { sent: true, email_id: id };
    }

    case "remove_tag":
      return { tag_removed: cfg.tag_name, note: "Remove tag not fully implemented" };

    default:
      return { note: `Action type '${action.type}' not implemented` };
  }
}
