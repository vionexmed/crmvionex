import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatarNumero, pluralizar } from "@/lib/formato";

/**
 * Navegação entre páginas de uma lista.
 *
 * AS SETAS FICAM AO LADO DOS NÚMEROS, e não no canto.
 *
 * Antes era `justify-between`: o texto à esquerda, as setas colodas na borda
 * direita. E o canto inferior direito NÃO É LIVRE -- o botão flutuante do
 * copiloto de IA mora lá (`fixed bottom-5 right-5 z-50`, 48px). Ele cobria a
 * seta de avançar, e a página simplesmente não passava: o clique ia para o
 * copiloto.
 *
 * Levar as setas para junto do rótulo resolve a colisão pela raiz, em vez de
 * disputar espaço com um elemento fixo por margem ou z-index -- disputa que
 * volta a cada tela nova que ponha algo naquele canto.
 *
 * Estava duplicado em Contatos e Empresas, com o mesmo defeito nos dois.
 */
export function Paginacao({
  pagina,
  totalPaginas,
  total,
  unidade,
  plural,
  onMudar,
}: {
  /** Base ZERO, como o estado das telas. O rótulo soma 1. */
  pagina: number;
  totalPaginas: number;
  /** Total de registros, para dizer o tamanho da lista. */
  total?: number;
  /** No singular: "contato", "empresa". */
  unidade?: string;
  plural?: string;
  onMudar: (pagina: number) => void;
}) {
  // Uma página só não é navegação -- é ruído com dois botões desabilitados.
  if (totalPaginas <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pagina === 0}
        onClick={() => onMudar(pagina - 1)}
        aria-label="Página anterior"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      {/* `tabular-nums` porque o número muda sob os olhos: sem largura fixa de
          dígito, o rótulo se alarga ao passar de 9 para 10 e as setas pulam de
          lugar no meio do clique. */}
      <span className="text-sm tabular-nums text-muted-foreground">
        Página {pagina + 1} de {totalPaginas}
        {total !== undefined && unidade && (
          <> · {formatarNumero(total)} {pluralizar(total, unidade, plural)}</>
        )}
      </span>

      <Button
        variant="outline"
        size="sm"
        disabled={pagina >= totalPaginas - 1}
        onClick={() => onMudar(pagina + 1)}
        aria-label="Próxima página"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
