/**
 * Traduz erro do Supabase para uma frase que diz o que fazer.
 *
 * O `catch` padrão espalhado pelas telas é:
 *
 *     e instanceof Error ? e.message : String(e)
 *
 * e ele falha exatamente onde mais importa. `PostgrestError` é um objeto
 * simples, não uma instância de `Error`: o `instanceof` dá falso, cai no
 * `String(e)` e a tela mostra **"[object Object]"**. O usuário vê que algo deu
 * errado e nada sobre o quê -- e a informação existia, no campo `message`.
 *
 * Foi assim que "Erro ao excluir contatos / [object Object]" escondeu uma
 * violação de chave estrangeira perfeitamente diagnosticável.
 */

/** Formato do erro que o PostgREST devolve. */
type ErroPostgrest = {
  message?: string;
  details?: string | null;
  hint?: string | null;
  code?: string;
};

const ehObjeto = (e: unknown): e is ErroPostgrest =>
  typeof e === "object" && e !== null;

/**
 * Códigos que valem uma frase própria.
 *
 * A mensagem crua do Postgres nesses casos é verdadeira e inútil para quem usa
 * o CRM: `insert or update on table "deals" violates foreign key constraint`
 * não diz a ninguém o que fazer em seguida.
 */
const POR_CODIGO: Record<string, string> = {
  // Há registros apontando para o que se tentou excluir.
  "23503": "Há registros vinculados que impedem a exclusão.",
  // Valor duplicado num índice único.
  "23505": "Já existe um registro com esse valor.",
  "23502": "Um campo obrigatório ficou vazio.",
  // RLS recusou a operação.
  "42501": "Você não tem permissão para esta operação.",
  "PGRST116": "O registro não foi encontrado.",
  // Embed apontando para relação que o PostgREST não conhece. Costuma ser bug
  // de código, não do usuário -- ver src/test/api/embed-com-fk.test.ts.
  "PGRST200": "Consulta inválida: relação inexistente entre as tabelas.",
};

export function mensagemErro(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;

  if (ehObjeto(e)) {
    const { message, details, hint, code } = e;
    const traduzido = code ? POR_CODIGO[code] : undefined;

    // A tradução vem primeiro, o detalhe do banco depois: o primeiro diz o que
    // aconteceu, o segundo ajuda quem for investigar.
    const partes = [traduzido, message, details, hint].filter(
      (p): p is string => typeof p === "string" && p.trim().length > 0,
    );
    // Sem dedup, "23503" repetiria a explicação e a mensagem crua dizendo o
    // mesmo em dois idiomas.
    const unicas = [...new Set(partes)];
    if (unicas.length) return unicas.join(" · ");
  }

  if (typeof e === "string" && e.trim()) return e;

  // Último recurso, e explícito: melhor "erro desconhecido" do que
  // "[object Object]", que parece defeito de tela e não de operação.
  return "Erro desconhecido";
}

/** O erro é "existem registros vinculados"? */
export function ehViolacaoDeVinculo(e: unknown): boolean {
  return ehObjeto(e) && e.code === "23503";
}
