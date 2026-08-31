/**
 * De onde vem a credencial do app de Instagram.
 *
 * ORDEM: CRM -> ambiente. É a MESMA de `resolverCredencialGoogle`, e ter que ser
 * a mesma em todos os chamadores é o motivo deste arquivo existir -- uma cópia
 * que inverta a ordem faz a credencial cadastrada pela tela ser ignorada em
 * favor de uma variável antiga, e o sintoma é "salvei e não pegou".
 *
 * `instagram_app_secrets` tem RLS ligada e ZERO policies, então só um cliente
 * com service role chega aqui. Isso é o que permite cadastrar pela tela sem que
 * o segredo volte para o navegador.
 */

export type OrigemCredencial = "crm" | "ambiente" | "nenhum";

export type CredencialApp = {
  appId: string;
  appSecret: string;
  origem: OrigemCredencial;
};

/** O mínimo do cliente admin que este módulo usa. */
export type ClienteAdmin = {
  from: (tabela: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
      };
    };
  };
};

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export async function resolverCredencialApp(
  admin: ClienteAdmin,
  orgId: string | null,
): Promise<CredencialApp> {
  if (orgId) {
    const { data } = await admin
      .from("instagram_app_secrets")
      .select("app_id, app_secret")
      .eq("org_id", orgId)
      .maybeSingle();

    const appId = texto(data?.app_id);
    const appSecret = texto(data?.app_secret);
    // As DUAS, e não uma: meia credencial não conecta, e cair para o ambiente
    // com metade de cada lado produz um erro que não aponta para nada.
    if (appId && appSecret) return { appId, appSecret, origem: "crm" };
  }

  const doAmbiente = {
    appId: texto(Deno.env.get("INSTAGRAM_APP_ID")),
    appSecret: texto(Deno.env.get("INSTAGRAM_APP_SECRET")),
  };
  if (doAmbiente.appId && doAmbiente.appSecret) {
    return { ...doAmbiente, origem: "ambiente" };
  }

  // Devolve vazio em vez de lançar: quem chama quer responder 400 com instrução,
  // ou reportar "não configurado" sem erro.
  return { appId: doAmbiente.appId, appSecret: doAmbiente.appSecret, origem: "nenhum" };
}

/**
 * A frase que a tela mostra quando falta credencial.
 *
 * Uma função e não texto solto em cada chamador porque a instrução tem de ser a
 * mesma nos três lugares que podem falhar por isto -- e porque a frase mudou uma
 * vez: antes mandava configurar variável de ambiente, e agora manda cadastrar
 * pela tela.
 */
export function explicarAusencia(origem: OrigemCredencial): string {
  if (origem !== "nenhum") return "";
  return "Nenhuma credencial de app de Instagram cadastrada. "
    + "Em Integrações, no cartão do Instagram, clique em Como configurar.";
}
