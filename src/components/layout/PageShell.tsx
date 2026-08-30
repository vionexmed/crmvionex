import { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
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
 */
export function PageShell({
  icon,
  kicker,
  title,
  description,
  actions,
  meta,
  /** Busca, filtros e seleção em lote. Fica entre o cabeçalho e o conteúdo. */
  toolbar,
  children,
  className,
}: {
  icon: LucideIcon;
  kicker?: string;
  title: string;
  description?: string;
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
        icon={icon}
        kicker={kicker}
        title={title}
        description={description}
        actions={actions}
        meta={meta}
      />
      {toolbar}
      {children}
    </div>
  );
}
