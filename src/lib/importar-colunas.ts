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

/**
 * A chave para reconhecer que duas grafias são a MESMA empresa.
 *
 * Minúscula, sem acento, com espaços internos colapsados. "Hospital  Santa
 * Casa", "HOSPITAL SANTA CASA" e "Hospital Santa Casa" viram a mesma chave.
 *
 * O que ela NÃO faz, de propósito: não remove pontuação. Fundir demais é pior
 * que fundir de menos — uma empresa duplicada é chateação visível e reversível;
 * um contato ligado à empresa ERRADA é dado falso que ninguém percebe. E remover
 * pontuação não resolveria o caso difícil ("Santa Casa" vs "Santa Casa de
 * Misericórdia"), que exige julgamento humano.
 */
export function chaveDeEmpresa(nome: string): string {
  return nome
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().replace(/\s+/g, " ")
    .toLowerCase();
}

export type PlanoDeEmpresas = {
  /** Nomes a criar, na grafia da PRIMEIRA aparição na planilha. */
  aCriar: string[];
  /** chave → id, para as que já existem no banco. */
  porChave: Map<string, string>;
};

/**
 * Decide quais empresas criar e quais reusar, ANTES de qualquer escrita.
 *
 * DEFEITO QUE ISTO CORRIGE: a versão anterior fazia `new Set` das grafias
 * EXATAS. "Hospital X" e "hospital x" eram entradas distintas, as duas caíam na
 * lista de criar, e o resultado era DUAS empresas para a mesma instituição — a
 * duplicata que o código dizia evitar.
 *
 * Função pura, e é o ponto: dentro do modal isso não dava para testar, e é
 * justamente a lógica onde o erro passa sem aparecer na tela.
 */
export function planejarEmpresas(
  nomesDaPlanilha: (string | null | undefined)[],
  existentes: { id: string; name: string | null }[],
): PlanoDeEmpresas {
  const porChave = new Map<string, string>();
  for (const e of existentes) {
    const nome = e.name?.trim();
    if (!nome) continue;
    const k = chaveDeEmpresa(nome);
    // A primeira vence: se o banco já tem duplicata, escolher sempre a mesma
    // evita que a importação alterne entre elas entre execuções.
    if (!porChave.has(k)) porChave.set(k, e.id);
  }

  const aCriar: string[] = [];
  const vistos = new Set<string>();
  for (const bruto of nomesDaPlanilha) {
    const nome = bruto?.trim();
    if (!nome) continue;
    const k = chaveDeEmpresa(nome);
    if (porChave.has(k) || vistos.has(k)) continue;
    vistos.add(k);
    // Grafia da primeira aparição: é a que a pessoa vai reconhecer na tela de
    // Empresas, e escolher a "melhor" seria inventar critério.
    aCriar.push(nome);
  }

  return { aCriar, porChave };
}

/**
 * O que fazer quando o contato JÁ EXISTE.
 *
 * Antes havia um comportamento só, silencioso: ignorar. E ele tem um custo que
 * só apareceu no uso real — importar uma lista com mapeamento errado, corrigir o
 * mapeamento e reimportar NÃO conserta ninguém. O aviso dizia "90 já estavam
 * cadastrados e foram ignorados", e os 90 continuavam sem telefone.
 */
export type QuandoExiste = "ignorar" | "completar" | "substituir";

export const OPCOES_QUANDO_EXISTE: { valor: QuandoExiste; rotulo: string; ajuda: string }[] = [
  {
    valor: "ignorar",
    rotulo: "Ignorar (não mexer)",
    ajuda: "O que já está no CRM fica intacto. Reimportar a mesma lista não muda nada.",
  },
  {
    valor: "completar",
    rotulo: "Completar o que está em branco",
    ajuda:
      "Preenche só os campos vazios no CRM. Nada que alguém já escreveu é sobrescrito — "
      + "é a opção para consertar um lote importado com colunas faltando.",
  },
  {
    valor: "substituir",
    rotulo: "Substituir pelo que vier na planilha",
    ajuda:
      "A planilha vence nos campos que ela traz. Célula VAZIA continua não apagando nada — "
      + "vazio quer dizer \u0022não informado\u0022, não \u0022apague\u0022.",
  },
];

/**
 * Os campos que uma atualização pode tocar, e o valor a gravar.
 *
 * A REGRA QUE NÃO NEGOCIA: célula vazia nunca apaga valor existente. Vazio numa
 * planilha quer dizer "não informado" -- interpretar como "apague" faria
 * reimportar uma lista sem e-mail limpar todos os e-mails da base, em silêncio.
 *
 * Devolve `null` quando não há nada a fazer, para o chamador poder pular o
 * UPDATE em vez de gastar uma escrita que não muda nada.
 */
export function camposParaAtualizar(
  novo: Record<string, unknown>,
  atual: Record<string, unknown>,
  modo: QuandoExiste,
): Record<string, unknown> | null {
  if (modo === "ignorar") return null;

  /** Colunas que a importação escreve. `metadata` é tratado à parte, por mesclagem. */
  const COLUNAS = ["first_name", "last_name", "email", "phone", "title", "linkedin_url", "company_id"];

  const mudancas: Record<string, unknown> = {};

  for (const col of COLUNAS) {
    const vindo = novo[col];
    // Vazio não participa. Nem como "completar", nem como "substituir".
    if (vindo === null || vindo === undefined || String(vindo).trim() === "") continue;

    const tem = atual[col];
    const estaVazio = tem === null || tem === undefined || String(tem).trim() === "";

    if (modo === "completar" && !estaVazio) continue;
    if (String(tem ?? "") === String(vindo)) continue;   // já igual, não gasta escrita

    mudancas[col] = vindo;
  }

  // `metadata` MESCLA, sempre -- nunca substitui o objeto.
  //
  // Substituir apagaria as respostas do formulário, a marca `importado_em` (que
  // o filtro "Importação" usa) e a origem de um lote anterior. Mesmo em
  // "substituir", o que não vem na planilha permanece.
  const metaNovo = (novo.metadata ?? {}) as Record<string, unknown>;
  const metaAtual = (atual.metadata ?? {}) as Record<string, unknown>;
  const metaFinal: Record<string, unknown> = { ...metaAtual };
  let mudouMeta = false;
  for (const [k, v] of Object.entries(metaNovo)) {
    if (v === null || v === undefined || String(v).trim() === "") continue;
    const tem = metaFinal[k];
    const estaVazio = tem === null || tem === undefined || String(tem).trim() === "";
    if (modo === "completar" && !estaVazio) continue;
    if (String(tem ?? "") === String(v)) continue;
    metaFinal[k] = v;
    mudouMeta = true;
  }
  if (mudouMeta) mudancas.metadata = metaFinal;

  return Object.keys(mudancas).length > 0 ? mudancas : null;
}
