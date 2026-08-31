/**
 * Retorno do OAuth do Instagram.
 *
 * O navegador chega aqui vindo do Instagram, então a resposta é sempre um 302 de
 * volta para o CRM -- nunca HTML. O runtime das Edge Functions rebaixa
 * `text/html` para `text/plain` (anti-phishing no domínio compartilhado), e uma
 * página servida daqui apareceria como código-fonte na tela. Está no CLAUDE.md.
 *
 * QUATRO PASSOS, e o terceiro é o que costuma ser esquecido:
 *
 * 1. conferir o `state` assinado -- é o que impede alguém de forjar org_id;
 * 2. trocar o código por token de LONGA duração (duas trocas, ver `api.ts`);
 * 3. ASSINAR A CONTA NO WEBHOOK. Sem isto a conexão fica pela metade: a tela diz
 *    "conectado", o envio funciona, e nada entra. É a falha mais confusa
 *    possível, porque metade funciona;
 * 4. gravar conexão e segredo em tabelas SEPARADAS -- o token nunca em
 *    `instagram_connections`, que o navegador do admin lê.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyStateDetalhado } from "../_shared/oauth-state.ts";
import { assinarWebhook, perfilDe, trocarCodigoPorToken } from "../_shared/instagram/api.ts";
import { resolverCredencialApp } from "../_shared/instagram/credencial.ts";

const DESTINO = "/integrations";

function baseDoApp(): string {
  const appBase = Deno.env.get("APP_BASE_URL");
  if (appBase) {
    try { return new URL(appBase).origin; } catch { /* cai no vazio */ }
  }
  return "";
}

/**
 * Volta ao CRM com o resultado na query string.
 *
 * Os motivos viajam como CÓDIGO, e quem traduz é a tela — mesmo idioma do
 * `gmail-oauth-callback`. Frase pronta na URL apareceria com `+` no lugar dos
 * espaços e sem acento em metade dos navegadores.
 */
function redirecionar(params: Record<string, string>) {
  const base = baseDoApp();
  if (!base) {
    // Texto puro é aceitável aqui: é erro de configuração do servidor, não fluxo
    // normal, e não há para onde redirecionar.
    return new Response(
      "O CRM não sabe para onde te devolver: falta configurar APP_BASE_URL nos "
        + "secrets do projeto. Avise um administrador.",
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
  const url = new URL(`${base}${DESTINO}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

const falhar = (motivo: string, detalhe?: string) =>
  redirecionar({
    instagram: "erro",
    motivo,
    ...(detalhe ? { detalhe: detalhe.slice(0, 200) } : {}),
  });

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);

    // A pessoa cancelou na tela do Instagram. Não é erro: é uma decisão.
    const erroDoInstagram = url.searchParams.get("error");
    if (erroDoInstagram) {
      const descricao = url.searchParams.get("error_description") ?? erroDoInstagram;
      return erroDoInstagram === "access_denied"
        ? redirecionar({ instagram: "cancelado" })
        : falhar("instagram_recusou", descricao);
    }

    const codigo = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!codigo || !state) return falhar("faltou_codigo");

    // ---------- 1. o state ----------
    /*
     * `t` faz parte do tipo porque `signState` o acrescenta e é ele que
     * `verifyStateDetalhado` compara para expirar. Declará-lo em vez de usar
     * `any` -- que é o que o callback do Gmail faz -- é o que mantém `u` e `o`
     * conferidos pelo compilador.
     */
    const conferido = await verifyStateDetalhado<{ u: string; o: string; t?: number }>(state);
    if (!conferido.ok) {
      console.error("instagram-oauth-callback: state recusado (%s)", conferido.motivo);
      return falhar(conferido.motivo === "expirado" ? "state_expirou" : "state_invalido");
    }
    const { u: userId, o: orgId } = conferido.payload;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    /*
     * Mesma ordem CRM -> ambiente do `instagram-oauth-start`. Resolver DEPOIS de
     * conferir o state, porque é o state que diz de qual organização é a
     * credencial -- resolver antes obrigaria a adivinhar a org.
     */
    const credApp = await resolverCredencialApp(admin, orgId);
    if (credApp.origem === "nenhum") return falhar("app_nao_configurado");

    // ---------- 2. o token ----------
    const troca = await trocarCodigoPorToken(
      credApp.appId,
      credApp.appSecret,
      `${supabaseUrl}/functions/v1/instagram-oauth-callback`,
      codigo,
    );
    if (!troca.ok) {
      console.error("instagram-oauth-callback: troca falhou —", troca.erro);
      return falhar("troca_falhou", troca.erro);
    }

    const cred = { accessToken: troca.token, igUserId: troca.igUserId };

    // Quem é a conta, para a tela mostrar o @ em vez de um número.
    const perfil = await perfilDe(cred, "me");

    // ---------- 4a. a conexão ----------
    /*
     * `onConflict: ig_user_id` porque reconectar a MESMA conta tem de atualizar,
     * não estourar no índice único. Acontece: token vencido, escopo novo,
     * qualquer motivo de refazer o fluxo.
     *
     * O `webhook_verify_token` NÃO entra no upsert. Ele tem DEFAULT no banco, e
     * incluí-lo aqui geraria um valor novo a cada reconexão -- invalidando o que
     * já está salvo no painel da Meta e derrubando o handshake. O segredo se
     * mantém de propósito.
     */
    const { data: conexao, error: erroConexao } = await admin
      .from("instagram_connections")
      .upsert({
        org_id: orgId,
        user_id: userId,
        ig_user_id: troca.igUserId,
        username: perfil?.username ?? null,
        display_name: perfil?.nome ?? null,
        profile_pic_url: perfil?.foto ?? null,
        is_active: true,
        connected_at: new Date().toISOString(),
      }, { onConflict: "ig_user_id" })
      .select("id")
      .single();

    if (erroConexao || !conexao) {
      console.error("instagram-oauth-callback: falhou gravar conexão", erroConexao);
      return falhar("gravar_conexao", erroConexao?.message);
    }

    // ---------- 4b. o segredo, em tabela separada ----------
    const { error: erroSegredo } = await admin
      .from("instagram_secrets")
      .upsert({
        connection_id: conexao.id,
        access_token: troca.token,
        expires_at: troca.expiraEm
          ? new Date(Date.now() + troca.expiraEm * 1000).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "connection_id" });

    if (erroSegredo) {
      console.error("instagram-oauth-callback: falhou gravar segredo", erroSegredo);
      return falhar("gravar_segredo", erroSegredo.message);
    }

    // ---------- 3. o webhook ----------
    /*
     * Por último de propósito, e a falha aqui NÃO desfaz o resto.
     *
     * Se a assinatura falhar, o que existe é uma conexão que envia mas não
     * recebe -- ruim, e melhor que nenhuma conexão. A tela recebe
     * `instagram=parcial` e diz exatamente o que falta, porque o sintoma sozinho
     * ("ninguém me responde") não aponta para a causa.
     */
    const assinatura = await assinarWebhook(cred);
    if (!assinatura.ok) {
      console.error("instagram-oauth-callback: assinatura do webhook falhou —", assinatura.erro);
      return redirecionar({
        instagram: "parcial",
        motivo: "webhook_nao_assinado",
        ...(assinatura.erro ? { detalhe: assinatura.erro.slice(0, 200) } : {}),
      });
    }

    return redirecionar({
      instagram: "ok",
      ...(perfil?.username ? { conta: perfil.username } : {}),
    });
  } catch (e) {
    console.error("instagram-oauth-callback error", e);
    return falhar("erro_inesperado", e instanceof Error ? e.message : String(e));
  }
});
