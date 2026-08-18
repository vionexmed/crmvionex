/**
 * Resumo diário no Slack — 20h de Brasília, todo dia.
 *
 * Chamado pelo cron `slack-daily-summary` (pg_cron, 23h UTC). Também aceita
 * chamada manual com { org_id } para teste.
 *
 * A verificação de JWT fica LIGADA (a function não entra no config.toml): o
 * cron manda a chave service_role como Bearer, que é um JWT válido. É o mesmo
 * arranjo de process-automation. Desligar seria abrir o endpoint sem ganho.
 *
 * A URL do webhook mora em `org_secrets`, não em `integration_configs`: é
 * credencial — quem a tem posta no canal da empresa. Aquela tabela tem RLS
 * habilitada e nenhuma política, então só service_role a alcança.
 *
 * Se não houver webhook configurado, encerra com 200 sem fazer nada. Um projeto
 * que ainda não ligou o Slack não deve gerar erro no log toda noite.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const nf = new Intl.NumberFormat("pt-BR");
const moeda = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);

/** Seta de tendência. Sem base de comparação não inventa direção. */
function delta(hoje: number | null, antes: number | null): string {
  if (hoje === null || antes === null) return "";
  if (antes === 0) return hoje > 0 ? " :arrow_up:" : "";
  const p = Math.round(((hoje - antes) / antes) * 100);
  if (p === 0) return " →";
  return p > 0 ? ` :arrow_up: ${p}%` : ` :arrow_down: ${Math.abs(p)}%`;
}

/**
 * `sdr_metrics` é RETURNS TABLE: o supabase-js devolve um ARRAY com uma linha,
 * e as colunas vêm em snake_case. Tratar como objeto de chaves camelCase
 * (como o painel nomeia os tiles) devolveria tudo undefined e o resumo sairia
 * vazio sem erro nenhum.
 */
/**
 * Chamador de RPC. O cliente aqui não carrega o tipo `Database`, então
 * `sb.rpc(nome, args)` reclama que espera `undefined` como argumento.
 *
 * O `.call(sb, ...)` NÃO é decoração: `rpc` precisa do `this` para alcançar
 * `this.rest`. Destacar o método numa variável faz a chamada estourar de forma
 * síncrona, antes de qualquer await — bug que já custou um botão travado em
 * "Removendo…" (ver src/test/rpc-this.test.ts).
 */
type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

type LinhaMetricas = {
  leads_recebidos: number | null;
  abordagens: number | null;
  taxa_entrega: number | null;
  taxa_resposta: number | null;
  conversas_iniciadas: number | null;
  reunioes: number | null;
  oportunidades: number | null;
  vendas_sdr: number | null;
  tempo_resposta_min: number | null;
  aguardando_humano: number | null;
  leads_whatsapp: number | null;
};

const primeira = (d: unknown): Partial<LinhaMetricas> =>
  (Array.isArray(d) ? (d[0] as LinhaMetricas) : null) ?? {};

/** Janela de um dia em America/Sao_Paulo, convertida para instantes UTC. */
function janelaDoDia(offsetDias: number): { de: string; ate: string; rotulo: string } {
  const agora = new Date();
  // O Brasil é UTC-3 sem horário de verão desde 2019.
  const saoPaulo = new Date(agora.getTime() - 3 * 3600_000);
  saoPaulo.setUTCDate(saoPaulo.getUTCDate() - offsetDias);
  const y = saoPaulo.getUTCFullYear();
  const m = saoPaulo.getUTCMonth();
  const d = saoPaulo.getUTCDate();
  // Meia-noite local = 03:00 UTC. Intervalo semiaberto, como no painel.
  const de = new Date(Date.UTC(y, m, d, 3, 0, 0));
  const ate = new Date(Date.UTC(y, m, d + 1, 3, 0, 0));
  return {
    de: de.toISOString(),
    ate: ate.toISOString(),
    rotulo: `${String(d).padStart(2, "0")}/${String(m + 1).padStart(2, "0")}`,
  };
}

