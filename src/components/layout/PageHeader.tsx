import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { grupoDaRota } from "@/components/layout/navegacao";
import { formatarNumero, pluralizar } from "@/lib/formato";

/**
 * A contagem viva da tela — o número, separado do texto que o explica.
 *
 * Existia porque `description` carregava DUAS informações incompatíveis: nove
 * telas montavam contagem por template string (`${n} contatos cadastrados`) e
 * seis escreviam texto fixo, lido uma vez na vida. Iam para o mesmo slot, com o
 * mesmo tamanho e a mesma cor apagada — ou seja, o número, que muda toda hora e
 * é o dado, estava formatado como ajuda.
 *
 * O plural sai de `unidade` com "s", que resolve contato/contatos,
 * empresa/empresas e sequência/sequências. `plural` existe para o que não segue
 * a regra — "negócio no funil" vira "negócios no funil", não "negócio no funils".
 */
export type Contagem = {
  valor: number;
  /** No singular. */
  unidade: string;
  /** Só quando o plural não é `unidade + "s"`. */
  plural?: string;
};

interface PageHeaderProps {
  /**
   * O rótulo acima do título. Omitir é o caminho normal: sai de `grupoDaRota`,
   * a mesma lista que desenha a barra lateral. Passar à mão só para tela que
   * não é destino de navegação.
   */
  kicker?: string;
  title: string;
  /** Texto fixo que explica a tela. Nunca contagem — para isso existe `contagem`. */
  description?: string;
  contagem?: Contagem;
  actions?: ReactNode;
  meta?: ReactNode;
}

export function PageHeader({
  kicker,
  title,
  description,
  contagem,
  actions,
  meta,
}: PageHeaderProps) {
  const { pathname } = useLocation();
  const rotulo = kicker ?? grupoDaRota(pathname);

  const unidade = contagem
    ? pluralizar(contagem.valor, contagem.unidade, contagem.plural)
    : null;

  return (
    // Sem cartão, sem gradiente, sem ladrilho de ícone: a separação do conteúdo
    // vem da régua abaixo. Eram 126px antes de qualquer conteúdo, em 19 telas.
    <div className="border-b border-border pb-4">
      {/*
        A LINHA DE AÇÃO ALINHA COM O TÍTULO, NÃO COM O FIM DA COLUNA.

        Era `sm:items-end`: os botões desciam até a base do bloco da esquerda --
        ou seja, abaixo da descrição e da linha de meta. No Painel isso deixava
        o seletor de período sozinho a 50px do título, alinhado com nada. O
        cabeçalho não estava composto, estava empilhado: dois blocos amarrados
        pelo ponto mais baixo de um deles.

        Com `items-start` mais um recuo do tamanho do olho-de-boi, a fileira de
        ações passa a dividir a MESMA faixa horizontal do título. O par
        título+ações lê como uma linha só; descrição e meta ficam embaixo, que é
        onde subordinado deve ficar.
      */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          {/* A `.vx-etiqueta` é a mesma do cabeçalho de coluna da tabela, do
              rótulo de grupo da lateral e da unidade da contagem: os quatro são
              o mesmo elemento em papéis diferentes, e cada um trazia o próprio
              tamanho, peso e tracking escritos à mão. */}
          {rotulo && <p className="vx-etiqueta mb-1 block">{rotulo}</p>}
          {/* A classe, não as utilidades soltas: assim o nível existe em UM
              lugar, e as telas sem casca (entrada, wizard, erro) usam o mesmo. */}
          <h1 className="vx-titulo-tela truncate">{title}</h1>
          {description && <p className="vx-subtitulo-tela max-w-[68ch]">{description}</p>}
          {meta && <div className="mt-2">{meta}</div>}
        </div>

        {/* `sm:pt-[18px]` desce a fileira pela altura do olho-de-boi (11px de
            linha + 4px de vão), de modo que o centro dos botões caia no centro
            do título. Sem isso eles nascem alinhados com o rótulo pequeno. */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 sm:justify-end sm:pt-[18px]">
          {contagem && (
            // `tabular-nums` porque o número muda sob os olhos — sem largura fixa
            // de dígito, o total "pula" de lugar a cada filtro aplicado.
            //
            // O NÚMERO DEIXOU DE SER COLORIDO, e continua não sendo: neste
            // sistema a cor é reservada para AÇÃO e para ESTADO. Um total é
            // dado, e se destaca por tamanho e peso.
            //
            // O QUE MUDOU É O ARRANJO. Ele era um bloco de duas linhas --
            // número em 24px, unidade embaixo -- separado das ações por uma
            // barra vertical de 24px. Três problemas de uma vez: 24px é
            // exatamente o tamanho do `<h1>`, então a contagem competia com o
            // nome da tela; empilhado em dois andares ele virava um segundo
            // título; e a barrinha era uma divisória avulsa, a única da tela,
            // desenhada porque os dois blocos não tinham relação nenhuma.
            //
            // Numa linha só, com a unidade em `.vx-etiqueta` sentada na mesma
            // base do número, vira uma anotação: menor que o título, do lado
            // das ações, sem precisar de divisória para existir.
            <p className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="font-heading text-[18px] font-semibold tabular-nums leading-none tracking-tight text-foreground">
                {formatarNumero(contagem.valor)}
              </span>
              <span className="vx-etiqueta">{unidade}</span>
            </p>
          )}
          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
      </div>
    </div>
  );
}
