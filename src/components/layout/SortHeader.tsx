import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Cabeçalho de coluna ordenável.
 *
 * Existiam três cópias — Contatos, Empresas e Negócios — declaradas DENTRO do
 * render do componente pai. Isso não é só duplicação: um componente definido no
 * corpo do render é um tipo NOVO a cada render, então o React desmonta e remonta
 * a subárvore inteira em vez de atualizá-la. Nestas três telas o cabeçalho da
 * tabela remontava a cada tecla digitada na busca.
 *
 * As três também mostravam `ArrowUpDown` fixo: não dava para saber por qual
 * coluna a tabela estava ordenada, nem em que sentido. E nenhuma anunciava a
 * ordenação para leitor de tela.
 */

export type SortDir = "asc" | "desc";

export function SortHeader<K extends string>({
  rotulo,
  campo,
  sortKey,
  sortDir,
  onToggle,
  className,
}: {
  rotulo: string;
  campo: K;
  sortKey: K;
  sortDir: SortDir;
  onToggle: (campo: K) => void;
  className?: string;
}) {
  const ativo = sortKey === campo;
  const Icone = ativo ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <button
      type="button"
      onClick={() => onToggle(campo)}
      // `aria-sort` pertence ao <th>, não ao botão; como as tabelas aqui usam
      // <th> sem controle próprio, o estado vai no rótulo acessível do botão --
      // que é o elemento com o qual se interage.
      aria-label={
        ativo
          ? `${rotulo}, ordenado ${sortDir === "asc" ? "crescente" : "decrescente"}. Inverter.`
          : `${rotulo}. Ordenar por esta coluna.`
      }
      className={cn(
        "flex items-center gap-1 transition-colors hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
        ativo && "text-foreground",
        className,
      )}
    >
      {rotulo}
      <Icone className={cn("h-3 w-3", ativo ? "text-primary" : "opacity-60")} />
    </button>
  );
}

/**
 * O par estado + alternador, idêntico nas três telas: clicar na coluna já
 * ordenada inverte o sentido; clicar em outra troca a coluna e começa
 * crescente.
 *
 * O `asc` ao trocar de coluna é o que as três já faziam. Mantido de propósito --
 * mudar para `desc` seria mais defensável em coluna de dinheiro, mas é mudança
 * de comportamento que ninguém pediu.
 */
export function useOrdenacao<K extends string>(campoInicial: K, dirInicial: SortDir = "desc") {
  const [sortKey, setSortKey] = useState<K>(campoInicial);
  const [sortDir, setSortDir] = useState<SortDir>(dirInicial);

  // `useCallback` porque `onToggle` desce como prop: sem ele, a identidade muda
  // a cada render e anula qualquer memoização de quem recebe.
  const toggleSort = useCallback((campo: K) => {
    setSortKey((atual) => {
      if (atual === campo) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return atual;
      }
      setSortDir("asc");
      return campo;
    });
  }, []);

  return { sortKey, sortDir, toggleSort, setSortKey, setSortDir };
}
