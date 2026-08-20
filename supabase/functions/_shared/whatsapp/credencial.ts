/**
 * Monta a credencial do WhatsApp de uma organização, no servidor.
 *
 * Junta duas tabelas de propósito: whatsapp_business_accounts é legível por
 * admin no cliente, whatsapp_secrets não é legível por ninguém. Só quem tem
 * service_role consegue chamar isto.
 *
 * Usado por whatsapp-numbers, whatsapp-claim, whatsapp-send, whatsapp-webhook e
 * whatsapp-templates-sync — antes cada função lia o token do ambiente por conta
 * própria, com uma cadeia de fallback diferente em cada arquivo.
 */
import type { Credencial } from "./types.ts";

/** Por que não há credencial. A interface mostra mensagem diferente para cada. */
export type MotivoAusencia = "sem_waba" | "sem_token";

export type ResultadoCredencial =
  | { ok: true; cred: Credencial; contaId: string; verifyToken: string }
  | { ok: false; motivo: MotivoAusencia };

/**
 * Só a forma que este helper usa do cliente Supabase.
 *
 * Estrutural em vez de importar SupabaseClient de esm.sh: o `index.ts` daqui é
 * importado pelos testes, e o tsc do projeto não resolve import por URL. Tipar o
 * mínimo também documenta que este arquivo faz duas leituras e nada mais.
 */
type LinhaConta = {
  id: string;
  provider: string | null;
  waba_id: string | null;
  webhook_verify_token: string;
  server_url: string | null;
  is_active: boolean;
};
type LinhaSegredo = { access_token: string | null };

type ClienteAdmin = {
  from(tabela: string): {
    select(colunas: string): {
      eq(coluna: string, valor: string): {
        maybeSingle(): Promise<{ data: LinhaConta | LinhaSegredo | null }>;
      };
    };
  };
};

export async function carregarCredencial(
  admin: ClienteAdmin,
  orgId: string,
): Promise<ResultadoCredencial> {
  const { data: contaRaw } = await admin
    .from("whatsapp_business_accounts")
    .select("id, provider, waba_id, webhook_verify_token, server_url, is_active")
    .eq("org_id", orgId)
    .maybeSingle();
  const conta = contaRaw as LinhaConta | null;

  if (!conta || !conta.is_active) return { ok: false, motivo: "sem_waba" };

  const { data: segredoRaw } = await admin
    .from("whatsapp_secrets")
    .select("access_token")
    .eq("org_id", orgId)
    .maybeSingle();
  const segredo = segredoRaw as LinhaSegredo | null;

  // Conta cadastrada sem token acontece de verdade: o "desligar" apaga só o
  // segredo e mantém as conexões das pessoas. Vale distinguir da falta de conta,
  // porque a saída é diferente — aqui basta o admin recolocar o token.
  if (!segredo?.access_token) return { ok: false, motivo: "sem_token" };

  return {
    ok: true,
    contaId: conta.id,
    verifyToken: conta.webhook_verify_token,
    cred: {
      provider: conta.provider ?? "meta",
      token: segredo.access_token,
      wabaId: conta.waba_id ?? null,
      serverUrl: conta.server_url ?? null,
    },
  };
}

/** Mensagem para o usuário final, por motivo. */
export function explicarAusencia(motivo: MotivoAusencia): string {
  return motivo === "sem_waba"
    ? "A empresa ainda não configurou o WhatsApp. Peça a um administrador."
    : "O token do WhatsApp da empresa foi removido. Peça a um administrador para cadastrar de novo.";
}
