/**
 * Valida e guarda o token de acesso do Meta Ads.
 *
 * Mesmo padrão de validate-slack-webhook: testa a credencial CONTRA O PROVEDOR
 * antes de gravar, para o dono descobrir o erro aqui — e não na primeira
 * sincronização, quando já ninguém lembra o que digitou.
 *
 * O token vai para `org_secrets`, que tem RLS habilitada e NENHUMA política: só
 * service_role a alcança. Ele NÃO pode ficar em `integration_configs`, onde
 * estava: aquela tabela é lida por qualquer membro da organização, então o
 * token de anúncio da empresa ficava visível para o time inteiro. É o mesmo
 * defeito que tirou o token do WhatsApp de lá.
 *
 * POR ORGANIZAÇÃO, e não num secret do projeto. `meta-ads-sync` lia
 * `Deno.env.get('META_ACCESS_TOKEN')` — um valor só para o Supabase inteiro —
 * enquanto o formulário do CRM gravava em outro lugar. Duas consequências: o
 * campo do formulário não fazia nada, e duas organizações teriam de dividir a
 * mesma conta de anúncio.
 *
 * Exige ADMINISTRADOR, não só sessão: trocar a credencial de anúncio da empresa
 * não é ação de membro comum.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * `act_` na frente, sempre.
 *
 * O Business Manager mostra o id como número puro ("1586102359800493"), mas a
 * Graph API só reconhece a conta com o prefixo. Colar o que está na tela da
 * Meta -- que é o que qualquer um faz -- gerava um 404 de "objeto não existe",
 * que não sugere prefixo nenhum.
 */
/**
 * O QUE FAZER, para os códigos da Meta que se repetem.
 *
 * A mensagem crua da Graph API descreve o estado e não a saída: "(#200) Ad
 * account owner has NOT grant ads_management or ads_read permission" está
 * correta e não diz onde clicar. Pior, ela vem com um link de documentação
 * para desenvolvedor no meio de um toast.
 *
 * Mesma ideia do `mensagemErro` do frontend, que traduz os códigos do Postgres
 * que merecem frase própria. Os outros passam cru: inventar tradução para erro
 * que não se conhece é pior que mostrar o original.
 */
function comoResolver(codigo: number | undefined, conta: string | null): string | null {
  if (codigo === 200) {
    return [
      "O token existe e enxerga a conta, mas não tem permissão de leitura de anúncios. São três lugares, nesta ordem:",
      "1) o token precisa do escopo ads_read — no Graph API Explorer, marque ads_read antes de gerar;",
      `2) o app precisa estar autorizado na conta ${conta ?? "de anúncio"} — Business Manager → Configurações → Contas de anúncio → Aplicativos conectados;`,
      "3) se o app estiver em modo de desenvolvimento, só funciona para quem tem cargo nele — para as demais contas, a Meta exige Acesso Avançado ao ads_read.",
    ].join(" ");
  }
  if (codigo === 190) {
    return "O token expirou ou foi revogado. Gere um novo no Graph API Explorer — e prefira um token de longa duração, senão isso volta em algumas horas.";
  }
  if (codigo === 100 || codigo === 803) {
    return `A Meta não encontrou a conta ${conta ?? ""}. Confira o ID em Business Manager → Contas de anúncio; é só o número, que o CRM prefixa com act_ sozinho.`;
  }
  return null;
}

