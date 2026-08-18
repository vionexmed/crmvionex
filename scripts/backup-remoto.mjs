#!/usr/bin/env node
/**
 * Backup dos dados para um bucket privado do próprio Supabase.
 *
 * Nenhum arquivo é gravado nesta máquina: cada tabela é lida da API e enviada
 * direto para o Storage, em memória.
 *
 * LIMITE IMPORTANTE: isto protege contra ERRO — apagar contato sem querer,
 * transferência de carteira errada, migração mal aplicada. NÃO protege contra
 * perder o projeto, porque o backup mora no mesmo lugar que o banco. Para isso
 * é preciso levar o arquivo para fora (ver o final da saída).
 *
 * O ESQUEMA não vai aqui — está versionado em supabase/migrations/.
 *
 * Uso:
 *   SERVICE_KEY="cole-a-chave" node scripts/backup-remoto.mjs
 */
const URL = "https://kschuwekbrrwmhzinsrv.supabase.co";
const KEY = process.env.SERVICE_KEY;
const BUCKET = "backups";

if (!KEY) {
  console.error("\nFalta a chave. Rode assim:\n");
  console.error('  SERVICE_KEY="a-chave-service-role" node scripts/backup-remoto.mjs\n');
  console.error("No painel: Settings -> API Keys -> service_role -> Reveal\n");
  process.exit(1);
}

const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// 1. Bucket privado. `public: false` importa: um bucket público seria leitura
//    aberta na internet, que é exatamente o furo que fechamos na mídia do
//    WhatsApp. Um backup público seria muito pior.
const cria = await fetch(`${URL}/storage/v1/bucket`, {
  method: "POST",
  headers: { ...h, "Content-Type": "application/json" },
  body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
});
if (!cria.ok) {
  const t = await cria.text();
  if (!t.includes("already exists") && !t.includes("Duplicate")) {
    console.error(`Não foi possível criar o bucket: HTTP ${cria.status} ${t.slice(0, 120)}`);
    process.exit(1);
  }
  console.log(`Bucket "${BUCKET}" já existia.`);
} else {
  console.log(`Bucket "${BUCKET}" criado (privado).`);
}

const TABELAS = [
  "activities",
  "api_keys",
  "audit_logs",
  "automation_logs",
  "automations",
  "companies",
  "contact_tags",
  "contacts",
  "custom_field_definitions",
  "deal_tags",
  "deals",
  "email_connections",
  "email_sequence_enrollments",
  "email_sequence_steps",
  "email_sequences",
  "email_signatures",
  "email_templates",
  "emails",
  "gmail_oauth_tokens",
  "integration_configs",
  "invitations",
  "lead_score_history",
  "lead_scoring_rules",
  "loss_reasons",
  "meta_ad_accounts",
  "meta_ads",
  "meta_adsets",
  "meta_campaigns",
  "meta_insights",
  "meta_sync_log",
  "notification_preferences",
  "onboarding_progress",
  "org_secrets",
  "organizations",
  "pipeline_stages",
  "pipelines",
  "profiles",
  "risk_rules",
  "role_permissions",
  "sales_goals",
  "segments",
  "tags",
  "team_members",
  "teams",
  "tracking_events",
  "user_roles",
  "webhooks",
  "whatsapp_config",
  "whatsapp_messages",
  "whatsapp_templates"
];
const data = new Date().toISOString().slice(0, 10);
const dump = {};
let total = 0;
const erros = [];

for (const tabela of TABELAS) {
  const linhas = [];
  let inicio = 0;
  const passo = 1000;

  // Paginado: o PostgREST corta a resposta sem avisar, e um backup cortado em
  // silêncio é pior que nenhum backup.
  for (;;) {
    const r = await fetch(`${URL}/rest/v1/${tabela}?select=*`, {
      headers: { ...h, Range: `${inicio}-${inicio + passo - 1}` },
    });
    if (!r.ok) {
      erros.push(`${tabela}: HTTP ${r.status} ${(await r.text()).slice(0, 70)}`);
      break;
    }
    const lote = await r.json();
    linhas.push(...lote);
    if (lote.length < passo) break;
    inicio += passo;
  }

  if (erros.some((e) => e.startsWith(tabela + ":"))) continue;
  dump[tabela] = linhas;
  total += linhas.length;
  if (linhas.length) console.log(`  ${String(linhas.length).padStart(6)} linhas  ${tabela}`);
}

// 2. Um arquivo só, enviado direto da memória.
const nome = `backup-${data}.json`;
const corpo = JSON.stringify({ gerado_em: new Date().toISOString(), projeto: "kschuwekbrrwmhzinsrv", tabelas: dump }, null, 2);

const env = await fetch(`${URL}/storage/v1/object/${BUCKET}/${nome}`, {
  method: "POST",
  headers: { ...h, "Content-Type": "application/json", "x-upsert": "true" },
  body: corpo,
});

if (!env.ok) {
  console.error(`\nFalha no envio: HTTP ${env.status} ${(await env.text()).slice(0, 150)}`);
  process.exit(1);
}

const mb = (Buffer.byteLength(corpo) / 1024 / 1024).toFixed(2);
console.log(`\n${total} linhas enviadas — ${BUCKET}/${nome} (${mb} MB)`);
console.log("Nada foi gravado nesta máquina.");

if (erros.length) {
  console.log(`\nFALHARAM (${erros.length}) — o backup NÃO está completo:`);
  for (const e of erros) console.log(`  ${e}`);
  process.exitCode = 1;
}

console.log("\nPara ver ou baixar: painel do Supabase -> Storage -> backups");
console.log("LEMBRE: isto protege contra erro, não contra perder o projeto.");
console.log("Para proteção real, baixe esse arquivo de vez em quando e guarde");
console.log("no Google Drive da vionex.med.br.");
