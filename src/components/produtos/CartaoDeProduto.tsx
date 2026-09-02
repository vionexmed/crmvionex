import { ImageOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatarMoeda } from "@/lib/formato";
import type { Produto } from "@/lib/api/produtos";

/**
 * Um produto do catálogo.
 *
 * A FOTO É O CARTÃO, e é o que separa este do cartão de integração. Lá o
 * ladrilho de 40px identifica a marca ao lado do nome; aqui a foto ocupa o topo
 * inteiro, porque num catálogo é ela que se reconhece antes de ler.
 *
 * SEM BOTÃO no corpo, como pedido. O cartão inteiro é o alvo: um botão
 * "Editar" ao lado de um cartão que também abre a edição daria dois caminhos
 * para a mesma coisa -- foi o motivo de o olho sair do card do kanban.
 *
 * O PREÇO fica sobre a foto e não embaixo do nome. Embaixo ele disputava a
 * linha com a descrição e, numa grade, os preços apareciam em alturas
 * diferentes conforme o nome quebrasse em uma ou duas linhas. No canto da foto
 * eles formam uma coluna que se compara de cima a baixo.
 */
export function CartaoDeProduto({
  produto,
  aoClicar,
  className,
}: {
  produto: Produto;
  aoClicar?: (p: Produto) => void;
  className?: string;
}) {
  const inativo = !produto.ativo;

  return (
    <Card
      onClick={aoClicar ? () => aoClicar(produto) : undefined}
      className={cn(
        "flex flex-col overflow-hidden transition-colors",
        aoClicar && "cursor-pointer hover:border-primary/40",
        // Desativado continua visível — é o único jeito de reativar. Mas
        // dessaturado, para não competir com o que está à venda.
        inativo && "opacity-60 saturate-50",
        className,
      )}
    >
      {/* `aspect-[4/3]` e não altura fixa: a proporção mantém a grade regular
          qualquer que seja a largura da coluna, e é ela que faz as fotos
          alinharem entre si. */}
      <div className="relative aspect-[4/3] w-full shrink-0 bg-muted">
        {produto.foto_url ? (
          <img
            src={produto.foto_url}
            alt={produto.nome}
            loading="lazy"
            /* `object-cover` recorta em vez de distorcer. Foto de produto vem
               em proporção qualquer, e esticar deforma o que se está vendendo. */
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageOff className="h-6 w-6 text-muted-foreground/40" />
          </div>
        )}

        <span className="absolute bottom-2 right-2 rounded-md bg-background/90 px-2 py-1 text-xs font-semibold tabular-nums shadow-[var(--shadow-xs)]">
          {formatarMoeda(Number(produto.preco), produto.moeda)}
          <span className="ml-0.5 font-normal text-muted-foreground">/{produto.unidade}</span>
        </span>

        {inativo && (
          <span className="absolute left-2 top-2 rounded-full bg-warning/15 px-2 py-0.5 text-label font-semibold uppercase tracking-wide text-warning">
            Inativo
          </span>
        )}
      </div>

      {/* `line-clamp-2` na descrição, e `min-h` para segurar a altura: sem os
          dois, cartão de descrição curta fica mais baixo que o vizinho e a
          grade desalinha — o mesmo defeito que os gráficos do painel tinham. */}
      <CardContent className="flex flex-1 flex-col gap-1 p-3">
        <p className="vx-titulo-secao truncate">{produto.nome}</p>
        <p className="vx-subtitulo line-clamp-2 min-h-8 leading-relaxed">
          {produto.descricao || "Sem descrição"}
        </p>
        {produto.sku && (
          <p className="mt-auto pt-1 text-label tabular-nums text-muted-foreground/70">
            {produto.sku}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
