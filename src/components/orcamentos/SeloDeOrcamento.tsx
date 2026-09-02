import { cn } from "@/lib/utils";
import type { Orcamento } from "@/lib/api/orcamentos";

/*
  O derivador mora em `orcamento-calculo.ts`, junto da aritmética -- e a edge
  function repete a MESMA regra em Deno, onde não dá para importar de `src`.
  Os dois pontos estão marcados: mudar a regra exige mudar os dois.
*/
import { estadoDoOrcamento } from "@/lib/orcamento-calculo";

const SELO: Record<string, { rotulo: string; classe: string }> = {
  rascunho: { rotulo: "Rascunho", classe: "bg-muted text-muted-foreground" },
  enviado: { rotulo: "Enviado", classe: "bg-primary/10 text-primary" },
  aprovado: { rotulo: "Aprovado", classe: "bg-success/10 text-success" },
  recusado: { rotulo: "Recusado", classe: "bg-destructive/10 text-destructive" },
  expirado: { rotulo: "Vencido", classe: "bg-warning/10 text-warning" },
};

export function SeloDeOrcamento({
  orcamento,
  className,
}: {
  orcamento: Pick<Orcamento, "status" | "valido_ate">;
  className?: string;
}) {
  const estado = estadoDoOrcamento(orcamento);
  const s = SELO[estado] ?? SELO.rascunho;

  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-label font-semibold uppercase tracking-wide",
        s.classe,
        className,
      )}
    >
      {s.rotulo}
    </span>
  );
}
