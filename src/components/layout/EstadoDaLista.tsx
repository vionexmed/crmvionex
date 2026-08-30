import { LucideIcon, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Carregando, vazio e falhou — os três estados que quase nenhuma tela distingue.
 *
 * O levantamento encontrou: 2 páginas com skeleton, 12 com spinner (em dois
 * formatos incompatíveis) e **12 sem indicador nenhum**. E 9 páginas **sem
 * tratamento de erro de leitura** — falha de consulta virava lista vazia,
 * indistinguível de "não há dados".
 *
 * A distinção importa porque as três pedem ações diferentes de quem vê: esperar,
 * cadastrar, ou tentar de novo. Uma lista vazia que na verdade falhou faz alguém
 * concluir que não tem cliente nenhum.
 *
 * O CSS já tinha `.vx-empty-state` e `.vx-shimmer` prontos e **nunca usados**,
 * enquanto 36 arquivos montavam estado vazio à mão em cinco formatos diferentes.
 */

export function LoadingState({
  /** Quantas linhas fantasma desenhar. Use o número típico da lista. */
  linhas = 5,
  className,
}: {
  linhas?: number;
  className?: string;
}) {
  return (
    // Skeleton em vez de spinner: preserva a forma da tela e não desloca o
    // conteúdo quando os dados chegam. Spinner centralizado faz a página pular.
    <div className={cn("space-y-2", className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      {Array.from({ length: linhas }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function ErrorState({
  titulo = "Não foi possível carregar",
  descricao = "A consulta ao banco falhou. Nenhum dado foi alterado.",
  onTentarNovamente,
  className,
}: {
  titulo?: string;
  descricao?: string;
  onTentarNovamente?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-destructive/40 px-6 py-12 text-center",
        className,
      )}
    >
      <TriangleAlert className="h-8 w-8 text-destructive" />
      <p className="mt-3 text-sm font-medium">{titulo}</p>
      {/* Dizer que nada foi alterado importa: sem isso, quem vê um erro depois
          de salvar não sabe se o dado foi ou não. */}
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{descricao}</p>
      {onTentarNovamente && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onTentarNovamente}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  icone: Icone,
  titulo,
  descricao,
  acao,
  className,
}: {
  icone: LucideIcon;
  titulo: string;
  descricao?: string;
  acao?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-16 text-center",
        className,
      )}
    >
      {/* O anel vem de .vx-empty-icon-ring, que existia no CSS e nunca foi
          usado — 64px com halo de 8px na cor de destaque. */}
      <div className="vx-empty-icon-ring">
        <Icone className="h-6 w-6 text-primary" />
      </div>
      <p className="text-sm font-medium">{titulo}</p>
      {descricao && (
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{descricao}</p>
      )}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}

/**
 * Decide qual dos três mostrar, ou libera o conteúdo.
 *
 * Existe para que a página não repita o encadeamento de ternários — e para que
 * ninguém "esqueça" o estado de erro, que é justamente o que acontecia em 9
 * páginas.
 */
export function EstadoDaLista({
  carregando,
  erro,
  vazio,
  linhasFantasma,
  onTentarNovamente,
  estadoVazio,
  children,
}: {
  carregando?: boolean;
  erro?: boolean;
  vazio?: boolean;
  linhasFantasma?: number;
  onTentarNovamente?: () => void;
  estadoVazio?: React.ReactNode;
  children: React.ReactNode;
}) {
  // Ordem obrigatória: erro ANTES de vazio. Uma consulta que falhou devolve
  // lista vazia, e mostrar "nenhum resultado" nesse caso é afirmar um fato que
  // a tela não conhece.
  if (carregando) return <LoadingState linhas={linhasFantasma} />;
  if (erro) return <ErrorState onTentarNovamente={onTentarNovamente} />;
  if (vazio) return <>{estadoVazio}</>;
  return <>{children}</>;
}