async function montarMensagem(
  rpc: Rpc,
  orgId: string,
  nomeOrg: string,
  dias: number,
) {
  const hoje = janelaDoDia(0);
  const ontem = janelaDoDia(1);

  const [mHoje, mOntem, porPessoa, parados] = await Promise.all([
    rpc("sdr_metrics",   { _org_id: orgId, _from: hoje.de,  _to: hoje.ate }),
    rpc("sdr_metrics",   { _org_id: orgId, _from: ontem.de, _to: ontem.ate }),
    rpc("sdr_by_owner",  { _org_id: orgId, _from: hoje.de,  _to: hoje.ate }),
    rpc("deals_parados", { _org_id: orgId, _dias: dias, _limite: 5 }),
  ]);

  // Uma falha de bloco não deve matar o resumo inteiro: o dono prefere receber
  // parte a não receber nada.
  const erros: string[] = [];
  for (const [nome, r] of [["números", mHoje], ["por pessoa", porPessoa], ["parados", parados]] as const) {
    if (r.error) erros.push(`${nome}: ${r.error.message}`);
  }

  const h = primeira(mHoje.data);
  const o = primeira(mOntem.data);

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Resumo do dia · ${hoje.rotulo}`, emoji: true },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `${nomeOrg} · comparado com ${ontem.rotulo}` }],
    },
  ];

  // ── Números do dia ──
  const linhas: Array<[string, keyof LinhaMetricas]> = [
    ["Leads recebidos", "leads_recebidos"],
    ["Abordagens", "abordagens"],
    ["Conversas iniciadas", "conversas_iniciadas"],
    ["Reuniões", "reunioes"],
    ["Oportunidades", "oportunidades"],
    ["Vendas", "vendas_sdr"],
  ];

  const campos = linhas
    .filter(([, k]) => h[k] !== null && h[k] !== undefined)
    .map(([rotulo, k]) => ({
      type: "mrkdwn",
      text: `*${rotulo}*\n${nf.format(h[k] as number)}${delta(h[k] ?? null, o[k] ?? null)}`,
    }));

  if (campos.length) {
    // O Slack aceita no máximo 10 campos por bloco de seção.
    for (let i = 0; i < campos.length; i += 6) {
      blocks.push({ type: "section", fields: campos.slice(i, i + 6) });
    }
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_Nenhum número disponível para hoje._" },
    });
  }

  // ── Lead esperando atendimento: o número que gera ação ──
  const esperando = h.aguardando_humano;
  if (typeof esperando === "number") {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: esperando > 0
          ? `:hourglass_flowing_sand: *${nf.format(esperando)} ${esperando === 1 ? "lead esperando" : "leads esperando"} atendimento* — ninguém tocou ainda.`
          : ":white_check_mark: *Nenhum lead esperando atendimento.*",
      },
    });
  }

  // ── Desempenho por pessoa ──
  type Pessoa = { pessoa: string; leads: number; abordagens: number; reunioes: number; vendas: number };
  const pessoas = ((porPessoa.data ?? []) as Pessoa[])
    .filter((p) => p.leads || p.abordagens || p.reunioes || p.vendas);

  if (pessoas.length) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Por pessoa hoje*\n" + pessoas
          .map((p) => `• ${p.pessoa} — ${p.leads} leads · ${p.abordagens} abordagens · ${p.reunioes} reuniões · ${p.vendas} vendas`)
          .join("\n"),
      },
    });
  }

  // ── Negócio parado ──
  type Parado = { titulo: string; contato: string; responsavel: string; valor: number; dias_parado: number };
  const semMovimento = (parados.data ?? []) as Parado[];

  if (semMovimento.length) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Parados há mais de ${dias} dias*\n` + semMovimento
          .map((d) => `• ${d.titulo} — ${d.contato} · ${moeda(Number(d.valor))} · ${d.dias_parado} dias · ${d.responsavel}`)
          .join("\n"),
      },
    });
  }

  if (erros.length) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `:warning: Parte do resumo falhou — ${erros.join(" | ")}` }],
    });
  }

  return { blocks, texto: `Resumo do dia ${hoje.rotulo} — ${nomeOrg}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const corpo = await req.json().catch(() => ({}));
    const { org_id, all_orgs } = corpo as { org_id?: string; all_orgs?: boolean };

    // Quais organizações processar. O cron manda all_orgs; teste manda org_id.
    let orgs: { id: string; name: string }[] = [];
    if (all_orgs) {
      const { data } = await sb.from("organizations").select("id, name");
      orgs = data ?? [];
    } else if (org_id) {
      const { data } = await sb.from("organizations").select("id, name").eq("id", org_id).maybeSingle();
      if (data) orgs = [data];
    } else {
      return new Response(JSON.stringify({ error: "Informe org_id ou all_orgs" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const resultado: Record<string, string> = {};

    for (const org of orgs) {
      const { data: segredo } = await sb
        .from("org_secrets")
        .select("key_value")
        .eq("org_id", org.id)
        .eq("key_name", "slack_webhook_url")
        .maybeSingle();

      const webhook = segredo?.key_value;
      if (!webhook) {
        // Ninguém configurou. Não é falha.
        resultado[org.id] = "sem webhook";
        continue;
      }

      const { data: cfg } = await sb
        .from("integration_configs")
        .select("config, is_active")
        .eq("org_id", org.id)
        .eq("provider", "slack")
        .maybeSingle();

      const conf = (cfg?.config ?? {}) as Record<string, unknown>;
      if (cfg?.is_active === false || conf.daily_summary === false) {
        resultado[org.id] = "desligado";
        continue;
      }

      const dias = Number(conf.stale_days) > 0 ? Number(conf.stale_days) : 7;
      const rpc: Rpc = (fn, args) => (sb.rpc as unknown as Rpc).call(sb, fn, args);
      const { blocks, texto } = await montarMensagem(rpc, org.id, org.name, dias);

      const r = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: texto, blocks }),
      });

      // O Slack devolve "ok" em texto puro, não JSON.
      const corpoResposta = await r.text();
      resultado[org.id] = r.ok ? "enviado" : `falhou: HTTP ${r.status} ${corpoResposta.slice(0, 80)}`;
    }

    return new Response(JSON.stringify({ ok: true, resultado }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ level: "error", function: "slack-daily-summary", error: msg }));
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
