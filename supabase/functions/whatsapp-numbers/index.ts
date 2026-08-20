/**
 * Lista os números do WABA da empresa, dizendo quais já têm dono.
 *
 * É o que permite a pessoa ESCOLHER o número dela em vez de colar um
 * phone_number_id. Colar id à mão erra calado: você só descobre no primeiro
 * envio, e nada impede duas pessoas colarem o mesmo.
 *
 * Acessível a qualquer membro, não só admin — é a tela pessoal de conexão.
 *
 * O token NUNCA sai daqui. Quem fala com a Meta é esta função.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { carregarCredencial, explicarAusencia, resolverProvedor } from "../_shared/whatsapp/index.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Não autenticado" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ ok: false, error: "Não autenticado" }, 401);
    const userId = userData.user.id;

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: perfil } = await admin
      .from("profiles").select("org_id").eq("id", userId).maybeSingle();
    const orgId = perfil?.org_id;
    if (!orgId) return json({ ok: false, error: "Você não pertence a nenhuma organização" }, 403);

    const credencial = await carregarCredencial(admin, orgId);
    if (!credencial.ok) {
      // `motivo` estruturado, não só texto: a tela mostra caminho diferente
      // para "empresa não configurou" e "token foi removido".
      return json({ ok: false, motivo: credencial.motivo, error: explicarAusencia(credencial.motivo) }, 200);
    }

    const prov = resolverProvedor(credencial.cred.provider);

    let numeros;
    try {
      numeros = await prov.listarNumeros(credencial.cred);
    } catch (e) {
      // Erro 190 da Meta é token expirado ou revogado. Vale nomear, porque a
      // saída é o admin recadastrar, e não a pessoa tentar de novo.
      const msg = e instanceof Error ? e.message : String(e);
      return json({
        ok: false,
        motivo: "credencial_invalida",
        error: `A Meta recusou a credencial da empresa. Um administrador precisa recadastrar. Detalhe: ${msg}`,
      }, 200);
    }

    const { data: papel } = await admin
      .from("user_roles").select("role").eq("user_id", userId).eq("org_id", orgId).maybeSingle();
    const ehAdmin = papel?.role === "owner" || papel?.role === "admin";

    // Duas consultas em vez de um join: whatsapp_connections.user_id referencia
    // auth.users, não public.profiles, então o PostgREST não conhece essa
    // relação e `profiles!inner(...)` não resolve.
    const { data: conexoes } = await admin
      .from("whatsapp_connections")
      .select("phone_number_id, user_id")
      .eq("org_id", orgId)
      .eq("is_active", true);

    type Conexao = { phone_number_id: string; user_id: string };
    const lista = (conexoes ?? []) as Conexao[];

    // Nome só é buscado quando quem pergunta é admin — para os demais o nome
    // nem sai do banco, o que é mais forte que filtrar na resposta.
    const nomePorUsuario = new Map<string, string | null>();
    if (ehAdmin && lista.length > 0) {
      const { data: perfis } = await admin
        .from("profiles")
        .select("id, name, email")
        .in("id", lista.map((c) => c.user_id));
      for (const p of (perfis ?? []) as { id: string; name: string | null; email: string | null }[]) {
        nomePorUsuario.set(p.id, p.name ?? p.email ?? null);
      }
    }

    const porNumero = new Map<string, Conexao>();
    for (const c of lista) porNumero.set(c.phone_number_id, c);

    return json({
      ok: true,
      numeros: numeros.map((n) => {
        const dono = porNumero.get(n.id);
        return {
          id: n.id,
          telefone: n.telefone,
          nome: n.nomeVerificado,
          // Verde/amarelo/vermelho, POR NÚMERO. A interface expõe porque queda
          // de qualidade vista cedo é ajustável; vista tarde é bloqueio.
          qualidade: n.qualidade,
          // Nome só para admin. Para os demais basta saber que está ocupado —
          // o SELECT da tabela também esconde a conexão dos outros, e esta
          // função não deve furar isso.
          dono: !dono
            ? null
            : dono.user_id === userId
              ? { quem: "voce" as const, nome: null }
              : { quem: "outro" as const, nome: nomePorUsuario.get(dono.user_id) ?? null },
        };
      }),
    });
  } catch (e) {
    console.error("whatsapp-numbers", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
