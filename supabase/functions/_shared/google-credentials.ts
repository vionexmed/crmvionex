/**
 * Credencial OAuth do Google: uma única resolução, um único lugar.
 *
 * Existiam SETE cópias da mesma expressão de fallback espalhadas em
 * gmail-oauth-start, gmail-oauth-callback, gmail-send, gmail-sync,
 * gmail-attachment, _shared/gmail-sender e gmail-get-defaults. Sete cópias é
 * sete oportunidades de divergir — e divergir aqui tem um sintoma específico e
 * cruel: o Google exige que a RENOVAÇÃO use as mesmas credenciais que EMITIRAM o
 * token. Resolver diferente em dois pontos produz `invalid_client` horas ou dias
 * depois, longe da causa.
 *
 * Por isso a renovação mora aqui também, e não em cada chamador: junto, não há
 * como uma metade mudar sem a outra.
 */

/** Onde a credencial foi encontrada. A interface mostra isto ao admin. */
export type OrigemCredencial = "crm" | "legado" | "ambiente" | "nenhum";

export type CredencialGoogle = {
  clientId: string;
  clientSecret: string;
  origem: OrigemCredencial;
};

/** Códigos de invalid_reason gravados em email_connections. */
export type MotivoInvalidez = "credenciais_trocadas" | "token_revogado" | "refresh_invalido";

/**
 * Fatia mínima do cliente Supabase que este módulo usa. Declarada em vez de
 * `any` para o lint do projeto não precisar de exceção.
 */
type Linha = Record<string, unknown> | null;
export type ClienteAdmin = {
  from: (tabela: string) => {
    select: (colunas: string) => {
      eq: (coluna: string, valor: string) => {
        maybeSingle: () => Promise<{ data: Linha }>;
        eq: (coluna: string, valor: string) => {
          maybeSingle: () => Promise<{ data: Linha }>;
        };
      };
    };
  };
};

const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * ORDEM: CRM → legado → ambiente.
 *
 * `google_oauth_secrets` é a fonte oficial: tabela com RLS ligada e ZERO
 * policies, então o navegador não a alcança. `integration_configs` fica como
 * legado — o formulário antigo gravava lá, e a migração 20260824130000 removeu
 * as chaves, mas alguém pode reintroduzir por SQL. O ambiente é o último
 * recurso, e é o que mantém tudo funcionando durante a transição.
 *
 * Esta ordem tem de ser a MESMA em todos os chamadores. É o motivo do arquivo.
 */
export async function resolverCredencialGoogle(
  admin: ClienteAdmin,
  orgId: string | null,
): Promise<CredencialGoogle> {
  if (orgId) {
    const { data: doCrm } = await admin
      .from("google_oauth_secrets")
      .select("client_id, client_secret")
      .eq("org_id", orgId)
      .maybeSingle();

    if (doCrm && texto(doCrm.client_id) && texto(doCrm.client_secret)) {
      return {
        clientId: texto(doCrm.client_id),
        clientSecret: texto(doCrm.client_secret),
        origem: "crm",
      };
    }

    const { data: legado } = await admin
      .from("integration_configs")
      .select("config")
      .eq("org_id", orgId)
      .eq("provider", "gmail")
      .maybeSingle();

    const cfg = (legado?.config ?? {}) as Record<string, unknown>;
    if (texto(cfg.client_id) && texto(cfg.client_secret)) {
      return {
        clientId: texto(cfg.client_id),
        clientSecret: texto(cfg.client_secret),
        origem: "legado",
      };
    }
  }

  const doAmbiente = {
    clientId: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "",
    clientSecret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "",
  };

  if (doAmbiente.clientId && doAmbiente.clientSecret) {
    return { ...doAmbiente, origem: "ambiente" };
  }

  // Devolve vazio em vez de lançar: o gmail-oauth-start quer responder 400 com
  // instrução, e o gmail-get-defaults quer reportar "não configurado" sem erro.
  return { clientId: doAmbiente.clientId, clientSecret: doAmbiente.clientSecret, origem: "nenhum" };
}

export type ResultadoRenovacao =
  | { ok: true; accessToken: string; expiraEm: number }
  | { ok: false; motivo: MotivoInvalidez; detalhe: string };

/**
 * Renova o access token, usando a credencial resolvida pela função acima.
 *
 * Traduz o erro do Google no motivo que a tela mostra:
 *   invalid_client → a credencial da empresa não serve mais
 *   invalid_grant  → o refresh token morreu (acesso revogado, senha trocada)
 */
export async function renovarAccessToken(
  refreshToken: string,
  cred: CredencialGoogle,
): Promise<ResultadoRenovacao> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const dados = await resp.json().catch(() => ({}));

  if (resp.ok && dados.access_token) {
    return { ok: true, accessToken: dados.access_token, expiraEm: Number(dados.expires_in ?? 3600) };
  }

  const erro = texto(dados.error);
  const motivo: MotivoInvalidez =
    erro === "invalid_client"
      ? "credenciais_trocadas"
      : erro === "invalid_grant"
        ? "token_revogado"
        : "refresh_invalido";

  return { ok: false, motivo, detalhe: erro || `HTTP ${resp.status}` };
}

/**
 * Testa uma credencial SEM precisar que ninguém autorize nada.
 *
 * O truque: pedir token com um refresh token que sabemos ser falso. O Google
 * distingue os dois erros, e é essa distinção que dá a validação —
 *   invalid_client = a credencial está errada
 *   invalid_grant  = a credencial está CERTA, só o refresh token é falso
 *
 * Sem isto, credencial errada só apareceria quando a primeira pessoa tentasse
 * conectar, e o erro voltaria como falha de OAuth sem dizer que a culpa é do
 * cadastro.
 */
export async function validarCredencialGoogle(
  clientId: string,
  clientSecret: string,
): Promise<{ ok: boolean; erro: string | null }> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: "vionex-validacao-token-invalido",
      grant_type: "refresh_token",
    }),
  });

  const dados = await resp.json().catch(() => ({}));
  const erro = texto(dados.error);

  if (erro === "invalid_grant") return { ok: true, erro: null };

  if (erro === "invalid_client") {
    return { ok: false, erro: "O Google não reconheceu este par de Client ID e Client Secret." };
  }

  if (erro) return { ok: false, erro: `O Google recusou: ${erro}` };

  // Sem erro nomeado e sem invalid_grant é caso não previsto — não afirmar que
  // está válido só porque não deu para classificar.
  return { ok: false, erro: `Resposta inesperada do Google (HTTP ${resp.status}).` };
}
