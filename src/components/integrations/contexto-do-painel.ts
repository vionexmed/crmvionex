import { createContext, useContext } from "react";

/**
 * QUEM ESTÁ ABERTO NA COLUNA DA DIREITA, e onde ela fica no DOM.
 *
 * Os seis cartões de integração abriam a configuração de jeitos diferentes:
 * três num diálogo controlado, dois num `<Dialog>` sem estado com
 * `DialogTrigger`, e um numa coluna. Seis cartões, quatro comportamentos --
 * então aprender um não ensinava nada sobre o próximo.
 *
 * O problema de unificar é que cada formulário mora no componente do próprio
 * cartão (o do WhatsApp escolhe entre dois provedores, o do Instagram tem OAuth
 * e webhook, o do Google grava por edge function), e o cartão é uma célula da
 * GRADE -- desenhar o painel a partir dali o colocaria dentro da célula, com a
 * largura de um cartão.
 *
 * Daí o portal: a aba publica um alvo na coluna da direita, e cada cartão
 * desenha o painel dele lá sem que o formulário saia de casa. Nenhum estado
 * precisou subir.
 *
 * `aberto` é UMA string e não um booleano por cartão: é o que garante que abrir
 * o segundo fecha o primeiro. Com um booleano em cada um, dois painéis
 * empilhariam na mesma coluna.
 */
export type ContextoPainel = {
  /** O nó onde os painéis se desenham. `null` antes do primeiro layout. */
  alvo: HTMLElement | null;
  /** A chave do cartão cujo painel está aberto. */
  aberto: string | null;
  abrir: (chave: string) => void;
  fechar: () => void;
};

export const Contexto = createContext<ContextoPainel>({
  alvo: null,
  aberto: null,
  abrir: () => {},
  fechar: () => {},
});

export const useContextoDoPainel = () => useContext(Contexto);