function normalizarConta(id: unknown): string | null {
  const bruto = typeof id === "string" ? id.trim() : "";
  if (!bruto) return null;
  return bruto.startsWith("act_") ? bruto : `act_${bruto}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ ok: false, error: "Não autenticado" }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ ok: false, error: "Não autenticado" }, 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: perfil } = await admin
      .from("profiles").select("org_id").eq("id", userData.user.id).maybeSingle();
    const orgId = perfil?.org_id;
    if (!orgId) return json({ ok: false, error: "Você não pertence a nenhuma organização" }, 403);

    // Consulta direta em vez de RPC para is_org_admin: aquela função não tem
    // GRANT explícito em migração nenhuma, então depender dela é depender de
    // estado de permissão que ninguém declarou.
    const { data: papel } = await admin
      .from("user_roles").select("role")
      .eq("user_id", userData.user.id).eq("org_id", orgId).maybeSingle();

    if (papel?.role !== "owner" && papel?.role !== "admin") {
      return json({ ok: false, error: "Só administradores configuram integrações" }, 403);
    }

    const { access_token, ad_account_id, remover } = await req.json();

    // Desligar: apaga o segredo e encerra. Sem token, o sync vira no-op.
    if (remover) {
      await admin.from("org_secrets").delete()
        .eq("org_id", orgId).eq("key_name", "meta_access_token");
      return json({ ok: true, removido: true });
    }

    const token = typeof access_token === "string" ? access_token.trim() : "";
    if (!token) return json({ ok: false, error: "Cole o token de acesso do Meta." }, 400);

    /*
      TESTA CONTRA A GRAPH API antes de gravar.

      Token do Meta expira, é revogado ou vem sem `ads_read`, e nenhum desses
      casos se distingue olhando a string. Sem este passo o erro só apareceria
      na sincronização, com uma mensagem da Meta que não diz o que fazer.

      PELA CONTA, E NÃO POR `/me`. A primeira versão validava em
      `/me/adaccounts` e recusava um token perfeitamente bom com "An active
      access token must be used to query information about the current user".

      É o erro de quem usa um token de USUÁRIO DO SISTEMA, do Business Manager:
      ele não tem usuário por trás, então `/me` não resolve para ninguém. E
      esse é justamente o tipo de token certo para integração servidor-a-
      servidor -- o que a validação recusava era o caso mais correto.

      Consultar `act_<id>` direto funciona para os dois tipos, e ainda confere o
      que realmente importa: que ESTE token enxerga ESTA conta.
    */
    const conta = normalizarConta(ad_account_id);
    const alvo = conta
      ? `${GRAPH}/${conta}?fields=name,account_status`
      : `${GRAPH}/me/adaccounts?fields=id,name&limit=1`;

    const teste = await fetch(`${alvo}&access_token=${encodeURIComponent(token)}`);
    const corpo = await teste.json().catch(() => null);

    if (!teste.ok || corpo?.error) {
      const motivo = corpo?.error?.message || `A Meta respondeu ${teste.status}`;
      const saida = comoResolver(corpo?.error?.code, conta);

      // Sem id de conta não há como escapar do `/me`, então vale dizer a saída.
      const dica = !conta && /current user/i.test(motivo)
        ? " Preencha o ID da conta de anúncio: com ele, a checagem não passa por /me e aceita token de Usuário do Sistema."
        : "";

      return json({
        ok: false,
        // Quando há tradução, ela vem NA FRENTE: é o que a pessoa precisa ler.
        error: saida ? `${saida}${dica}` : `A Meta recusou o token: ${motivo}${dica}`,
        // O original fica disponível para quem for investigar, sem poluir o aviso.
        detalhe_meta: motivo,
        codigo_meta: corpo?.error?.code ?? null,
      }, 400);
    }

    if (!conta) {
      const achadas = Array.isArray(corpo?.data) ? corpo.data.length : 0;
      if (achadas === 0) {
        return json({
          ok: false,
          error: "O token é válido, mas não enxerga nenhuma conta de anúncio. Confira a permissão ads_read, ou preencha o ID da conta.",
        }, 400);
      }
    }

    const contas = conta ? 1 : (Array.isArray(corpo?.data) ? corpo.data.length : 0);

    await admin.from("org_secrets").upsert(
      { org_id: orgId, key_name: "meta_access_token", key_value: token },
      { onConflict: "org_id,key_name" },
    );

    // O que NÃO é segredo continua em integration_configs, legível pelos
    // membros: o id da conta identifica, não autentica.
    const { data: existente } = await admin
      .from("integration_configs").select("id, config")
      .eq("org_id", orgId).eq("provider", "meta").maybeSingle();

    const config = {
      ...((existente?.config ?? {}) as Record<string, unknown>),
      ad_account_id: conta ?? undefined,
    };
    // O token nunca volta para cá, nem por acidente de spread do que já existia.
    delete (config as Record<string, unknown>).access_token;

    if (existente?.id) {
      await admin.from("integration_configs")
        .update({ config, is_active: true }).eq("id", existente.id);
    } else {
      await admin.from("integration_configs").insert({
        org_id: orgId, provider: "meta", config, is_active: true,
        connected_by: userData.user.id,
      });
    }

    return json({ ok: true, contas });
  } catch (e) {
    console.error("meta-ads-save", e);
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
