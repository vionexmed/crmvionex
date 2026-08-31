/**
 * Início do OAuth do Instagram.
 *
 * Devolve a URL de autorização; quem navega é o navegador do admin. Não
 * redireciona daqui: esta função é chamada por `fetch` com o JWT do CRM no
 * cabeçalho, e um 302 numa chamada de `fetch` não leva a pessoa a lugar algum.
 *
 * OS ESCOPOS, e por que são estes três:
 *
 * `instagram_business_basic`            quem é a conta -- @ , nome, foto. Sem
 *                                      isto não há o que mostrar em Integrações.
 * `instagram_business_manage_messages`  ler e responder Direct. É O escopo do
 *                                      canal, e é ele que exige Análise do App.
 * `instagram_business_manage_comments`  NÃO É PEDIDO. Comentário em publicação é
 *                                      outro produto, e pedi-lo faria a tela de
 *                                      consentimento cobrar permissão que o CRM
 *                                      não usa -- que é o mesmo erro do
 *                                      `gmail.readonly` redundante.
 *
 * O CLIENT SECRET NÃO PASSA POR AQUI. Só o client id, que é público por
 * definição -- ele viaja na URL de autorização que o navegador abre. O secret
 * vive em `INSTAGRAM_APP_SECRET`, nos secrets do projeto, e só o callback o usa.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { signState } from "../_shared/oauth-state.ts";

const SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
].join(",");

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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

    const { data: prof } = await admin
      .from("profiles").select("org_id").eq("id", userId).maybeSingle();
    const orgId = prof?.org_id;
    if (!orgId) return json({ error: "Sem organização" }, 400);

    /*
     * Só admin conecta a conta da empresa.
     *
     * A policy da tabela já exige isso, mas checar aqui é o que produz mensagem
     * em português em vez de uma falha de RLS no fim do fluxo -- depois de a
     * pessoa já ter autorizado no Instagram, que é o pior momento para descobrir
     * que não podia.
     */
    const { data: ehAdmin } = await admin
      .rpc("is_org_admin", { _user_id: userId, _org_id: orgId });
    if (ehAdmin !== true) {
      return json({
        error: "Só administradores podem conectar o Instagram da empresa.",
      }, 403);
    }

    const clientId = Deno.env.get("INSTAGRAM_APP_ID");
    if (!clientId) {
      return json({
        error: "Falta configurar INSTAGRAM_APP_ID nos secrets do projeto.",
      }, 503);
    }
    // Falha aqui, e não no callback: sem o secret o fluxo não tem como terminar,
    // e descobrir isso depois de autorizar é desperdiçar a ida ao Instagram.
    if (!Deno.env.get("INSTAGRAM_APP_SECRET")) {
      return json({
        error: "Falta configurar INSTAGRAM_APP_SECRET nos secrets do projeto.",
      }, 503);
    }

    const redirectUri = `${url}/functions/v1/instagram-oauth-callback`;
    const state = await signState({ u: userId, o: orgId });

    const autorizacao = new URL("https://www.instagram.com/oauth/authorize");
    autorizacao.searchParams.set("client_id", clientId);
    autorizacao.searchParams.set("redirect_uri", redirectUri);
    autorizacao.searchParams.set("response_type", "code");
    autorizacao.searchParams.set("scope", SCOPES);
    autorizacao.searchParams.set("state", state);

    return json({ url: autorizacao.toString(), redirectUri });
  } catch (e) {
    console.error("instagram-oauth-start error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
