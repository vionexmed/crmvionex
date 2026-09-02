/** Nomes de tabelas do banco — evita typos e centraliza renomeações. */
export const TABLES = {
  CONTACTS: "contacts",
  COMPANIES: "companies",
  DEALS: "deals",
  ACTIVITIES: "activities",
  PROFILES: "profiles",
  ORGANIZATIONS: "organizations",
  PIPELINES: "pipelines",
  PIPELINE_STAGES: "pipeline_stages",
  TAGS: "tags",
  CONTACT_TAGS: "contact_tags",
  DEAL_TAGS: "deal_tags",
  API_KEYS: "api_keys",
  WEBHOOKS: "webhooks",
  AUTOMATIONS: "automations",
  AUTOMATION_RUNS: "automation_runs",
  EMAIL_CONNECTIONS: "email_connections",
  EMAILS: "emails",
  EMAIL_TEMPLATES: "email_templates",
  AUDIT_LOGS: "audit_logs",
  SALES_GOALS: "sales_goals",
  LEAD_SCORES: "lead_scores",
  WHATSAPP_BUSINESS_ACCOUNTS: "whatsapp_business_accounts",
  WHATSAPP_CONNECTIONS: "whatsapp_connections",
  WHATSAPP_MESSAGES: "whatsapp_messages",
  PRODUTOS: "produtos",
  ORCAMENTOS: "orcamentos",
  ORCAMENTO_ITENS: "orcamento_itens",
} as const;

export type TableName = (typeof TABLES)[keyof typeof TABLES];

/** Campos comuns presentes em quase todas as tabelas. */
export const FIELDS = {
  ID: "id",
  ORG_ID: "org_id",
  OWNER_ID: "owner_id",
  USER_ID: "user_id",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
  IS_ACTIVE: "is_active",
} as const;

/** Moedas suportadas na criação de deals. */
export const CURRENCIES = ["BRL", "USD", "EUR", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Página padrão para listagens paginadas. */
export const DEFAULT_PAGE_SIZE = 50;
