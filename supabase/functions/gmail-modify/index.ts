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
  /*
   * MOVER PARA PASTA sai da caixa de entrada, e faltava dizer isso.
   *
   * A chamada ao Gmail remove `INBOX` -- é o que "mover" significa lá -- mas
   * este mapa não gravava nada, e o filtro da caixa de entrada do CRM é
   * `!is_archived`. Resultado: a mensagem saía da caixa no Gmail e continuava
   * na caixa aqui. Mover não movia, do lado que a pessoa está olhando.
   */
  mover_para_pasta: { is_archived: true },
  tirar_da_pasta:   { is_archived: false },
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
    const { data: mensagens, error: erroBusca } = await admin
      .from("emails")
      .select("id, message_id, labels, synced_from")
      .eq("org_id", orgId)
      .in("id", ids as string[]);

    /*
     * O erro do select NÃO pode ser descartado.
     *
     * Sem esta checagem, uma coluna que falta -- `labels` só existe desde
     * 20260831180000 -- fazia `mensagens` vir undefined e a resposta ser
     * "Mensagens não encontradas". Uma migração pendente aparecia como mensagem
     * inexistente, que é a pista errada.
     */
    if (erroBusca) {
      console.error("gmail-modify: falha ao buscar mensagens", erroBusca);
      return json({ ok: false, error: `Erro ao buscar as mensagens: ${erroBusca.message}` }, 500);
    }
    if (!mensagens?.length) return json({ ok: false, error: "Mensagens não encontradas" }, 404);

    /*
     * QUAL CAIXA, e o que fazer quando não se sabe.
     *
     * `synced_from` guarda o e-mail da caixa de onde a mensagem veio. Mensagens
     * sincronizadas ANTES de essa coluna existir têm nulo ali -- o
     * `gmail-attachment` já registra esse caso.
     *
     * O código anterior passava `null` nessas, e `obterAccessToken` com e-mail
     * nulo devolve o token MAIS RECENTE DA ORGANIZAÇÃO -- que pode ser a caixa de
     * outra pessoa. O Gmail então recebe um id de mensagem que não existe naquela
     * caixa e responde 404 "Requested entity was not found". Na tela: a ação
     * simplesmente não acontece.
     *
     * Agora a caixa conhecida vem primeiro e as outras ficam como RESERVA, para
     * mensagem antiga funcionar em vez de falhar. É tentativa e erro, sim -- mas
     * o alvo é `messages/{id}`, que só existe na caixa certa: tentar na errada
     * não altera nada, só recebe 404.
     */
    const caixaConhecida = [...new Set(mensagens.map((m) => m.synced_from).filter(Boolean))];
    const contas: (string | null)[] = [...caixaConhecida as string[]];

    if (contas.length !== 1) {
      // Sem caixa certa (ou várias): todas as conectadas, em ordem de uso.
      const { data: tokens } = await admin
        .from("gmail_oauth_tokens").select("email")
        .eq("org_id", orgId).order("updated_at", { ascending: false });
      for (const t of tokens ?? []) {
        const e = t.email as string | null;
        if (e && !contas.includes(e)) contas.push(e);
      }
      if (contas.length === 0) contas.push(null);
    }

    /** Token por caixa, buscado uma vez. Nulo quando a conta não dá token. */
    const tokenDe = new Map<string | null, string>();
    for (const conta of contas) {
      const t = await obterAccessToken(admin, orgId, conta);
      if (t.ok) tokenDe.set(conta, t.accessToken);
      // A primeira conta é a mais provável; se ela nem token dá, vale relatar.
      else if (conta === contas[0]) {
        return json({ ok: false, error: t.erro, motivo: t.motivo }, 400);
      }
    }
    if (tokenDe.size === 0) {
      return json({
        ok: false,
        error: "Nenhuma conta de e-mail conectada. Conecte em Configurações › Conectar e-mail.",
      }, 400);
    }

    const cabecalhosDe = (conta: string | null) => ({
      Authorization: `Bearer ${tokenDe.get(conta)}`,
      "Content-Type": "application/json",
    });

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

      /*
       * A caixa da mensagem primeiro; as outras só como reserva.
       *
       * `synced_from` preenchido acerta na primeira tentativa, que é o caso
       * normal. Nulo -- mensagem antiga -- passa por todas até uma reconhecer o
       * id.
       */
      const ordem = m.synced_from
        ? [m.synced_from as string, ...contas.filter((c) => c !== m.synced_from)]
        : contas;

      let aplicou = false;
      let ultimoErro = "não foi possível aplicar em nenhuma das contas conectadas";

      for (const conta of ordem) {
        if (!tokenDe.has(conta)) continue;

        try {
          let resp: Response;
          if (acao === "lixeira" || acao === "restaurar") {
            // Rota PRÓPRIA, não label. `TRASH` como label é aceito e produz um
            // estado meio-apagado que a interface do Gmail mostra de forma
            // estranha.
            resp = await fetch(
              `${GMAIL}/messages/${encodeURIComponent(gid)}/${acao === "lixeira" ? "trash" : "untrash"}`,
              { method: "POST", headers: cabecalhosDe(conta) },
            );
          } else {
            const { add, remove } = mudanca();
            resp = await fetch(`${GMAIL}/messages/${encodeURIComponent(gid)}/modify`, {
              method: "POST",
              headers: cabecalhosDe(conta),
              body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
            });
          }

          const corpo = await resp.json().catch(() => null);

          if (!resp.ok) {
            const e = corpo as { error?: { message?: string } } | null;
            ultimoErro = e?.error?.message ?? `HTTP ${resp.status}`;
            /*
             * 404 é "esta caixa não conhece esta mensagem" -- vale tentar a
             * próxima. Qualquer outro status é problema de verdade (401 de token,
             * 403 de escopo, 429 de cota) e repetir em outra caixa só multiplica
             * a falha.
             */
            if (resp.status === 404) continue;
            break;
          }

          // As labels que o GMAIL devolve, não as que a gente supôs. É o que
          // mantém a coluna fiel: se o Google fez algo além do pedido -- e ele
          // faz, ao mover para spam -- a coluna reflete a verdade.
          const labelsAgora = (corpo as { labelIds?: string[] } | null)?.labelIds ?? null;

          await admin.from("emails")
            .update({
              ...(LOCAL[acao as string] ?? {}),
              ...(labelsAgora ? { labels: labelsAgora } : {}),
              // Descoberta a caixa de uma mensagem antiga, ela fica gravada: a
              // próxima ação acerta de primeira em vez de varrer tudo de novo.
              ...(conta && !m.synced_from ? { synced_from: conta } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq("id", m.id);

          aplicou = true;
          break;
        } catch (e) {
          ultimoErro = e instanceof Error ? e.message : String(e);
        }
      }

      if (aplicou) aplicados++;
      else falhas.push({ id: m.id as string, erro: ultimoErro });
    }

    return json({ ok: aplicados > 0, aplicados, falhas });
  } catch (e) {
    console.error("gmail-modify", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
