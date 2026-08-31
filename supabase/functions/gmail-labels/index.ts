/**
 * As PASTAS da conta de Gmail — que no Gmail se chamam labels.
 *
 * Duas ações:
 *   { acao: "listar" }                    devolve as pastas da pessoa
 *   { acao: "criar", nome: "Congressos" } cria uma e devolve o id
 *
 * O escopo `gmail.modify` já cobre as duas. Nada a pedir, nada a pagar.
 *
 * O QUE FICA DE FORA, E POR QUÊ
 *
 * As labels do SISTEMA (INBOX, SENT, DRAFT, SPAM, TRASH, UNREAD, STARRED,
 * IMPORTANT, CATEGORY_*) não aparecem na lista de pastas. Elas não são pastas:
 * são estados que a tela já expõe por outros botões, e oferecê-las como destino
 * de "mover para pasta" produziria coisas sem sentido -- mover para "não lido",
 * mover para "rascunhos".
 *
 * `CATEGORY_PERSONAL`, `CATEGORY_SOCIAL` e companhia são as abas do Gmail, não
 * pastas, e o Gmail não deixa aplicá-las à mão de todo jeito.
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

/** Estados, não pastas. Ver o cabeçalho. */
const DO_SISTEMA = new Set([
  "INBOX", "SENT", "DRAFT", "SPAM", "TRASH", "UNREAD", "STARRED", "IMPORTANT",
  "CHAT", "CATEGORY_PERSONAL", "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES", "CATEGORY_FORUMS",
]);

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

    // A caixa DESTA pessoa: cada um vê a própria na tela de E-mail, e listar as
    // pastas de outra conta seria vazar organização alheia.
    const { data: conexao } = await admin
      .from("email_connections")
      .select("email_address")
      .eq("org_id", orgId).eq("user_id", userData.user.id).eq("is_active", true)
      .maybeSingle();

    const tk = await obterAccessToken(admin, orgId, conexao?.email_address as string | null);
    if (!tk.ok) return json({ ok: false, error: tk.erro, motivo: tk.motivo }, 400);

    const cabecalhos = { Authorization: `Bearer ${tk.accessToken}`, "Content-Type": "application/json" };
    const { acao, nome } = await req.json().catch(() => ({ acao: "listar" }));

    // ---------- criar ----------
    if (acao === "criar") {
      const limpo = String(nome ?? "").trim();
      if (!limpo) return json({ ok: false, error: "Dê um nome à pasta." }, 400);
      if (limpo.length > 225) {
        // Limite do próprio Gmail. Recusar aqui dá mensagem melhor que o 400 dele.
        return json({ ok: false, error: "O nome da pasta é longo demais." }, 400);
      }

      const r = await fetch(`${GMAIL}/labels`, {
        method: "POST",
        headers: cabecalhos,
        body: JSON.stringify({
          name: limpo,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        const e = j as { error?: { message?: string } } | null;
        const msg = e?.error?.message ?? `HTTP ${r.status}`;
        // 409 do Gmail quando o nome já existe. Dizer isso é melhor que repassar
        // "Label name exists or conflicts".
        return json({
          ok: false,
          error: /exists|conflict/i.test(msg) ? `Já existe uma pasta chamada "${limpo}".` : msg,
        }, 400);
      }
      const criada = j as { id: string; name: string };
      return json({ ok: true, pasta: { id: criada.id, nome: criada.name } });
    }

    // ---------- listar ----------
    const r = await fetch(`${GMAIL}/labels`, { headers: cabecalhos });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      const e = j as { error?: { message?: string } } | null;
      return json({ ok: false, error: e?.error?.message ?? `HTTP ${r.status}` }, 400);
    }

    const todas = (j as { labels?: { id: string; name: string; type?: string }[] })?.labels ?? [];
    const pastas = todas
      .filter((l) => l.type !== "system" && !DO_SISTEMA.has(l.id))
      // Ordenada por nome: o Gmail devolve em ordem de criação, e uma lista de
      // pastas fora de ordem alfabética é impossível de percorrer com os olhos.
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .map((l) => ({ id: l.id, nome: l.name }));

    return json({ ok: true, pastas, conta: tk.email });
  } catch (e) {
    console.error("gmail-labels", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
