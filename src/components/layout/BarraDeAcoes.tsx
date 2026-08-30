import { cn } from "@/lib/utils";

/**
 * As duas faixas que ficam entre o cabeçalho e a lista.
 *
 * Estavam escritas à mão em sete lugares, com medidas que já divergiam: o
 * painel de filtro usava `bg-muted/30` e a barra de seleção `bg-muted/50`, e as
 * duas cravavam `rounded-lg` em vez do raio do token — que agora é outro.
 *
 * Não são a mesma coisa e por isso são dois componentes: o filtro é um painel
 * que aparece por escolha e some, a seleção é um estado que interrompe a
 * leitura da lista. O que compartilham é a posição e a moldura.
 */

export function BarraDeFiltros({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/40 p-3",
        className,
      )}
      // O painel aparece e some com um botão. Sem `role`/`aria-label`, quem usa
      // leitor de tela ouve um punhado de campos sem saber que são filtros.
      role="group"
      aria-label="Filtros da lista"
    >
      {children}
    </div>
  );
}

export function BarraDeSelecao({
  quantidade,
  /** "contato" / "contatos" — o plural é decidido aqui, não em cada tela. */
  substantivo,
  substantivoPlural,
  onLimpar,
  children,
  className,
}: {
  quantidade: number;
  substantivo: string;
  substantivoPlural?: string;
  onLimpar?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  if (quantidade === 0) return null;
  const plural = substantivoPlural ?? `${substantivo}s`;

  return (
    <div
      className={cn(
        // Cor de destaque em vez de cinza: a seleção é um ESTADO, e a faixa
        // precisa dizer isso sem depender de o usuário lembrar que marcou algo.
        "flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span className="text-sm font-medium">
        {quantidade} {quantidade === 1 ? substantivo : plural}
      </span>
      {children}
      {onLimpar && (
        // Sair da seleção sem precisar desmarcar um por um. Faltava nas quatro
        // telas: com trinta linhas marcadas, a única saída era recarregar.
        <button
          type="button"
          onClick={onLimpar}
          className="ml-auto text-label text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
        >
          Limpar seleção
        </button>
      )}
    </div>
  );
}
