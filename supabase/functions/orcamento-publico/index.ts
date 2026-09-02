/**
 * O orçamento visto e decidido pelo CLIENTE, sem login.
 *
 * O cliente não tem sessão: `auth.uid()` é nulo e toda política de RLS de
 * `orcamentos` recusa. Por isso o acesso público não passa por RLS — passa por
 * aqui, com `service_role`, devolvendo campo escolhido a dedo.
 *
 * O QUE NUNCA SAI: `observacoes` (nota interna), `owner_id`, `org_id`, o id do
 * negócio, e qualquer outro orçamento. A consulta é sempre por `token`, nunca
 * por id — assim não há como pedir "o próximo".
 *
 * A PÁGINA É SERVIDA PELO APP, não por esta função. O runtime das Edge
 * Functions troca `text/html` por `text/plain` + `nosniff` (anti-phishing no
 * domínio compartilhado), então uma página HTML devolvida daqui apareceria como
 * código-fonte. JSON passa; é o que esta função devolve.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Cabe no `token` da tabela: 64 hex. Recusar antes de consultar evita virar
 *  um oráculo de "existe/não existe" para string qualquer. */
const TOKEN_VALIDO = /^[0-9a-f]{64}$/;

type Item = {
  nome: string; descricao: string | null; unidade: string;
  preco_unit: number; quantidade: number; desconto: number; ordem: number;
};

const totalDoItem = (i: Item) =>
  Math.max(0, Number(i.preco_unit) * Number(i.quantidade) - Number(i.desconto));

/** Fim do dia da validade: um orçamento válido "até 16/09" vale o dia 16 todo. */
function venceu(validoAte: string | null): boolean {
  if (!validoAte) return false;
  const fim = new Date(`${validoAte}T23:59:59`);
  return Date.now() > fim.getTime();
}

/**
 * A atividade que aparece na ficha do contato — ou do negócio.
 *
 * É o que amarra o ciclo do orçamento ao histórico. `completed_at` preenchido
 * porque o evento JÁ aconteceu; sem ele a ficha mostraria "Orçamento aprovado"
 * como coisa a fazer.
 *
 * SEM CONTATO E SEM NEGÓCIO, não grava nada. O contato virou opcional, e uma
 * atividade sem os dois seria uma linha órfã: aparece na tela de Atividades
 * sem dizer de quem é, e não entra em ficha nenhuma. O registro do que
 * aconteceu não se perde -- ele está no próprio orçamento, em `decidido_por` e
 * `decidido_em`. O que não existe é o eco no histórico.
 *
 * Falha aqui NÃO derruba a decisão: o cliente já clicou, e recusar a aprovação
 * porque o histórico não gravou seria perder o que importa para preservar o
 * acessório. O erro vai para o log.
 */
