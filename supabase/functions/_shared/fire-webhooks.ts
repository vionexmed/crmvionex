import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * A URL do webhook é escolhida por quem administra a organização, e a chamada
 * sai de DENTRO da rede da Supabase. Sem filtro, apontar o webhook para um
 * endereço interno (metadata do provedor, 169.254.169.254, localhost, faixas
 * privadas) transforma o disparo num scanner de rede interna -- e o
 * `failure_count` ainda entrega se o destino respondeu ou não.
 *
 * Só https público. `redirect: "error"` impede burlar via redirecionamento
 * para um destino interno, e o timeout evita que um endpoint pendurado
 * segure a invocação.
 */
function destinoPermitido(bruta: string): boolean {
  let url: URL;
  try {
    url = new URL(bruta);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return false;

  // IPv6 literal: só descarta loopback/link-local/unique-local.
  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1);
    return !(v6 === "::1" || v6.startsWith("fe80") || v6.startsWith("fc") || v6.startsWith("fd"));
  }

  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false; // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  }
  return true;
}

export async function fireWebhooks(
  sb: ReturnType<typeof createClient>,
  orgId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const { data: webhooks, error } = await sb
    .from("webhooks")
    .select("id, url, secret, failure_count")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .contains("events", [event]);

  if (error || !webhooks?.length) return;

  const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() });

  await Promise.allSettled(
    webhooks.map(async (wh: { id: string; url: string; secret: string | null; failure_count: number }) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-CRM-Event": event,
      };

      if (wh.secret) {
        const key = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(wh.secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"]
        );
        const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
        headers["X-CRM-Signature"] = Array.from(new Uint8Array(sig))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }

      try {
        if (!destinoPermitido(wh.url)) {
          await sb.from("webhooks").update({ failure_count: wh.failure_count + 1 }).eq("id", wh.id);
          return;
        }
        const res = await fetch(wh.url, {
          method: "POST",
          headers,
          body,
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          await sb.from("webhooks").update({ last_triggered_at: new Date().toISOString(), failure_count: 0 }).eq("id", wh.id);
        } else {
          await sb.from("webhooks").update({ failure_count: wh.failure_count + 1 }).eq("id", wh.id);
        }
      } catch {
        await sb.from("webhooks").update({ failure_count: wh.failure_count + 1 }).eq("id", wh.id);
      }
    })
  );
}
