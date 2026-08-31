import { CADASTRO_FIELDS } from "@/lib/contact-options";
import { chaveDeCabecalho } from "@/lib/csv";

/**
 * Para onde cada coluna da planilha vai.
 *
 * Vive aqui, e não dentro do modal, por um motivo concreto: dentro do `.tsx` não
 * dava para testar — importar o componente arrasta o cliente Supabase, que exige
 * variável de ambiente. E é justamente esta lógica que errou três vezes seguidas
 * com arquivos reais.
 */

/** As perguntas do cadastro viram destinos com este prefixo; elas vão para `metadata`. */
export const PREFIXO_META = "meta:";
/** A coluna vira uma atividade do tipo `note` na ficha. */
export const NOTA = "__nota";
/** A coluna é o NOME de uma empresa: procura, e cria se não existir. */
export const EMPRESA = "__empresa";
export const IGNORAR = "__skip";

export type CampoDestino = { key: string; label: string };

export const CAMPOS_DE_CONTATO: CampoDestino[] = [
  { key: "first_name", label: "Nome" },
  { key: "last_name", label: "Sobrenome" },
  { key: "email", label: "Email" },
  { key: "phone", label: "WhatsApp / Telefone" },
  { key: "title", label: "Especialidade / Cargo" },
  { key: "lifecycle_stage", label: "Ciclo de vida" },
  { key: "linkedin_url", label: "LinkedIn" },
  ...CADASTRO_FIELDS.map((f) => ({ key: `${PREFIXO_META}${f.key}`, label: f.label })),
  { key: EMPRESA, label: "Empresa (vincula ou cria)" },
  { key: NOTA, label: "Observação (vira nota na ficha)" },
  { key: IGNORAR, label: "— Ignorar —" },
];

export const CAMPOS_DE_EMPRESA: CampoDestino[] = [
  { key: "name", label: "Nome" },
  { key: "domain", label: "Domínio" },
  { key: "industry", label: "Indústria" },
  { key: "size", label: "Tamanho" },
  { key: "revenue", label: "Receita" },
  { key: "website", label: "Website" },
  { key: "linkedin_url", label: "LinkedIn" },
  { key: IGNORAR, label: "— Ignorar —" },
];

/**
 * Cabeçalho de planilha → campo do CRM.
 *
 * LISTA EXPLÍCITA e não heurística. A versão anterior usava
 * `lower.includes("email")` e falhava em "E-mail" — o hífen. Falhava também em
 * "WhatsApp" para telefone e em "Especialidade" para cargo: de sete colunas de um
 * arquivo real, CINCO ficaram em "Ignorar".
 *
 * As chaves chegam sem acento e sem pontuação (`chaveDeCabecalho`), então
 * "E-mail", "e mail" e "EMAIL" são todos "email".
 *
 * Ordem importa: a primeira que casa vence. `first_name` vem DEPOIS de
 * `last_name` porque "Sobrenome" contém "nome" — invertido, toda coluna de
 * sobrenome cairia em nome.
 */
export const SINONIMOS: [string, string[]][] = [
  ["email", ["email", "emails", "correioeletronico", "correio"]],
  // WhatsApp é a coluna mais comum em lista brasileira, e é telefone.
  ["phone", ["whatsapp", "whats", "zap", "telefone", "celular", "fone", "tel", "phone", "mobile"]],
  ["title", ["especialidade", "especialidades", "cargo", "funcao", "profissao", "titulo", "role"]],
  ["last_name", ["sobrenome", "ultimonome", "lastname", "surname"]],
  ["first_name", ["nomecompleto", "nome", "primeironome", "firstname", "name", "contato", "medico", "lead"]],
  ["linkedin_url", ["linkedin", "linkedinurl", "perfillinkedin"]],
  ["lifecycle_stage", ["ciclodevida", "estagio", "etapa", "situacao", "lifecycle"]],
  [EMPRESA, ["empresa", "clinica", "hospital", "instituicao", "consultorio", "company"]],
  // "Atendimento" numa lista de congresso é QUEM atendeu — o vendedor no
  // estande. Casa aqui e não em `title`, que é a especialidade do médico.
  [`${PREFIXO_META}atendido_por`, ["atendimento", "atendidopor", "atendente", "quematendeu", "vendedor", "consultor"]],
  [NOTA, ["observacao", "observacoes", "obs", "anotacao", "anotacoes", "comentario", "comentarios", "nota", "notas"]],
];

/**
 * Resolve o mapeamento de TODAS as colunas de uma vez.
 *
 * De uma vez, e não coluna a coluna, porque um destino só pode receber UMA
 * coluna: duas mapeadas para "Nome" fariam a segunda sobrescrever a primeira em
 * silêncio. Quem chega primeiro fica.
 */
export function mapearColunas(
  cabecalho: string[],
  campos: CampoDestino[],
): Record<number, string> {
  const mapa: Record<number, string> = {};
  const usados = new Set<string>();
  const existe = (k: string) => campos.some((f) => f.key === k) && !usados.has(k);

  cabecalho.forEach((header, i) => {
    const chave = chaveDeCabecalho(header);
    let alvo: string | undefined;

    // 1. Rótulo idêntico ao do campo — quem exportou do CRM e reimporta.
    alvo = campos.find(
      (f) => f.key !== IGNORAR && chaveDeCabecalho(f.label) === chave && !usados.has(f.key),
    )?.key;

    // 2. Pergunta do cadastro, pela chave dela ("cidade", "interesse"…).
    if (!alvo) {
      const meta = CADASTRO_FIELDS.find((f) => chaveDeCabecalho(f.key) === chave);
      if (meta && existe(`${PREFIXO_META}${meta.key}`)) alvo = `${PREFIXO_META}${meta.key}`;
    }

    // 3. Sinônimo. IGUALDADE primeiro, e só depois "contém" — senão uma coluna
    //    "Cidade" casaria com qualquer sinônimo curto contido nela.
    if (!alvo) {
      alvo = SINONIMOS.find(([k, syn]) => syn.includes(chave) && existe(k))?.[0]
        ?? SINONIMOS.find(([k, syn]) => syn.some((x) => chave.includes(x)) && existe(k))?.[0];
    }

    mapa[i] = alvo ?? IGNORAR;
    if (alvo) usados.add(alvo);
  });

  return mapa;
}
