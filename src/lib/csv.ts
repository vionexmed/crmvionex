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
 * **O BOM não é detalhe.** Sem os três bytes `﻿` no começo, o Excel abre o
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
  // O `﻿` é o BOM. Sem ele o Excel assume Windows-1252 e todo acento vira
  // lixo. Três bytes que decidem se o arquivo serve ou não.
  const blob = new Blob(["﻿" + conteudo], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeDoArquivo.endsWith(".csv") ? nomeDoArquivo : `${nomeDoArquivo}.csv`;
  a.click();
  // Sem o revoke, o blob fica na memória até a aba fechar. Uma exportação de
  // 5000 contatos são alguns MB que não voltam.
  URL.revokeObjectURL(url);
}
