import type { QueryClient } from "@tanstack/react-query";

/**
 * Marca os números do painel como velhos.
 *
 * DEFEITO QUE ISTO CORRIGE: importar 93 contatos não mudava nada no Painel de
 * SDR. A tela de Contatos invalidava só `["contacts", orgId]`, e as consultas do
 * painel vivem em chaves OUTRAS — `sdr-metrics`, `sdr-charts`,
 * `sdr-metric-leads`. Nenhuma era tocada, então o card "Leads recebidos"
 * continuava com o número de antes até alguém recarregar a página.
 *
 * O sintoma engana: parece que a importação não funcionou. E a pessoa reimporta,
 * o que produz duplicata ou "já estavam cadastrados" — dois caminhos ruins a
 * partir de um número desatualizado na tela.
 *
 * POR QUE UMA FUNÇÃO E NÃO UMA LINHA EM CADA LUGAR
 *
 * São três prefixos hoje e serão mais. Espalhar a lista pelos ~15 pontos de
 * mutação garante que o próximo prefixo seja esquecido em alguns deles — e o
 * esquecimento é invisível, porque nada quebra: só um número fica velho.
 *
 * TUDO o que o painel conta passa por contatos, negócios, atividades, e-mails ou
 * mensagens. Então qualquer mutação nessas cinco tabelas deve chamar isto.
 */
const PREFIXOS = ["sdr-metrics", "sdr-charts", "sdr-metric-leads"] as const;

export function invalidarPainel(qc: QueryClient, orgId: string | null | undefined) {
  if (!orgId) return;
  for (const prefixo of PREFIXOS) {
    // Prefixo e não chave exata: as consultas carregam período e perfil na
    // chave (`["sdr-metrics", orgId, "mes"]`), e invalidar por igualdade
    // deixaria de fora todo período que a pessoa não estava vendo -- ela
    // trocaria o filtro e veria o número velho de novo.
    qc.invalidateQueries({ queryKey: [prefixo, orgId] });
  }
}

/** Os prefixos, para o teste conferir que a lista não divergiu dos hooks. */
export const PREFIXOS_DO_PAINEL = PREFIXOS;
