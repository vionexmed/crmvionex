import { createContext, useContext } from "react";

/**
 * QUAL INTEGRAÇÃO ESTÁ COM A CONFIGURAÇÃO ABERTA.
 *
 * Os seis cartões abriam a configuração de jeitos diferentes: três num diálogo
 * controlado por `editProvider`, um num diálogo com estado próprio, um em DOIS
 * `<Dialog>` sem estado disparados por botões diferentes, e um sexto num
 * terceiro diálogo. Seis cartões, quatro comportamentos -- então aprender um não
 * ensinava nada sobre o próximo.
 *
 * Cada formulário continua morando no componente do próprio cartão, porque cada
 * um é de um tipo: o do WhatsApp escolhe entre dois provedores incompatíveis, o
 * do Instagram tem OAuth e webhook, e o do Google grava por edge function porque
 * a credencial não pode passar por `integration_configs`, que o navegador lê.
 * O que este contexto resolve é só QUEM está aberto -- o `Sheet` de cada painel
 * se encarrega de sair da grade sozinho.
 *
 * `aberto` é UMA string e não um booleano por cartão: é o que garante que abrir
 * o segundo fecha o primeiro. Com um booleano em cada um, dois painéis
 * apareceriam empilhados.
 */
export type ContextoPainel = {
  /** A chave do cartão cujo painel está aberto. */
  aberto: string | null;
  abrir: (chave: string) => void;
  fechar: () => void;
};

export const Contexto = createContext<ContextoPainel>({
  aberto: null,
  abrir: () => {},
  fechar: () => {},
});

export const useContextoDoPainel = () => useContext(Contexto);
