/**
 * O access_token válido de uma conta de Gmail conectada.
 *
 * A MESMA lógica estava escrita inline em `gmail-sender.ts` e em
 * `gmail-sync/index.ts`, com a renovação repetida nos dois. Este arquivo existe
 * porque a terceira cópia ia nascer em `gmail-modify` — e um bug de renovação
 * corrigido em uma cópia deixaria as outras duas quebradas.
 *
 * O access_token vive uma hora. Renovar antes de expirar (com margem de um
 * minuto) evita o caso em que a chamada sai com token que expira no meio do
 * caminho — falha que aparece como "401 sem motivo".
 */
import { renovarAccessToken, resolverCredencialGoogle } from "./google-credentials.ts";

// Só o que este arquivo usa do cliente. Tipar o mínimo documenta que ele faz
// duas leituras e uma escrita, e nada mais.
type Admin = {
  from(tabela: string): any;
};

export type ResultadoToken =
  | { ok: true; accessToken: string; email: string }
  | { ok: false; erro: string; motivo?: string };

/**
 * `email` opcional: sem ele, pega a conta mais recentemente atualizada da
 * organização. Com ele, a conta daquela pessoa — que é o caso da tela de
 * E-mail, onde cada um vê a própria caixa.
 */
export async function obterAccessToken(
  admin: Admin,
  orgId: string,
  email?: string | null,
): Promise<ResultadoToken> {
  let q = admin
    .from("gmail_oauth_tokens")
    .select("*")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (email) q = q.eq("email", email);

  const { data: tokenRow } = await q.maybeSingle();
  if (!tokenRow) {
    return {
      ok: false,
      erro: "Nenhuma conta de e-mail conectada. Conecte em Configurações › Conectar e-mail.",
    };
  }

  let accessToken = tokenRow.access_token as string;

  // Margem de um minuto: sem ela, a chamada pode sair com token que expira no
  // meio do caminho, e o erro chega como 401 sem explicação.
  if (new Date(tokenRow.expires_at).getTime() - Date.now() < 60_000) {
    const cred = await resolverCredencialGoogle(admin, orgId);
    const renovado = await renovarAccessToken(tokenRow.refresh_token as string, cred);
    if (!renovado.ok) {
      // Marca a conexão como inválida, para a tela poder pedir reconexão em vez
      // de repetir a falha a cada ação.
      await admin
        .from("email_connections")
        .update({ invalid_since: new Date().toISOString(), invalid_reason: renovado.motivo })
        .eq("org_id", orgId)
        .eq("email_address", tokenRow.email)
        .is("invalid_since", null);

      return {
        ok: false,
        motivo: renovado.motivo,
        erro: renovado.motivo === "credenciais_trocadas"
          ? "A credencial do Google da empresa mudou. Reconecte sua conta em Configurações › Conectar e-mail."
          : "Seu acesso ao Google expirou ou foi revogado. Reconecte em Configurações › Conectar e-mail.",
      };
    }
    accessToken = renovado.accessToken;
    await admin.from("gmail_oauth_tokens").update({
      access_token: accessToken,
      expires_at: new Date(Date.now() + renovado.expiraEm * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", tokenRow.id);
  }

  return { ok: true, accessToken, email: tokenRow.email as string };
}
