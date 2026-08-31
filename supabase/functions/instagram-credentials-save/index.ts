/**
 * Cadastra a credencial do app de Instagram pelo CRM.
 *
 * Gêmea de `gmail-credentials-save`, e pelo mesmo motivo: o valor vai para
 * `instagram_app_secrets`, que tem RLS ligada e ZERO policies. Isso é o que
 * permite cadastrar pela tela SEM o segredo voltar para o navegador.
 *
 * NUNCA devolve o app_secret. Nem para quem acabou de salvá-lo.
 *
 * NÃO VALIDA CONTRA A META ANTES DE GRAVAR, e a diferença em relação ao Google é
 * deliberada: lá existe endpoint que responde se o par client_id/client_secret é
 * válido, e `gmail-credentials-save` usa. A Meta não expõe equivalente para a
 * credencial do app de Instagram -- daria para inferir de mensagens de erro do
 * fluxo de token, o que é frágil e passa a falhar quando a Meta reescreve o
 * texto. Prometer validação e entregar adivinhação é pior que não validar.
 *
 * O que substitui: o erro no momento de conectar agora chega inteiro à tela
 * (`erroDaFuncao`, em `erro-supabase.ts`), então credencial errada aparece como
 * a mensagem da Meta, e não como "non-2xx status code".
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { resolverCredencialApp } from "../_shared/instagram/credencial.ts";

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Não autenticado" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: claims, error: cErr } = await userClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (cErr || !claims?.claims?.sub) return json({ error: "Não autenticado" }, 401);
    const userId = claims.claims.sub as string;

    const { data: perfil } = await admin
      .from("profiles").select("org_id").eq("id", userId).maybeSingle();
    const orgId = perfil?.org_id as string | undefined;
    if (!orgId) return json({ error: "Você não pertence a nenhuma organização" }, 403);

    /*
     * Consulta direta em `user_roles` em vez da RPC `is_org_admin`, pelo mesmo
     * motivo registrado em `gmail-credentials-save` e `validate-slack-webhook`:
     * aquela função não tem GRANT explícito em migração nenhuma.
     */
    const { data: papel } = await admin
      .from("user_roles").select("role")
      .eq("user_id", userId).eq("org_id", orgId).maybeSingle();

    if (papel?.role !== "owner" && papel?.role !== "admin") {
      return json({ error: "Só administradores cadastram a credencial do Instagram" }, 403);
    }

    const corpo = await req.json().catch(() => ({}));
    const { app_id, app_secret, remover } = corpo as Record<string, unknown>;

    // Quantas contas dependem da credencial hoje. Serve para avisar antes de
    // remover, e para relatar depois.
    const { count: conectadas } = await admin
      .from("instagram_connections")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("is_active", true);

    // ---------- Remover ----------
    if (remover === true) {
      const { error } = await admin
        .from("instagram_app_secrets").delete().eq("org_id", orgId);
      if (error) return json({ error: error.message }, 500);

      // Volta a valer o que estiver no ambiente, se houver.
      const depois = await resolverCredencialApp(admin, orgId);
      return json({
        ok: true,
        removido: true,
        origem: depois.origem,
        contas_afetadas: conectadas ?? 0,
      });
    }

    // ---------- Salvar ----------
    const id = typeof app_id === "string" ? app_id.trim() : "";
    const segredo = typeof app_secret === "string" ? app_secret.trim() : "";

    if (!id || !segredo) {
      return json({ error: "Informe o ID e a chave secreta do app do Instagram." }, 400);
    }

    /*
     * O app_id do Instagram é numérico e longo. Checar isso barra o erro mais
     * comum, que é colar os dois campos trocados -- a chave secreta é
     * hexadecimal, então cai aqui em vez de virar uma credencial inválida
     * gravada, que fica parecendo configurada e só falha no primeiro Conectar.
     */
    if (!/^\d{8,}$/.test(id)) {
      return json({
        error: "O ID do app do Instagram é só dígitos. "
          + "Confira se não trocou os campos: a chave secreta tem letras.",
      }, 400);
    }
    if (segredo.length < 16) {
      return json({ error: "A chave secreta parece curta demais. Copie-a inteira." }, 400);
    }

    const { error } = await admin
      .from("instagram_app_secrets")
      .upsert({
        org_id: orgId,
        app_id: id,
        app_secret: segredo,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      }, { onConflict: "org_id" });

    if (error) return json({ error: error.message }, 500);

    // Devolve o app_id, que é público, e NÃO o segredo.
    return json({ ok: true, app_id: id, origem: "crm", contas_afetadas: conectadas ?? 0 });
  } catch (e) {
    console.error("instagram-credentials-save error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
