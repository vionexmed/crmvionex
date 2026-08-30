import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Grupo de pílulas para alternar visão.
 *
 * Existiam quatro cópias deste bloco — Contatos, Empresas, Negócios e Atividades
 * — e elas já haviam divergido: `rounded-lg`/`rounded-md` contra
 * `rounded-md`/`rounded`, `px-2 sm:px-3 py-1.5` contra `px-2 py-1` contra
 * `px-3 py-1.5`. A de Atividades ainda perdeu o `aria-label` e o rótulo.
 *
 * Nenhuma anunciava seleção para leitor de tela: quatro controles de escolha e
 * zero `aria-pressed`.
 */

export type OpcaoSegmento<T extends string> = {
  valor: T;
  rotulo: string;
  icone?: LucideIcon;
};

export function SegmentedControl<T extends string>({
  opcoes,
  valor,
  onChange,
  /** Nome do grupo, para leitor de tela. Ex.: "Visualização". */
  rotuloGrupo,
  /** Esconde o texto no celular, mantendo só o ícone. */
  compactoNoCelular = true,
  className,
}: {
  opcoes: OpcaoSegmento<T>[];
  valor: T;
  onChange: (v: T) => void;
  rotuloGrupo: string;
  compactoNoCelular?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={rotuloGrupo}
      className={cn(
        "flex shrink-0 rounded-lg border border-border bg-muted/50 p-0.5",
        className,
      )}
    >
      {opcoes.map(({ valor: v, rotulo, icone: Icone }) => {
        const ativo = v === valor;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            // `aria-pressed` é o que faz um botão de alternância ser anunciado
            // como selecionado. Nenhuma das quatro cópias tinha.
            aria-pressed={ativo}
            aria-label={`${rotuloGrupo} ${rotulo}`}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors sm:px-3",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              ativo
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icone && <Icone className="h-3.5 w-3.5 shrink-0" />}
            <span className={compactoNoCelular ? "hidden sm:inline" : undefined}>
              {rotulo}
            </span>
          </button>
        );
      })}
    </div>
  );
}
