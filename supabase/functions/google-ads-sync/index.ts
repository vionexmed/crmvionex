/**
 * Sincroniza campanhas e métricas do Google Ads.
 *
 * O que ela busca, e por que só isso: nível de CAMPANHA e os últimos 30 dias.
 * É exatamente o recorte que o `meta-ads-sync` traz, e o painel soma os dois
 * lado a lado — trazer mais de um lado faria a comparação mentir sem avisar.
 *
 * ---------------------------------------------------------------------------
 * TRÊS ARMADILHAS DESTA API, e as três já custaram tempo em outros projetos
 * ---------------------------------------------------------------------------
 *
 * 1. MICROS. Todo valor monetário vem em milionésimos: R$ 1,00 chega como
 *    1000000. Gravar cru anunciaria investimento um milhão de vezes maior — e
 *    pareceria plausível, porque o gráfico manteria a forma. A divisão é aqui.
 *
 * 2. O DEVELOPER TOKEN não é opcional e não é o OAuth. É um segundo segredo,
 *    da EMPRESA, obtido no API Center de uma conta gerenciadora e sujeito a
 *    aprovação do Google. Sem ele a API responde DEVELOPER_TOKEN_NOT_APPROVED.
 *
 * 3. `login-customer-id` é obrigatório quando a conta de anúncio está sob um
 *    MCC, e o erro sem ele é `USER_PERMISSION_DENIED` — que parece problema de
 *    permissão da pessoa, não de cabeçalho faltando.
 *
 * O access_token NÃO é guardado: vive uma hora, e guardá-lo seria guardar algo
 * que expira antes do próximo uso. O refresh token é que fica.
 *
 * RESSALVA DECLARADA: escrita contra a documentação, sem uma conta de anúncio
 * para exercitar. Os erros da API chegam com o texto do Google, para o primeiro
 * sync ser diagnóstico em vez de adivinhação.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Versão da API numa constante: ela muda ~3x por ano e é UMA linha para subir. */
const API = "v18";
const ADS = `https://googleads.googleapis.com/${API}`;
const OAUTH = "https://oauth2.googleapis.com/token";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Micros → reais. `null` quando o campo não veio, para não gravar 0 como se fosse medido. */
const deMicros = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v) / 1_000_000;

const numero = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/**
 * A mensagem de erro do Google, que vem aninhada em três níveis diferentes
 * conforme a falha. Sem isto o erro chega na tela como "[object Object]".
 */
