import { Children, isValidElement } from "react";
import { LucideIcon } from "lucide-react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * A barra de abas de uma página.
 *
 * Havia dez barras de abas no projeto e **seis tratamentos diferentes**: nua em
 * três telas (as abas ficavam espremidas à esquerda, pequenas), `w-full` em
 * duas, `flex-wrap` numa, `flex-wrap h-auto gap-1` noutra, e
 * `grid w-full grid-cols-N` só em Relatórios e Login.
 *
 * A largura cheia dividida em partes iguais é a que funciona: cada aba vira um
 * alvo grande, e a barra ancora o topo do conteúdo em vez de flutuar num canto.
 *
 * O número de colunas é CONTADO, não escrito. `grid-cols-5` escrito à mão vira
 * mentira no dia em que alguém acrescenta a sexta aba -- e o erro é de layout,
 * silencioso, não de tipo.
 */

export type AbaDePagina<T extends string> = {
  valor: T;
  rotulo: string;
  icone?: LucideIcon;
  /** Alinha o rótulo curto que aparece no celular, onde o longo não cabe. */
  rotuloCurto?: string;
};

/**
 * Até quatro abas cabem lado a lado no celular. Acima disso a barra quebra em
 * duas linhas em vez de espremer -- sete abas de 50px são sete alvos que
 * ninguém acerta com o polegar.
 */
const COLUNAS_CELULAR: Record<number, string> = {
  1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4",
  5: "grid-cols-3", 6: "grid-cols-3", 7: "grid-cols-4", 8: "grid-cols-4",
};

const COLUNAS: Record<number, string> = {
  1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4",
  5: "sm:grid-cols-5", 6: "sm:grid-cols-6", 7: "sm:grid-cols-7", 8: "sm:grid-cols-8",
};

export function PageTabs<T extends string>({
  abas,
  className,
}: {
  abas: AbaDePagina<T>[];
  className?: string;
}) {
  const n = abas.length;
  return (
    <TabsList
      className={cn(
        // `h-auto` porque com mais de quatro abas a grade tem duas linhas, e a
        // altura fixa de 40px do primitivo cortaria a segunda.
        "grid h-auto w-full gap-1 p-1",
        COLUNAS_CELULAR[n] ?? "grid-cols-4",
        COLUNAS[n] ?? "sm:grid-cols-4",
        className,
      )}
    >
      {abas.map(({ valor, rotulo, rotuloCurto, icone: Icone }) => (
        <TabsTrigger
          key={valor}
          value={valor}
          // `py-2` contra o `py-1.5` do primitivo: o alvo de toque sobe de 30
          // para 36px de altura, que é o mínimo praticável no celular.
          className="gap-1.5 px-2 py-2 text-xs data-[state=active]:font-semibold"
        >
          {Icone && <Icone className="h-3.5 w-3.5 shrink-0" />}
          {rotuloCurto ? (
            <>
              <span className="hidden truncate sm:inline">{rotulo}</span>
              <span className="truncate sm:hidden">{rotuloCurto}</span>
            </>
          ) : (
            <span className="truncate">{rotulo}</span>
          )}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

/** Quantas abas um `<TabsList>` recebeu — usado só pelos testes. */
export function contarAbas(children: React.ReactNode): number {
  return Children.toArray(children).filter(isValidElement).length;
}
