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
    <div className="border-b border-border pb-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {rotulo && (
            <p className="text-label font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {rotulo}
            </p>
          )}
          {/* A classe, não as utilidades soltas: assim o nível existe em UM
              lugar, e as telas sem casca (entrada, wizard, erro) usam o mesmo. */}
          <h1 className="vx-titulo-tela truncate">{title}</h1>
          {description && <p className="vx-subtitulo-tela">{description}</p>}
          {meta && <div className="mt-2">{meta}</div>}
        </div>

        <div className="flex items-end gap-3 shrink-0">
          {contagem && (
            // `tabular-nums` porque o número muda sob os olhos — sem largura fixa
            // de dígito, o total "pula" de lugar a cada filtro aplicado.
            <div className="border-r border-border pr-3 text-right leading-none">
              <p className="font-heading text-2xl font-bold tabular-nums tracking-tight text-primary">
                {formatarNumero(contagem.valor)}
              </p>
              <p className="mt-1 text-label uppercase tracking-[0.09em] text-muted-foreground">
                {unidade}
              </p>
            </div>
          )}
          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
      </div>
    </div>
  );
}
