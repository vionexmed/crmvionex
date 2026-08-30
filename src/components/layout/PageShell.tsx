import { Contagem, PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";

/**
 * A casca comum de uma página.
 *
 * Não existia, e o efeito era medível: `PageHeader` em **9 de 21** telas
 * internas, 12 com `<h1>` improvisado em **quatro tamanhos diferentes**
 * (`text-2xl`, `text-xl sm:text-2xl`, `text-lg sm:text-xl`, `text-[20px]`), e o
 * espaçamento raiz variando entre `space-y-2` e `space-y-6` sem hierarquia.
 *
 * O nome da página chegava a mudar de FONTE conforme a tela: `PageHeader` usa
 * Poppins, os `<h1>` soltos herdavam Nunito.
 *
 * Cinco páginas reescreviam à mão exatamente o contrato do `PageHeader`
 * (título + contagem + botão de ação). Este componente fecha isso e ainda dá
 * lugar fixo para a barra de ferramentas, que hoje cada tela posiciona sozinha.
 *
 * O `icon` saiu: o cabeçalho não desenha mais ladrilho de ícone, e a lateral já
 * mostra o ícone da tela atual aceso. Mantê-lo como prop deixaria 19 telas
 * passando um valor que ninguém lê.
 */
export function PageShell({
  kicker,
  title,
  description,
  contagem,
  actions,
  meta,
  /** Busca, filtros e seleção em lote. Fica entre o cabeçalho e o conteúdo. */
  toolbar,
  children,
  className,
}: {
  kicker?: string;
  title: string;
  description?: string;
  contagem?: Contagem;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // `space-y-4` é o valor mais praticado no projeto (9 páginas). Ter UM valor
    // importa mais do que qual valor: o ritmo vertical só é perceptível quando
    // se repete.
    <div className={cn("space-y-4", className)}>
      <PageHeader
        kicker={kicker}
        title={title}
        description={description}
        contagem={contagem}
        actions={actions}
        meta={meta}
      />
      {toolbar}
      {children}
    </div>
  );
}
