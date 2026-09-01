import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const GRAPH = 'https://graph.facebook.com/v21.0';

type RawAcct = {
  id: string;
  name?: string;
  account_id?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
  business?: { id?: string; name?: string };
};

async function fetchAll(url: string): Promise<any[]> {
  const out: any[] = [];
  let next: string | null = url;
  let safety = 0;
  while (next && safety < 20) {
    const r = await fetch(next);
    const j = await r.json();
    if (j?.error) throw new Error(j.error.message || 'Graph API error');
    if (Array.isArray(j.data)) out.push(...j.data);
    next = j?.paging?.next || null;
    safety++;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: profile } = await supabase.from('profiles').select('org_id').eq('id', user.id).single();
    const orgId = profile?.org_id;
    if (!orgId) return new Response(JSON.stringify({ error: 'No org' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    /*
      O TOKEN É DA ORGANIZAÇÃO, não do projeto.

      Ele vinha de `Deno.env.get('META_ACCESS_TOKEN')` -- um secret só para o
      Supabase inteiro. Num CRM multiempresa isso é errado por construção: duas
      organizações têm contas de anúncio diferentes e não podem compartilhar
      credencial. E era o motivo do erro que ninguém conseguia resolver: o
      formulário do CRM gravava o token em `integration_configs` e a função lia
      de outro lugar, então preencher o campo não mudava nada.

      `org_secrets` é a mesma tabela onde o webhook do Slack vive: RLS
      habilitada e NENHUMA política, então o navegador não alcança. O
      `integration_configs`, que guardava o token antes, é lido por qualquer
      membro da organização.

      O env continua como reserva para não derrubar quem já tinha o secret
      configurado antes desta mudança.
    */
    const { data: segredo } = await supabase
      .from('org_secrets')
      .select('key_value')
      .eq('org_id', orgId)
      .eq('key_name', 'meta_access_token')
      .maybeSingle();

    const token = segredo?.key_value || Deno.env.get('META_ACCESS_TOKEN');
    if (!token) {
      return new Response(JSON.stringify({
        error: 'Nenhum token do Meta cadastrado para esta organização. Configure em Integrações → Meta Ads.',
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Optional body: { accounts_only?: boolean, account_ids?: string[] }
    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    const accountsOnly: boolean = !!body?.accounts_only;
    const filterAccountIds: string[] | null = Array.isArray(body?.account_ids) && body.account_ids.length > 0 ? body.account_ids : null;

    const startedAt = Date.now();
    let totalRecords = 0;
    let accountsCount = 0;
    let campaignsCount = 0;
    let insightsCount = 0;
    const warnings: string[] = [];

    const discovered: Map<string, RawAcct & { business_id?: string | null; business_name?: string | null }> = new Map();
    const acctFields = 'id,name,account_id,currency,timezone_name,account_status,business';

    /*
      0) A CONTA QUE A ORGANIZAÇÃO CONFIGUROU, primeiro e direto.

      A descoberta abaixo é toda por `/me/...`, e `/me` não resolve para
      ninguém quando o token é de USUÁRIO DO SISTEMA, do Business Manager --
      que é o tipo certo para integração servidor-a-servidor. Com um token
      desses os dois passos seguintes falham, `discovered` fica vazio, e a
      resposta era "Nenhuma conta de anúncios encontrada para esse token":
      culpa o token quando o problema é o CAMINHO.

      Consultar `act_<id>` não passa por `/me` e funciona com os dois tipos.
      Por isso vem antes: é o caminho que sempre existe quando o id está
      preenchido.
    */
    const { data: cfg } = await supabase
      .from('integration_configs').select('config')
      .eq('org_id', orgId).eq('provider', 'meta').maybeSingle();

    const idBruto = (cfg?.config as { ad_account_id?: string } | null)?.ad_account_id?.trim();
    const contaConfig = idBruto
      ? (idBruto.startsWith('act_') ? idBruto : `act_${idBruto}`)
      : null;

    if (contaConfig) {
      try {
        const r = await fetch(`${GRAPH}/${contaConfig}?fields=${acctFields}&access_token=${token}`);
        const a = await r.json();
        if (a?.error) throw new Error(a.error.message || 'Graph API error');
        discovered.set(a.id, { ...a, business_id: a.business?.id ?? null, business_name: a.business?.name ?? null });
      } catch (e: any) {
        warnings.push(`conta ${contaConfig}: ${e?.message || e}`);
      }
    }

    // 1) Discover accounts via /me/adaccounts (direct user access)
    try {
      const direct = await fetchAll(`${GRAPH}/me/adaccounts?fields=${acctFields}&limit=200&access_token=${token}`);
      for (const a of direct as RawAcct[]) {
        discovered.set(a.id, { ...a, business_id: a.business?.id ?? null, business_name: a.business?.name ?? null });
      }
    } catch (e: any) {
      warnings.push(`me/adaccounts: ${e?.message || e}`);
    }

    // 2) Discover via Business Managers (owned + client ad accounts)
    try {
      const bms = await fetchAll(`${GRAPH}/me/businesses?fields=id,name&limit=100&access_token=${token}`);
      for (const bm of bms) {
        const bmId = bm.id;
        const bmName = bm.name;
        for (const path of ['owned_ad_accounts', 'client_ad_accounts']) {
          try {
            const list = await fetchAll(`${GRAPH}/${bmId}/${path}?fields=${acctFields}&limit=200&access_token=${token}`);
            for (const a of list as RawAcct[]) {
              const prev = discovered.get(a.id);
              discovered.set(a.id, {
                ...(prev || {}),
                ...a,
                business_id: a.business?.id ?? bmId,
                business_name: a.business?.name ?? bmName,
              });
            }
          } catch (e: any) {
            warnings.push(`${path} (BM ${bmName}): ${e?.message || e}`);
          }
        }
      }
    } catch (e: any) {
      warnings.push(`me/businesses: ${e?.message || e} — verifique se o token tem o escopo business_management`);
    }

    if (discovered.size === 0) {
      await supabase.from('meta_sync_log').insert({
        org_id: orgId, sync_type: accountsOnly ? 'accounts' : 'full', status: 'error',
        error_message: warnings.join(' | ') || 'Nenhuma conta encontrada',
        records_synced: 0, duration_ms: Date.now() - startedAt, finished_at: new Date().toISOString(),
      });
      const saida = contaConfig
        ? `Não consegui ler a conta ${contaConfig} com este token. Confira se o ID está certo e se o token tem acesso a ela.`
        : 'Nenhuma conta encontrada. Preencha o ID da conta de anúncio em Integrações — com ele a busca não depende de /me, que não funciona com token de Usuário do Sistema.';
      return new Response(JSON.stringify({ error: saida, warnings }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Upsert discovered accounts
    for (const a of discovered.values()) {
      await supabase.from('meta_ad_accounts').upsert({
        org_id: orgId,
        meta_account_id: a.id,
        name: a.name || a.id,
        currency: a.currency ?? null,
        timezone_name: a.timezone_name ?? null,
        account_status: a.account_status ?? null,
        business_id: a.business_id ?? null,
        business_name: a.business_name ?? null,
      }, { onConflict: 'org_id,meta_account_id' });
      totalRecords++;
      accountsCount++;
    }

    // If accounts_only, stop here (fast sync)
    if (accountsOnly) {
      await supabase.from('meta_sync_log').insert({
        org_id: orgId, sync_type: 'accounts', status: 'success',
        records_synced: totalRecords, duration_ms: Date.now() - startedAt, finished_at: new Date().toISOString(),
      });
      return new Response(JSON.stringify({
        success: true, accounts_count: accountsCount, records: totalRecords, warnings,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 3) Sync campaigns + insights for selected accounts (or all)
    const { data: dbAccounts } = await supabase
      .from('meta_ad_accounts')
      .select('id,meta_account_id')
      .eq('org_id', orgId);

    const accountsToSync = (dbAccounts || []).filter((acc: any) =>
      !filterAccountIds || filterAccountIds.includes(acc.meta_account_id) || filterAccountIds.includes(acc.id)
    );

    for (const acc of accountsToSync) {
      try {
        const campaigns = await fetchAll(
          `${GRAPH}/${acc.meta_account_id}/campaigns?fields=id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time&limit=200&access_token=${token}`
        );
        for (const c of campaigns) {
          await supabase.from('meta_campaigns').upsert({
            org_id: orgId,
            ad_account_id: acc.id,
            meta_campaign_id: c.id,
            name: c.name,
            objective: c.objective,
            status: c.status,
            effective_status: c.effective_status,
            daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
            lifetime_budget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
            start_time: c.start_time || null,
            stop_time: c.stop_time || null,
            created_time: c.created_time || null,
            updated_time: c.updated_time || null,
            raw: c,
            synced_at: new Date().toISOString(),
          }, { onConflict: 'org_id,meta_campaign_id' });
          totalRecords++;
          campaignsCount++;
        }

        const insights = await fetchAll(
          `${GRAPH}/${acc.meta_account_id}/insights?level=campaign&date_preset=last_30d&time_increment=1&fields=campaign_id,date_start,date_stop,spend,impressions,clicks,ctr,cpc,cpm,reach,actions&limit=500&access_token=${token}`
        );
        const { data: campRows } = await supabase
          .from('meta_campaigns')
          .select('id,meta_campaign_id')
          .eq('org_id', orgId);
        const campMap = new Map((campRows || []).map((r: any) => [r.meta_campaign_id, r.id]));

        for (const ins of insights) {
          const conv = (ins.actions || [])
            .filter((x: any) =>
              ['lead', 'purchase', 'complete_registration', 'onsite_conversion.lead_grouped'].includes(x.action_type)
            )
            .reduce((s: number, x: any) => s + Number(x.value || 0), 0);

          await supabase.from('meta_insights').upsert({
            org_id: orgId,
            level: 'campaign',
            entity_id: ins.campaign_id,
            campaign_id: campMap.get(ins.campaign_id) || null,
            date_start: ins.date_start,
            date_stop: ins.date_stop,
            spend: Number(ins.spend || 0),
            impressions: Number(ins.impressions || 0),
            clicks: Number(ins.clicks || 0),
            ctr: Number(ins.ctr || 0),
            cpc: Number(ins.cpc || 0),
            cpm: Number(ins.cpm || 0),
            reach: Number(ins.reach || 0),
            conversions: conv,
            raw: ins,
            synced_at: new Date().toISOString(),
          }, { onConflict: 'org_id,level,entity_id,date_start' });
          totalRecords++;
          insightsCount++;
        }
      } catch (e: any) {
        warnings.push(`account ${acc.meta_account_id}: ${e?.message || e}`);
      }
    }

    await supabase.from('meta_sync_log').insert({
      org_id: orgId,
      sync_type: 'full',
      status: warnings.length === 0 ? 'success' : 'partial',
      records_synced: totalRecords,
      error_message: warnings.length > 0 ? warnings.join(' | ').slice(0, 1000) : null,
      duration_ms: Date.now() - startedAt,
      finished_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({
      success: true,
      records: totalRecords,
      accounts_count: accountsCount,
      campaigns_count: campaignsCount,
      insights_count: insightsCount,
      warnings,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('meta-ads-sync error', err);
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
