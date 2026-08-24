/**
 * State assinado para o fluxo OAuth.
 *
 * Antes: o state era `btoa(JSON.stringify(...))` — base64 puro, sem assinatura,
 * não persistido, e o campo de tempo era gravado e NUNCA conferido. Qualquer um
 * podia forjar um state com user_id e org_id arbitrários, e o callback usava
 * esses valores direto em INSERT com service role.
 *
 * Agora: HMAC-SHA256 sobre o payload + validação de expiração no retorno.
 * Formato: <base64url(payload)>.<base64url(assinatura)>
 */

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(text.length + ((4 - (text.length % 4)) % 4), "=");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Segredo do HMAC. `OAUTH_STATE_SECRET` é o preferido; sem ele cai na service
 * role key, que já existe em toda edge function e nunca sai do servidor.
 */
function stateSecret(): string {
  const secret = Deno.env.get("OAUTH_STATE_SECRET")
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("Nenhum segredo disponível para assinar o state do OAuth");
  return secret;
}

async function hmacKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(stateSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signState(payload: Record<string, unknown>): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify({ ...payload, t: Date.now() })));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(mac))}`;
}

/**
 * Janela de validade do state.
 *
 * Eram 10 minutos, com a justificativa de que "o usuário leva segundos para
 * autorizar". Não leva, na primeira vez: escolher a conta, entrar com senha,
 * eventual verificação em duas etapas e ler a tela de consentimento passam de
 * 10 minutos com facilidade — e o resultado é "link inválido ou expirou" sem
 * ninguém ter feito nada errado.
 *
 * 30 minutos continua seguro: o state é assinado, carrega quem pediu, e sozinho
 * não autoriza nada — o código do Google é que faz isso, e ele é de uso único.
 */
const MAX_AGE_MS = 30 * 60 * 1000;

/** Por que um state foi recusado. "expirado" e "adulterado" pedem ações diferentes. */
export type FalhaState = "formato" | "assinatura" | "expirado" | "erro";

export type ResultadoState<T> =
  | { ok: true; payload: T }
  | { ok: false; motivo: FalhaState };

/**
 * Versão detalhada: diz POR QUE recusou.
 *
 * A versão que só devolvia null juntava três causas muito diferentes numa
 * mensagem só — "inválido ou expirou" —, e quem via não tinha como saber se
 * devia apenas tentar de novo (expirado) ou se havia algo errado na
 * configuração (assinatura). O motivo também vai para o log do servidor.
 */
export async function verifyStateDetalhado<T extends { t?: number }>(
  state: string,
  maxAgeMs: number = MAX_AGE_MS,
): Promise<ResultadoState<T>> {
  try {
    const [body, signature] = state.split(".");
    if (!body || !signature) return { ok: false, motivo: "formato" };

    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      fromBase64Url(signature),
      encoder.encode(body),
    );
    if (!valid) return { ok: false, motivo: "assinatura" };

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as T;

    // A expiração que o código antigo gravava e nunca conferia.
    if (typeof payload.t !== "number" || Date.now() - payload.t > maxAgeMs) {
      return { ok: false, motivo: "expirado" };
    }

    return { ok: true, payload };
  } catch {
    return { ok: false, motivo: "erro" };
  }
}

/**
 * Devolve o payload quando a assinatura confere E o state não expirou.
 * Devolve null em qualquer outro caso — nunca lança, para o callback poder
 * redirecionar com mensagem em vez de estourar 500.
 */
export async function verifyState<T extends { t?: number }>(
  state: string,
  maxAgeMs: number = MAX_AGE_MS,
): Promise<T | null> {
  const r = await verifyStateDetalhado<T>(state, maxAgeMs);
  return r.ok ? r.payload : null;
}
