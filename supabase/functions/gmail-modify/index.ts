/**
 * Aplica no GMAIL o que a tela de E-mail faz.
 *
 * DEFEITO QUE ISTO CORRIGE: nenhuma ação da tela chegava ao Google. `archiveEmail`
 * fazia `update({ is_archived: true })` no banco do CRM e parava ali — o e-mail
 * continuava na caixa de entrada do Gmail, e marcar como lido aqui deixava não
 * lido lá. As ações PARECIAM funcionar, e a divergência só crescia.
 *
 * Tudo aqui é `messages.modify`, que aceita labels a adicionar e a remover. No
 * Gmail não existe "arquivar" nem "marcar como lido" como operações próprias:
 *
 *   arquivar          remove INBOX
 *   marcar lido       remove UNREAD
 *   spam              adiciona SPAM, remove INBOX
 *   lixeira           é rota PRÓPRIA (`messages.trash`), não label
 *   favorito          adiciona/remove STARRED
 *   pasta             adiciona/remove Label_xxx
 *
 * A lixeira é a exceção que importa: `TRASH` como label é aceito pela API mas
 * NÃO produz o mesmo efeito que a rota de trash, e a mensagem fica num estado
 * meio-apagado que a interface do Gmail mostra de forma estranha.
 *
 * O escopo necessário é `gmail.modify`, que a conexão JÁ tem. Nada a pedir ao
 * usuário, nada a pagar.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { obterAccessToken } from "../_shared/gmail-token.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** A ação, e o que ela significa em termos de label. */
type Acao =
  | "arquivar" | "desarquivar"
  | "ler" | "nao_ler"
  | "spam" | "nao_spam"
  | "lixeira" | "restaurar"
  | "favoritar" | "desfavoritar"
  | "mover_para_pasta" | "tirar_da_pasta";

/**
 * O reflexo local de cada ação.
 *
 * Gravado JUNTO com a chamada ao Gmail, para a tela não precisar esperar uma
 * sincronização para mostrar o resultado. Se a chamada ao Gmail falhar, nada é
 * gravado -- é o que impede a divergência de voltar por outro caminho.
 */
const LOCAL: Record<string, Record<string, unknown>> = {
  arquivar:      { is_archived: true },
  desarquivar:   { is_archived: false },
  ler:           { is_read: true },
  nao_ler:       { is_read: false },
  spam:          { is_spam: true, is_read: true },
  nao_spam:      { is_spam: false },
  lixeira:       { is_trashed: true },
  restaurar:     { is_trashed: false, is_archived: false, is_spam: false },
  favoritar:     { is_starred: true },
  desfavoritar:  { is_starred: false },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Não autenticado" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ ok: false, error: "Não autenticado" }, 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: perfil } = await admin
      .from("profiles").select("org_id").eq("id", userData.user.id).maybeSingle();
    const orgId = perfil?.org_id;
    if (!orgId) return json({ ok: false, error: "Você não pertence a nenhuma organização" }, 403);

    const { ids, acao, label_id } = await req.json().catch(() => ({}));
    if (!Array.isArray(ids) || ids.length === 0) {
      return json({ ok: false, error: "Nenhuma mensagem informada" }, 400);
    }
    if ((acao === "mover_para_pasta" || acao === "tirar_da_pasta") && !label_id) {
      return json({ ok: false, error: "Informe a pasta." }, 400);
    }

    // As mensagens, com o id do Gmail. Sem `message_id` não há o que modificar
    // lá -- é o caso de e-mail que o CRM registrou ao ENVIAR e o sync ainda não
    // reconciliou.
    const { data: mensagens } = await admin
      .from("emails")
      .select("id, message_id, labels, synced_from")
      .eq("org_id", orgId)
      .in("id", ids as string[]);

    if (!mensagens?.length) return json({ ok: false, error: "Mensagens não encontradas" }, 404);

    // Uma conta por vez: `synced_from` guarda o e-mail da caixa de onde a
    // mensagem veio. Mensagens de caixas diferentes exigiriam tokens diferentes.
    const caixas = [...new Set(mensagens.map((m) => m.synced_from).filter(Boolean))];
    const tk = await obterAccessToken(admin, orgId, caixas.length === 1 ? caixas[0] as string : null);
    if (!tk.ok) return json({ ok: false, error: tk.erro, motivo: tk.motivo }, 400);

    const cabecalhos = {
      Authorization: `Bearer ${tk.accessToken}`,
      "Content-Type": "application/json",
    };

    /** O que muda no Gmail, por ação. */
    const mudanca = (): { add: string[]; remove: string[] } => {
      switch (acao as Acao) {
        case "arquivar":         return { add: [], remove: ["INBOX"] };
        case "desarquivar":      return { add: ["INBOX"], remove: [] };
        case "ler":              return { add: [], remove: ["UNREAD"] };
        case "nao_ler":          return { add: ["UNREAD"], remove: [] };
        case "spam":             return { add: ["SPAM"], remove: ["INBOX"] };
        case "nao_spam":         return { add: ["INBOX"], remove: ["SPAM"] };
        case "favoritar":        return { add: ["STARRED"], remove: [] };
        case "desfavoritar":     return { add: [], remove: ["STARRED"] };
        // Mover para pasta REMOVE de INBOX, como o Gmail faz quando você
        // arrasta: senão a mensagem aparece nos dois lugares e "mover" não
        // moveu nada.
        case "mover_para_pasta": return { add: [label_id as string], remove: ["INBOX"] };
        case "tirar_da_pasta":   return { add: [], remove: [label_id as string] };
        default:                 return { add: [], remove: [] };
      }
    };

    let aplicados = 0;
    const falhas: { id: string; erro: string }[] = [];

    for (const m of mensagens) {
      const gid = m.message_id as string | null;
      if (!gid) {
        falhas.push({ id: m.id as string, erro: "sem id do Gmail (mensagem só local)" });
        continue;
      }

      try {
        let resp: Response;
        if (acao === "lixeira" || acao === "restaurar") {
          // Rota PRÓPRIA, não label. `TRASH` como label é aceito e produz um
          // estado meio-apagado que a interface do Gmail mostra de forma
          // estranha.
          resp = await fetch(
            `${GMAIL}/messages/${encodeURIComponent(gid)}/${acao === "lixeira" ? "trash" : "untrash"}`,
            { method: "POST", headers: cabecalhos },
          );
        } else {
          const { add, remove } = mudanca();
          resp = await fetch(`${GMAIL}/messages/${encodeURIComponent(gid)}/modify`, {
            method: "POST",
            headers: cabecalhos,
            body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
          });
        }

        const corpo = await resp.json().catch(() => null);
        if (!resp.ok) {
          const e = corpo as { error?: { message?: string } } | null;
          falhas.push({ id: m.id as string, erro: e?.error?.message ?? `HTTP ${resp.status}` });
          continue;
        }

        // As labels que o GMAIL devolve, não as que a gente supôs. É o que
        // mantém a coluna fiel: se o Google fez algo além do pedido -- e ele faz,
        // ao mover para spam -- a coluna reflete a verdade.
        const labelsAgora = (corpo as { labelIds?: string[] } | null)?.labelIds ?? null;

        await admin.from("emails")
          .update({
            ...(LOCAL[acao as string] ?? {}),
            ...(labelsAgora ? { labels: labelsAgora } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("id", m.id);

        aplicados++;
      } catch (e) {
        falhas.push({ id: m.id as string, erro: e instanceof Error ? e.message : String(e) });
      }
    }

    return json({ ok: aplicados > 0, aplicados, falhas });
  } catch (e) {
    console.error("gmail-modify", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
