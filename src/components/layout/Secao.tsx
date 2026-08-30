import { cn } from "@/lib/utils";

/**
 * Um bloco de conteúdo dentro de uma página.
 *
 * Era o que faltava. Hoje "seção" é montada de duas formas: `<Card>` do shadcn
 * (90 ocorrências) ou um `<div>` com borda escrito à mão (40). E o
 * `SectionLabel`, construído para exatamente isto, tinha **zero usos**.
 *
 * A diferença não é só de repetição. `<Card>` como seção significa que TODO
 * bloco vira uma caixa com moldura, e uma página com cinco blocos vira cinco
 * caixas dentro de uma caixa. A separação passa a vir do desenho em vez de vir
 * da leitura.
 *
 * Aqui a separação é o rótulo e o respiro. A moldura é opcional e existe para
 * o caso em que o bloco de fato precisa se destacar do que está em volta --
 * um alerta, um painel lado a lado.
 */
export function Secao({
  titulo,
  descricao,
  acoes,
  /**
   * Desenha moldura em volta. Use quando o bloco compete por atenção com um
   * vizinho; para conteúdo em sequência vertical, o respiro basta.
   */
  contornada = false,
  className,
  children,
}: {
  titulo?: string;
  descricao?: string;
  acoes?: React.ReactNode;
  contornada?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "space-y-3",
        contornada && "rounded-lg border border-border p-4",
        className,
      )}
    >
      {(titulo || acoes) && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/* `vx-titulo-secao` é o mesmo nível do CardTitle -- o bloco muda de
                embalagem, não de hierarquia. */}
            {titulo && <h2 className="vx-titulo-secao">{titulo}</h2>}
            {descricao && <p className="vx-subtitulo mt-0.5">{descricao}</p>}
          </div>
          {acoes && <div className="flex shrink-0 items-center gap-2">{acoes}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Duas ou mais seções lado a lado, com divisória entre elas.
 *
 * Sem moldura em cada uma: a linha vertical separa, e o respiro faz o resto.
 * É a alternativa a colocar dois `<Card>` num grid, que desenha quatro bordas
 * onde uma linha resolve.
 */
export function SecoesLadoALado({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-6 lg:grid-cols-2",
        // A divisória só existe quando há duas colunas de verdade. No celular
        // as seções empilham, e uma linha vertical entre blocos empilhados
        // apontaria para o nada.
        "lg:divide-x lg:divide-border [&>*:not(:first-child)]:lg:pl-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
