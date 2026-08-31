/**
 * Pareamento por QR code.
 *
 * É o equivalente da dupla whatsapp-numbers + whatsapp-claim para provedores em
 * que o número não existe antes: na Meta você ESCOLHE um número do WABA, aqui
 * você CRIA uma instância e parea o próprio aparelho.
 *
 * Duas ações, ambas por POST:
 *   { acao: "iniciar" }   cria a instância, aponta o webhook, devolve o QR
 *   { acao: "consultar" } devolve o estado; ao conectar, grava a conexão
 *
 * O nome da instância é DETERMINÍSTICO por pessoa. Sem isso, fechar a tela e
 * voltar criaria uma segunda instância, o aparelho ficaria pareado à primeira e
 * o QR novo nunca conectaria — com a tela dizendo "aguardando" para sempre.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { carregarCredencial, explicarAusencia, resolverProvedor } from "../_shared/whatsapp/index.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

/**
 * `vionex-{org}-{pessoa}`, com os oito primeiros hexadígitos de cada uuid.
 *
 * Curto porque aparece na tela de aparelhos conectados do WhatsApp; com os dois
 * lados porque o servidor Evolution pode ser compartilhado entre organizações.
 * Só [a-z0-9-] — a Evolution usa o nome em rota de URL.
 */
function nomeDaInstancia(orgId: string, userId: string): string {
  const oito = (id: string) => id.replace(/[^a-f0-9]/gi, "").slice(0, 8).toLowerCase();
  return `vionex-${oito(orgId)}-${oito(userId)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Não autenticado" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ ok: false, error: "Não autenticado" }, 401);
    const userId = userData.user.id;

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: perfil } = await admin
      .from("profiles").select("org_id").eq("id", userId).maybeSingle();
    const orgId = perfil?.org_id;
    if (!orgId) return json({ ok: false, error: "Você não pertence a nenhuma organização" }, 403);

    const credencial = await carregarCredencial(admin, orgId);
    if (!credencial.ok) return json({ ok: false, error: explicarAusencia(credencial.motivo) }, 400);

    const prov = resolverProvedor(credencial.cred.provider);
    if (prov.formaDePareamento !== "qrcode") {
      return json({
        ok: false,
        error: "O WhatsApp desta empresa é o oficial da Meta. Escolha um número na lista.",
      }, 400);
    }

    const { acao } = await req.json().catch(() => ({}));
    const instancia = nomeDaInstancia(orgId, userId);

    // ---------- iniciar ----------
    if (acao === "iniciar") {
      const pareamento = await prov.iniciarPareamento(credencial.cred, instancia);

      // O webhook é apontado DEPOIS de a instância existir, e a falha aqui não
      // derruba o pareamento: sem webhook o envio funciona e só o recebimento
      // fica mudo. Melhor conectar e avisar do que recusar tudo.
      let avisoWebhook: string | null = null;
      try {
        await prov.apontarWebhook(
          credencial.cred,
          instancia,
          `${url}/functions/v1/whatsapp-webhook?token=${encodeURIComponent(credencial.verifyToken)}`,
        );
      } catch (e) {
        avisoWebhook = e instanceof Error ? e.message : String(e);
        console.error("whatsapp-pair: webhook não configurado", avisoWebhook);
      }

      return json({ ok: true, pareamento, avisoWebhook });
    }

    // ---------- consultar ----------
    if (acao === "consultar") {
      const pareamento = await prov.consultarPareamento(credencial.cred, instancia);

      if (pareamento.estado === "conectado") {
        const gravou = await gravarConexao(admin, {
          orgId, userId, instancia, provider: prov.nome,
          telefone: pareamento.telefone, nomePerfil: pareamento.nomePerfil,
        });
        if (!gravou.ok) return json({ ok: false, error: gravou.erro }, gravou.status);
        return json({ ok: true, pareamento, conexao: gravou.conexao });
      }

      return json({ ok: true, pareamento });
    }

    return json({ ok: false, error: 'Ação inválida. Use "iniciar" ou "consultar".' }, 400);
  } catch (e) {
    console.error("whatsapp-pair", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

type DadosConexao = {
  orgId: string;
  userId: string;
  instancia: string;
  provider: string;
  telefone: string | null;
  nomePerfil: string | null;
};

/**
 * Grava a conexão, ou atualiza a que já existe.
 *
 * Não é insert simples porque `consultar` é chamado em intervalo: o segundo
 * retorno "conectado" bateria no índice único e a tela mostraria erro depois de
 * ter dado certo.
 *
 * `phone_number_id` recebe o nome da instância. A coluna é NOT NULL e o índice
 * único global está nela — é o que garante que uma instância pertença a uma
 * pessoa só, o mesmo papel que ela cumpre para o número na Meta.
 */
async function gravarConexao(
  admin: ReturnType<typeof createClient>,
  d: DadosConexao,
): Promise<{ ok: true; conexao: unknown } | { ok: false; erro: string; status: number }> {
  const colunas = "id, phone_number_id, instance_name, display_phone_number, verified_name, daily_send_limit";

  const { data: existente } = await admin
    .from("whatsapp_connections")
    .select(colunas)
    .eq("org_id", d.orgId)
    .eq("user_id", d.userId)
    .eq("is_active", true)
    .maybeSingle();

  if (existente) {
    // Já conectada: só atualiza o que o pareamento descobriu. O telefone às
    // vezes só aparece na segunda consulta, então isto não é redundante.
    const { data } = await admin
      .from("whatsapp_connections")
      .update({
        display_phone_number: d.telefone ?? (existente as Record<string, string>).display_phone_number,
        verified_name: d.nomePerfil ?? (existente as Record<string, string>).verified_name,
      })
      .eq("id", (existente as { id: string }).id)
      .select(colunas)
      .single();
    return { ok: true, conexao: data ?? existente };
  }

  const { data: criada, error } = await admin
    .from("whatsapp_connections")
    .insert({
      org_id: d.orgId,
      user_id: d.userId,
      provider: d.provider,
      phone_number_id: d.instancia,
      instance_name: d.instancia,
      display_phone_number: d.telefone,
      verified_name: d.nomePerfil,
      scope_type: "user",
      is_active: true,
    })
    .select(colunas)
    .single();

  if (error) {
    // 23505 nos dois índices parciais, com saídas diferentes — mesmo tratamento
    // de whatsapp-claim.
    if (error.code === "23505") {
      const texto = `${error.message} ${error.details ?? ""}`;
      if (texto.includes("whatsapp_connections_number_key")) {
        return {
          ok: false,
          status: 409,
          erro: "Esta instância já está conectada a outra pessoa. Peça a um administrador para desconectá-la.",
        };
      }
      return {
        ok: false,
        status: 409,
        erro: "Você já tem um número conectado. Desconecte o atual antes de parear outro.",
      };
    }
    return { ok: false, status: 500, erro: error.message };
  }

  return { ok: true, conexao: criada };
}
