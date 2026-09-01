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
  /**
   * A tela ocupa a altura da janela, e quem rola é o CONTEÚDO.
   *
   * Opcional, e é o ponto: só o kanban precisa disso hoje. Ligar para as 27
   * telas transformaria toda página comprida num contêiner de rolagem interno,
   * o que é pior -- lista longa quer rolar a página, não uma caixa dentro dela.
   *
   * Com ela, o último filho recebe `flex-1 min-h-0` e é ele que rola. `min-h-0`
   * não é decorativo: filho de flex nasce com `min-height: auto` e cresce com o
   * conteúdo em vez de encolher, e sem ele a altura fixa não produz rolagem
   * nenhuma.
   */
  preencherAltura = false,
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
  preencherAltura?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // `space-y-4` é o valor mais praticado no projeto (9 páginas). Ter UM valor
    // importa mais do que qual valor: o ritmo vertical só é perceptível quando
    // se repete.
    <div
      className={cn(
        "space-y-4",
        preencherAltura && "flex h-full min-h-0 flex-col space-y-0 gap-4",
        className,
      )}
    >
      <PageHeader
        kicker={kicker}
        title={title}
        description={description}
        contagem={contagem}
        actions={actions}
        meta={meta}
      />
      {toolbar}
      {preencherAltura ? (
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      ) : (
        children
      )}
    </div>
  );
}
