/**
 * Exportação de CSV, em um lugar só.
 *
 * Havia CINCO implementações, e elas divergiam no que importa:
 *
 *   Relatórios         BOM ✓   escapa aspas ✓
 *   Contatos           BOM ✓   escapa aspas ✓
 *   Empresas           BOM ✗   escapa aspas ✗
 *   Lead Scoring       BOM ✗   escapa aspas ✗
 *   Importar/Exportar  BOM ✗   escapa aspas ✓
 *
 * **O BOM não é detalhe.** Sem os três bytes de marca de ordem no começo, o Excel abre o
 * arquivo em Windows-1252 e todo acento vira lixo: "João" vira "JoÃ£o",
 * "Negócios" vira "NegÃ³cios". Num CRM em português, isso torna metade das
 * exportações inutilizável — e a pessoa culpa o dado, não o arquivo.
 *
 * **Aspas não escapadas quebram a estrutura.** Uma empresa chamada
 * `Silva "Móveis" Ltda` fecha o campo no meio e desloca todas as colunas dali
 * para a direita, na linha inteira.
 */

/**
 * Um valor virando célula.
 *
 * Sempre entre aspas, sempre com as aspas internas duplicadas. Envolver tudo é
 * mais simples e mais seguro do que decidir caso a caso — e o custo é alguns
 * bytes que nenhum leitor de CSV reclama.
 */
function celula(valor: unknown): string {
  if (valor === null || valor === undefined) return '""';
  const texto = typeof valor === "object" ? JSON.stringify(valor) : String(valor);
  return `"${texto.replace(/"/g, '""')}"`;
}

/**
 * Monta e baixa o arquivo.
 *
 * As colunas saem das chaves da primeira linha, na ordem em que foram
 * escritas — é o que as cinco já faziam, e o que permite montar a linha como
 * um objeto legível no chamador.
 */
export function exportarCSV(
  linhas: Record<string, unknown>[],
  nomeDoArquivo: string,
  opcoes: { colunas?: string[] } = {},
): void {
  if (linhas.length === 0) return;

  const colunas = opcoes.colunas ?? Object.keys(linhas[0]);
  const conteudo = [
    colunas.map(celula).join(","),
    ...linhas.map((linha) => colunas.map((c) => celula(linha[c])).join(",")),
  ].join("\r\n");
  // CRLF, não LF: é o que a especificação do CSV pede, e o que o Excel no
  // Windows espera. Com LF puro, versões antigas juntam tudo numa linha só.

  baixar(conteudo, nomeDoArquivo);
}

/**
 * Para quem já tem o conteúdo montado — o exportador genérico de
 * Importar/Exportar, que serializa colunas desconhecidas.
 */
export function baixarCSV(conteudo: string, nomeDoArquivo: string): void {
  baixar(conteudo, nomeDoArquivo);
}

function baixar(conteudo: string, nomeDoArquivo: string): void {
  // `\uFEFF` é a marca de ordem de bytes (BOM). Sem ela o Excel assume
  // Windows-1252 e todo acento vira lixo -- três bytes que decidem se o arquivo
  // serve ou não.
  //
  // Escrita por ESCAPE, não literal: o caractere cru é invisível no editor, e
  // um caractere invisível que ninguém vê é um caractere que alguém apaga sem
  // querer. O lint pega, e é por isso que a regra existe.
  const blob = new Blob(["\uFEFF" + conteudo], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeDoArquivo.endsWith(".csv") ? nomeDoArquivo : `${nomeDoArquivo}.csv`;
  a.click();
  // Sem o revoke, o blob fica na memória até a aba fechar. Uma exportação de
  // 5000 contatos são alguns MB que não voltam.
  URL.revokeObjectURL(url);
}

// ═══════════════════════ LEITURA ═══════════════════════
//
// O outro lado do arquivo. Ficava dentro de `CSVImportModal.tsx`, e por isso não
// dava para testar: importar o componente arrasta o cliente Supabase, que exige
// variável de ambiente. Aqui são funções puras.

/**
 * Qual caractere separa as colunas.
 *
 * O EXCEL EM PORTUGUÊS EXPORTA COM PONTO E VÍRGULA, porque a vírgula é o
 * separador decimal — e "CSV" passa a significar outra coisa dependendo do
 * idioma de quem salvou. Um arquivo assim, lido com vírgula, produz UMA coluna
 * chamada "Nome;Especialidade;Cidade;..." e o mapeamento oferece um campo só.
 *
 * Aconteceu de verdade, com um arquivo de 835 leads.
 *
 * A contagem ignora o que está entre aspas: um nome como "Silva, João" não pode
 * fazer a vírgula ganhar num arquivo de ponto e vírgula.
 */
export function detectarSeparador(texto: string): string {
  const primeiraLinha = (() => {
    let dentro = false;
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (c === '"') dentro = !dentro;
      else if (!dentro && (c === "\n" || c === "\r")) return texto.slice(0, i);
    }
    return texto;
  })();

  const candidatos = [";", ",", "\t", "|"];
  let melhor = ",";
  let maior = 0;
  for (const sep of candidatos) {
    let n = 0;
    let dentro = false;
    for (const c of primeiraLinha) {
      if (c === '"') dentro = !dentro;
      else if (!dentro && c === sep) n++;
    }
    if (n > maior) { maior = n; melhor = sep; }
  }
  // Nenhum separador na primeira linha: arquivo de uma coluna. Vírgula é o
  // padrão e não muda nada nesse caso.
  return melhor;
}

/**
 * Parser CSV correto: respeita campos entre aspas (com separadores e quebras
 * de linha embutidos), aspas escapadas ("") e arquivos CRLF do Excel.
 * O split ingênuo por \n e , corrompia arquivos reais.
 *
 * O separador é DETECTADO, não assumido — ver `detectarSeparador`.
 */
export function parseCSV(text: string, separador = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === separador) {
      row.push(field); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim()));
}