async function registrarAtividade(
  admin: ReturnType<typeof createClient>,
  orc: { id: string; org_id: string; contact_id: string | null; deal_id: string | null; numero: number },
  titulo: string,
  corpo: string | null,
) {
  if (!orc.contact_id && !orc.deal_id) return;

  const { error } = await admin.from("activities").insert({
    org_id: orc.org_id,
    contact_id: orc.contact_id,
    deal_id: orc.deal_id,
    type: "orcamento",
    title: titulo,
    body: corpo,
    completed_at: new Date().toISOString(),
  });
  if (error) console.error("orcamento-publico: atividade não gravada", error);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const url = new URL(req.url);
    const token = (url.searchParams.get("token") ?? "").trim();

    if (!TOKEN_VALIDO.test(token)) {
      return json({ error: "Link inválido." }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: orc, error } = await admin
      .from("orcamentos")
      .select("id, org_id, numero, titulo, status, valido_ate, desconto, moeda, contact_id, deal_id, visto_em, decidido_em, decidido_por, motivo_recusa")
      .eq("token", token)
      .maybeSingle();

    if (error) throw error;
    // Mesma resposta para token malformado e token inexistente: distinguir os
    // dois deixaria descobrir quais existem, um de cada vez.
    if (!orc) return json({ error: "Link inválido." }, 404);

    const { data: itens } = await admin
      .from("orcamento_itens")
      .select("nome, descricao, unidade, preco_unit, quantidade, desconto, ordem")
      .eq("orcamento_id", orc.id)
      .order("ordem");

    const lista = (itens ?? []) as Item[];
    const subtotal = lista.reduce((s, i) => s + totalDoItem(i), 0);
    const descontoGeral = Math.min(Number(orc.desconto) || 0, subtotal);

    // O nome da empresa que ENVIA, para o cliente saber de quem é o orçamento.
    const { data: org } = await admin
      .from("organizations").select("name").eq("id", orc.org_id).maybeSingle();

    const expirado = venceu(orc.valido_ate);

    const publico = {
      numero: orc.numero,
      titulo: orc.titulo,
      empresa: org?.name ?? null,
      status: orc.status,
      valido_ate: orc.valido_ate,
      expirado,
      moeda: orc.moeda,
      itens: lista.map((i) => ({
        nome: i.nome, descricao: i.descricao, unidade: i.unidade,
        preco_unit: Number(i.preco_unit), quantidade: Number(i.quantidade),
        desconto: Number(i.desconto), total: totalDoItem(i),
      })),
      subtotal,
      desconto: descontoGeral,
      total: subtotal - descontoGeral,
      decidido_em: orc.decidido_em,
      decidido_por: orc.decidido_por,
      motivo_recusa: orc.motivo_recusa,
    };

    // ── Ver ──
    if (req.method === "GET") {
      /*
        `visto_em` só na PRIMEIRA leitura, e o registro é o mesmo critério do
        e-mail: "visto" quer dizer que chegou aos olhos, não quantas vezes.
        Regravar a cada F5 apagaria a informação útil, que é QUANDO ele abriu.
      */
      if (!orc.visto_em) {
        await admin.from("orcamentos")
          .update({ visto_em: new Date().toISOString() }).eq("id", orc.id);
        await registrarAtividade(
          admin, orc,
          `Orçamento #${orc.numero} visualizado pelo cliente`,
          "O cliente abriu o link do orçamento.",
        );
      }
      return json(publico);
    }

    // ── Decidir ──
    if (req.method === "POST") {
      const { decisao, nome, motivo } = await req.json().catch(() => ({}));

      if (decisao !== "aprovado" && decisao !== "recusado") {
        return json({ error: "Decisão inválida." }, 400);
      }
      /*
        DECIDIDO É DECIDIDO. Sem esta guarda o link vira um botão permanente de
        mudar de ideia, e o CRM passaria a mostrar uma decisão diferente da que
        a equipe já leu e agiu em cima.
      */
      if (orc.decidido_em) {
        return json({ error: "Este orçamento já foi respondido.", ...publico }, 409);
      }
      if (expirado) {
        return json({ error: "Este orçamento venceu. Peça um novo ao seu contato.", ...publico }, 410);
      }

      const quem = typeof nome === "string" ? nome.trim().slice(0, 120) : "";
      if (!quem) return json({ error: "Escreva seu nome para confirmar." }, 400);

      const razao = decisao === "recusado"
        ? (typeof motivo === "string" ? motivo.trim().slice(0, 500) : "")
        : null;

      const agora = new Date().toISOString();
      const { error: erroUpdate } = await admin.from("orcamentos").update({
        status: decisao,
        decidido_em: agora,
        decidido_por: quem,
        motivo_recusa: razao || null,
        updated_at: agora,
      }).eq("id", orc.id)
        // A condição na PRÓPRIA escrita, e não só no `if` acima: entre a
        // checagem e o update cabe um segundo clique. Sem isto, dois envios
        // simultâneos gravariam duas decisões, e a última venceria em silêncio.
        .is("decidido_em", null);

      if (erroUpdate) throw erroUpdate;

      await registrarAtividade(
        admin, orc,
        `Orçamento #${orc.numero} ${decisao === "aprovado" ? "aprovado" : "recusado"} por ${quem}`,
        razao ? `Motivo: ${razao}` : null,
      );

      return json({
        ...publico,
        status: decisao,
        decidido_em: agora,
        decidido_por: quem,
        motivo_recusa: razao || null,
      });
    }

    return json({ error: "Método não suportado." }, 405);
  } catch (e) {
    console.error("orcamento-publico", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
