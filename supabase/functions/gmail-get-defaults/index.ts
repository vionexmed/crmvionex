/**
 * Diz à interface se a credencial do Google existe, e de onde ela vem.
 *
 * NUNCA devolve o client_secret — só se ele existe. O client_id é público e
 * volta, para o admin conferir se aponta para o projeto certo do Google Cloud.
 *
 * Antes olhava apenas o ambiente, então a tela acusava "sem credencial" quando o
 * valor estava cadastrado pelo CRM. Agora usa o mesmo resolvedor das demais
 * funções, o que garante que o que a tela mostra é o que o envio vai usar.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolverCredencialGoogle } from "../_shared/google-credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claims } = await supabase.auth.getClaims(token);
    const userId = claims?.claims?.sub;
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // A org é necessária agora: a credencial do CRM é por organização. Sem ela,
    // a resolução cairia direto no ambiente e a tela mentiria sobre a origem.
    const { data: perfil } = await admin
      .from("profiles").select("org_id").eq("id", userId).maybeSingle();
    const orgId = (perfil?.org_id as string | undefined) ?? null;

    const cred = await resolverCredencialGoogle(admin, orgId);

    // SEGURANÇA: o segredo fica aqui. Sai apenas o booleano.
    return json({
      client_id: cred.clientId,
      client_secret_configured: !!cred.clientSecret,
      origem: cred.origem,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