function erroDoGoogle(j: unknown): string {
  const o = j as {
    error?: { message?: string; status?: string };
    // searchStream devolve ARRAY, e o erro pode vir dentro do primeiro item
    0?: { error?: { message?: string } };
  } | null;
  const detalhe = (j as { error?: { details?: { errors?: { message?: string }[] }[] } })
    ?.error?.details?.[0]?.errors?.[0]?.message;
  return detalhe || o?.error?.message || o?.[0]?.error?.message ||
    (j ? JSON.stringify(j).slice(0, 500) : "Erro desconhecido");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let orgId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Não autenticado" }, 401);

    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ ok: false, error: "Não autenticado" }, 401);

    const { data: perfil } = await admin
      .from("profiles").select("org_id").eq("id", userData.user.id).maybeSingle();
    orgId = perfil?.org_id ?? null;
    if (!orgId) return json({ ok: false, error: "Você não pertence a nenhuma organização" }, 403);

    // ---------- credenciais ----------
    const { data: seg } = await admin
      .from("google_oauth_secrets")
      .select("client_id, client_secret, ads_developer_token, ads_refresh_token")
      .eq("org_id", orgId).maybeSingle();

    // Cada ausência tem mensagem PRÓPRIA: são quatro coisas obtidas em quatro
    // lugares diferentes, e "credencial faltando" mandaria a pessoa procurar
    // no lugar errado.
    if (!seg?.client_id || !seg?.client_secret) {
      return json({ ok: false, error: "Cadastre o Client ID e o Client Secret do Google em Integrações." }, 400);
    }
    if (!seg.ads_developer_token) {
      return json({
        ok: false,
        error: "Falta o developer token do Google Ads. Ele é obtido no API Center de uma conta gerenciadora (MCC) e passa por aprovação do Google.",
      }, 400);
    }
    if (!seg.ads_refresh_token) {
      return json({ ok: false, error: "Autorize o acesso ao Google Ads em Integrações antes de sincronizar." }, 400);
    }

    const { data: conta } = await admin
      .from("google_ads_accounts")
      .select("id, customer_id, login_customer_id")
      .eq("org_id", orgId).eq("is_active", true).maybeSingle();
    if (!conta) {
      return json({ ok: false, error: "Informe o ID da conta de anúncio do Google Ads em Integrações." }, 400);
    }

    // ---------- access_token a partir do refresh ----------
    const tk = await fetch(OAUTH, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: seg.client_id as string,
        client_secret: seg.client_secret as string,
        refresh_token: seg.ads_refresh_token as string,
        grant_type: "refresh_token",
      }),
    });
    const tkJson = await tk.json().catch(() => null);
    if (!tk.ok || !(tkJson as { access_token?: string })?.access_token) {
      return json({
        ok: false,
        error: `O Google recusou a autorização: ${erroDoGoogle(tkJson)}. Autorize de novo em Integrações.`,
      }, 400);
    }
    const accessToken = (tkJson as { access_token: string }).access_token;

    const cabecalhos: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": seg.ads_developer_token as string,
      "Content-Type": "application/json",
    };
    // Só quando existe: mandar vazio é diferente de não mandar, e o Google
    // recusa o cabeçalho presente com valor em branco.
    if (conta.login_customer_id) {
      cabecalhos["login-customer-id"] = String(conta.login_customer_id).replace(/\D/g, "");
    }

    const customer = String(conta.customer_id).replace(/\D/g, "");

    /** Uma consulta GAQL. `searchStream` devolve ARRAY de blocos, cada um com `results`. */
    async function consultar(query: string): Promise<Record<string, unknown>[]> {
      const r = await fetch(`${ADS}/customers/${customer}/googleAds:searchStream`, {
        method: "POST",
        headers: cabecalhos,
        body: JSON.stringify({ query }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(erroDoGoogle(j));
      const blocos = Array.isArray(j) ? j : [j];
      return blocos.flatMap((b) => (b as { results?: Record<string, unknown>[] })?.results ?? []);
    }

    // ---------- campanhas ----------
    const linhasCampanha = await consultar(`
      SELECT campaign.id, campaign.name, campaign.status,
             campaign.advertising_channel_type,
             campaign.start_date, campaign.end_date,
             campaign_budget.amount_micros
        FROM campaign
       WHERE campaign.status != 'REMOVED'
    `);

    const campanhas = linhasCampanha.map((l) => {
      const c = (l.campaign ?? {}) as Record<string, unknown>;
      const b = (l.campaignBudget ?? {}) as Record<string, unknown>;
      return {
        org_id: orgId,
        account_id: conta.id,
        google_campaign_id: String(c.id ?? ""),
        name: (c.name as string) || String(c.id ?? "sem nome"),
        status: (c.status as string) ?? null,
        channel_type: (c.advertisingChannelType as string) ?? null,
        daily_budget: deMicros(b.amountMicros),
        start_date: (c.startDate as string) || null,
        // A API usa 2037-12-30 para "sem fim". Gravar aquilo faria a tela
        // anunciar campanha terminando em 2037.
        end_date: c.endDate && c.endDate !== "2037-12-30" ? (c.endDate as string) : null,
        raw: l,
        synced_at: new Date().toISOString(),
      };
    }).filter((c) => c.google_campaign_id);

    if (campanhas.length) {
      const { error } = await admin.from("google_ads_campaigns")
        .upsert(campanhas, { onConflict: "org_id,google_campaign_id" });
      if (error) throw error;
    }

    // ---------- métricas por dia ----------
    //
    // LAST_30_DAYS, igual ao Meta. `segments.date` é o que quebra por dia; sem
    // ele a API devolveria o total do período numa linha e o gráfico de
    // evolução ficaria com um ponto só.
    const linhasMetrica = await consultar(`
      SELECT campaign.id, segments.date,
             metrics.cost_micros, metrics.impressions, metrics.clicks,
             metrics.conversions, metrics.conversions_value,
             metrics.ctr, metrics.average_cpc
        FROM campaign
       WHERE segments.date DURING LAST_30_DAYS
    `);

    const metricas = linhasMetrica.map((l) => {
      const c = (l.campaign ?? {}) as Record<string, unknown>;
      const m = (l.metrics ?? {}) as Record<string, unknown>;
      const s = (l.segments ?? {}) as Record<string, unknown>;
      return {
        org_id: orgId,
        campaign_id: String(c.id ?? ""),
        dia: s.date as string,
        spend: deMicros(m.costMicros) ?? 0,
        impressions: numero(m.impressions),
        clicks: numero(m.clicks),
        // Fracionário de propósito: conversão com peso 0,5 existe, e arredondar
        // aqui perderia a soma correta do mês.
        conversions: numero(m.conversions),
        conversion_value: numero(m.conversionsValue),
        // `ctr` já vem como FRAÇÃO (0.0123), não porcentagem. O Meta manda
        // porcentagem. Multiplico para as duas colunas dizerem a mesma coisa.
        ctr: m.ctr === undefined ? null : Number(m.ctr) * 100,
        cpc: deMicros(m.averageCpc),
        raw: l,
        synced_at: new Date().toISOString(),
      };
    }).filter((m) => m.campaign_id && m.dia);

    if (metricas.length) {
      const { error } = await admin.from("google_ads_insights")
        .upsert(metricas, { onConflict: "org_id,campaign_id,dia" });
      if (error) throw error;
    }

    await admin.from("google_ads_sync_log").insert({
      org_id: orgId, ok: true,
      campanhas: campanhas.length, dias: metricas.length,
    });

    return json({ ok: true, campanhas: campanhas.length, dias: metricas.length });
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    console.error("google-ads-sync", mensagem);
    // Registrar a FALHA também: sem isso, "não atualiza e não diz por quê" é
    // indistinguível de "não há campanha".
    if (orgId) {
      await admin.from("google_ads_sync_log").insert({ org_id: orgId, ok: false, mensagem: mensagem.slice(0, 1000) });
    }
    return json({ ok: false, error: mensagem }, 500);
  }
});
