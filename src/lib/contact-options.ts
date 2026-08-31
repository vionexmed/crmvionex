/**
 * Opções compartilhadas dos formulários de contato.
 * Fonte única: antes o modal de criação e o drawer de edição tinham listas
 * DIFERENTES — editar um contato com especialidade ausente na lista do
 * drawer renderizava um Select vazio.
 */
export const AREAS_ATUACAO = [
  "Acupuntura", "Alergia e Imunologia", "Anestesiologia", "Angiologia",
  "Cardiologia", "Cirurgia Cardiovascular", "Cirurgia da Mão",
  "Cirurgia de Cabeça e Pescoço", "Cirurgia do Aparelho Digestivo",
  "Cirurgia Geral", "Cirurgia Oncológica", "Cirurgia Pediátrica",
  "Cirurgia Plástica", "Cirurgia Torácica", "Cirurgia Vascular",
  "Clínica Médica", "Coloproctologia", "Dermatologia",
  "Endocrinologia e Metabologia", "Endoscopia", "Fisiatra",
  "Fisioterapia", "Gastroenterologia", "Genética Médica",
  "Geriatria", "Ginecologia e Obstetrícia", "Hematologia e Hemoterapia",
  "Homeopatia", "Infectologia", "Mastologia",
  "Medicina de Emergência", "Medicina de Família e Comunidade",
  "Medicina do Esporte", "Medicina do Trabalho",
  "Medicina Intensiva", "Medicina Legal", "Medicina Nuclear",
  "Medicina Preventiva e Social", "Nefrologia", "Neurocirurgia",
  "Neurologia", "Nutrologia", "Nutrição",
  "Oftalmologia", "Oncologia Clínica", "Ortopedia e Traumatologia",
  "Otorrinolaringologia", "Patologia", "Pediatria",
  "Pneumologia", "Psiquiatria", "Psicologia",
  "Radiologia e Diagnóstico por Imagem", "Radioterapia", "Reumatologia",
  "Urologia", "Outro",
];

export const PAISES = [
  "Brasil", "Portugal", "Estados Unidos", "Argentina", "Colômbia",
  "México", "Chile", "Uruguai", "Paraguai", "Peru", "Outro",
];

/**
 * Estágio do CICLO DE VIDA do contato — a relação com a pessoa, que só avança.
 * Não confundir com o estágio do funil (deals.stage_id), que é o progresso de
 * UM negócio e pode voltar. Antes desta separação, contacts.status fazia os
 * dois papéis ao mesmo tempo, mais o roteamento entre as telas Leads e Contatos.
 *
 * Valores em inglês no banco (coerente com os outros enums); rótulos aqui.
 */
export type LifecycleStage =
  | "lead" | "contacted" | "qualified" | "opportunity" | "customer" | "disqualified";

export const LIFECYCLE_LABELS: Record<LifecycleStage, string> = {
  lead: "Novo lead",
  contacted: "Contatado",
  qualified: "Qualificado",
  opportunity: "Em negociação",
  customer: "Cliente",
  disqualified: "Descartado",
};

/** Cor da bolinha do selo de ciclo de vida, na ordem do avanço. */
export const LIFECYCLE_COLORS: Record<LifecycleStage, string> = {
  lead: "#64748B",
  contacted: "#2563EB",
  qualified: "#7C3AED",
  opportunity: "#D97706",
  customer: "#059669",
  disqualified: "#DC2626",
};

/** Estágios que a tela de Leads mostra — antes de o lead ser qualificado. */
export const LEAD_STAGES: LifecycleStage[] = ["lead", "contacted"];

/**
 * Origem do contato, derivada de metadata.source. Usada para diferenciar
 * visualmente (selo colorido) de onde cada contato veio, e para filtrar.
 */
export interface ContactOrigin {
  key: "cadastro_likawave" | "landing" | "import" | "manual" | "other";
  label: string;
  color: string; // hex — cor da bolinha do selo
}

export function getContactOrigin(metadata: Record<string, unknown> | null | undefined): ContactOrigin {
  const src = String((metadata as { source?: unknown } | null)?.source ?? "").toLowerCase();
  if (src === "cadastro_likawave") return { key: "cadastro_likawave", label: "Cadastro Likawave", color: "#7C3AED" };
  if (src === "csv_import" || src === "import" || src === "importacao") return { key: "import", label: "Importação", color: "#D97706" };
  if (/landing|site|form|web|utm|ads?$/.test(src)) return { key: "landing", label: "Landing Page", color: "#2563EB" };
  if (!src || src === "manual") return { key: "manual", label: "Manual", color: "#64748B" };
  return { key: "other", label: String((metadata as { source?: unknown }).source), color: "#0D9488" };
}

/** Opções do filtro de origem na página Contatos */
export const ORIGIN_OPTIONS: { value: string; label: string }[] = [
  { value: "cadastro_likawave", label: "Cadastro Likawave" },
  { value: "landing", label: "Landing Page" },
  { value: "manual", label: "Manual" },
  { value: "import", label: "Importação" },
];

/**
 * Campos extras vindos de formulários de captação (ex.: Google Forms Likawave),
 * guardados em contacts.metadata. Rótulos amigáveis para exibição na ficha do
 * lead e do contato. Só os que tiverem valor são mostrados — contatos sem esses
 * dados (ex.: landing page, cadastro manual) não exibem nada extra.
 */
export const CADASTRO_FIELDS: { key: string; label: string }[] = [
  { key: "cidade", label: "Cidade / Estado" },
  { key: "interesse", label: "Nível de interesse" },
  { key: "instagram", label: "Instagram profissional" },
  { key: "registro_profissional", label: "CRM / CREFITO" },
  { key: "local_atuacao", label: "Local de atuação" },
  { key: "usa_ondas_choque", label: "Já usa ondas de choque?" },
  { key: "equipamento_atual", label: "Equipamento atual" },
  { key: "tratamentos", label: "Tratamentos pretendidos" },
  { key: "pacientes_mes", label: "Pacientes/mês (indicação)" },
  { key: "agendamento_demo", label: "Agendamento de demonstração" },
  { key: "autorizacao", label: "Autorização de contato" },
  { key: "classificacao_lead", label: "Classificação (uso interno)" },
  { key: "responsavel_cadastro", label: "Responsável pelo cadastro" },
  /**
   * QUEM ATENDEU a pessoa, no dia do evento.
   *
   * Diferente de "Responsável pelo cadastro": aquele é quem digitou a ficha,
   * este é quem conversou com o médico no estande. Numa lista de congresso os
   * dois quase nunca são a mesma pessoa, e juntá-los perderia a informação que
   * permite voltar ao vendedor certo para pedir contexto.
   */
  { key: "atendido_por", label: "Atendido por" },
];
