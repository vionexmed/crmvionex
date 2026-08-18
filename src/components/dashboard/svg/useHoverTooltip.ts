import { useCallback, useState } from "react";

/**
 * Rastreia qual índice de uma série está sob o cursor.
 *
 * Um hook só para os três gráficos do painel. Calcula a faixa pela largura do
 * container em vez de por elemento, então funciona com qualquer quantidade de
 * pontos sem criar um listener por ponto.
 */
export type Hover = { indice: number; x: number; y: number } | null;

export function useHoverTooltip(total: number) {
  const [hover, setHover] = useState<Hover>(null);

  const aoMover = useCallback(
    (e: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) => {
      if (total <= 0) return;
      const box = e.currentTarget.getBoundingClientRect();
      const cliente = "touches" in e ? e.touches[0] : e;
      if (!cliente) return;

      const rel = (cliente.clientX - box.left) / box.width;
      const indice = Math.min(total - 1, Math.max(0, Math.round(rel * (total - 1))));

      setHover({ indice, x: cliente.clientX - box.left, y: cliente.clientY - box.top });
    },
    [total],
  );

  const aoSair = useCallback(() => setHover(null), []);

  return { hover, aoMover, aoSair };
}

/** Índice apontado diretamente, para peças com alvo próprio (fatia, barra). */
export function useHoverIndex() {
  const [indice, setIndice] = useState<number | null>(null);
  return { indice, apontar: setIndice, limpar: () => setIndice(null) };
}
