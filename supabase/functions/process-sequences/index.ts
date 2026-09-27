import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendViaOrgAccount, renderTemplate } from "../_shared/gmail-sender.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * Worker de SEQUÊNCIAS DE E-MAIL — a peça que faltava para as cadências
 * criadas em /email-sequences realmente enviarem.
 *
 * Chamado pelo pg_cron a cada 10 min (migration 20260702140000) com a
 * service role key. Processa inscrições (enrollments) vencidas:
 * envia o passo atual pela conta Gmail COMERCIAL da org, agenda o próximo
 * passo e marca como concluída quando a sequência acaba.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader.replace("Bearer ", "").trim() !== serviceKey) {
      return json({ error: "Unauthorized" }, 401);
    }

    const now = new Date().toISOString();
    const { data: due } = await admin
      .from("email_sequence_enrollments")
      .select("*")
      .eq("status", "active")
      .lte("next_send_at", now)
      .order("next_send_at", { ascending: true })
      .limit(50);

    const summary = { processed: 0, sent: 0, completed: 0, errors: [] as string[] };

    for (const enrollment of due ?? []) {
      summary.processed++;
      try {
        // Sequência ainda ativa?
        const { data: seq } = await admin
          .from("email_sequences")
          .select("id, is_active")
          .eq("id", enrollment.sequence_id)
          .maybeSingle();
        if (!seq?.is_active) {
          await admin.from("email_sequence_enrollments")
            .update({ status: "paused" }).eq("id", enrollment.id);
          continue;
        }

        const { data: steps } = await admin
          .from("email_sequence_steps")
          .select("*")
          .eq("sequence_id", enrollment.sequence_id)
          .order("step_order", { ascending: true });

        const step = (steps ?? [])[enrollment.current_step ?? 0];
        if (!step) {
          await admin.from("email_sequence_enrollments")
            .update({ status: "completed", completed_at: now }).eq("id", enrollment.id);
          summary.completed++;
          continue;
        }

        const { data: contact } = await admin
          .from("contacts")
          .select("id, first_name, last_name, email, descadastrado_em")
          .eq("id", enrollment.contact_id)
          .maybeSingle();
        if (!contact?.email) {
          await admin.from("email_sequence_enrollments")
            .update({ status: "bounced" }).eq("id", enrollment.id);
          summary.errors.push(`enrollment ${enrollment.id}: contato sem e-mail`);
          continue;
        }

        // LGPD: quem revogou (ou nunca deu) autorização sai da sequência em
        // vez de receber o próximo passo. Cancela em vez de pausar porque
        // retomar exigiria um novo consentimento, não um religar de botão.
        if (contact.descadastrado_em) {
          await admin.from("email_sequence_enrollments")
            .update({ status: "cancelled" }).eq("id", enrollment.id);
          summary.errors.push(`enrollment ${enrollment.id}: contato descadastrado`);
          continue;
        }

        // Assunto/corpo: do passo, ou do template referenciado
        let subject = step.subject || "";
        let bodyHtml = step.body_html || "";
        if (step.template_id && (!subject || !bodyHtml)) {
          const { data: tpl } = await admin
            .from("email_templates")
            .select("subject, body_html")
            .eq("id", step.template_id)
            .maybeSingle();
          subject = subject || tpl?.subject || "";
          bodyHtml = bodyHtml || tpl?.body_html || "";
        }
        if (!subject || !bodyHtml) {
          summary.errors.push(`enrollment ${enrollment.id}: passo ${step.step_order} sem assunto/corpo`);
          // Pula o passo defeituoso para não travar a fila para sempre
          await advanceEnrollment(admin, enrollment, steps ?? [], now);
          continue;
        }

        await sendViaOrgAccount(admin, {
          orgId: enrollment.org_id,
          to: contact.email,
          subject: renderTemplate(subject, contact),
          html: renderTemplate(bodyHtml, contact),
          purpose: "sales",
          contactId: contact.id,
        });
        summary.sent++;

        const { completed } = await advanceEnrollment(admin, enrollment, steps ?? [], now);
        if (completed) summary.completed++;
      } catch (e) {
        summary.errors.push(`enrollment ${enrollment.id}: ${(e as Error).message}`);
        // Reagenda para +1h para não tentar em loop a cada execução
        await admin.from("email_sequence_enrollments")
          .update({ next_send_at: new Date(Date.now() + 3_600_000).toISOString() })
          .eq("id", enrollment.id);
      }
    }

    return json({ ok: true, ...summary });
  } catch (err) {
    console.error("process-sequences error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

/** Avança para o próximo passo (agenda pelo delay) ou conclui a inscrição */
async function advanceEnrollment(
  admin: any,
  enrollment: any,
  steps: any[],
  nowIso: string,
): Promise<{ completed: boolean }> {
  const nextIndex = (enrollment.current_step ?? 0) + 1;
  const nextStep = steps[nextIndex];
  if (!nextStep) {
    await admin.from("email_sequence_enrollments")
      .update({ current_step: nextIndex, status: "completed", completed_at: nowIso })
      .eq("id", enrollment.id);
    return { completed: true };
  }
  const nextSend = new Date(Date.now() + (Number(nextStep.delay_days) || 0) * 86_400_000).toISOString();
  await admin.from("email_sequence_enrollments")
    .update({ current_step: nextIndex, next_send_at: nextSend })
    .eq("id", enrollment.id);
  return { completed: false };
}
