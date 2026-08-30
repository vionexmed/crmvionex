import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * O selo de situação de um negócio: aberto, ganho ou perdido.
 *
 * Estava montado à mão em QUATRO arquivos — `ContactDrawer`, `CompanyDrawer`,
 * `DealsList` e `DealDetail` — cada um com o próprio encadeamento de ternários
 * repetindo as mesmas classes. E divergiam: dois traduziam "open" para
 * "Aberto", um deles só renderizava quando o negócio não estava aberto, e o
 * tamanho do texto variava.
 *
 * O CSS tinha `.vx-badge-open`, `.vx-badge-won` e `.vx-badge-lost` prontos e
 * **nunca usados**, com as mesmas cores. Ficaram três anos de ninguém achar.
 */

const SITUACAO = {
  open: { rotulo: "Aberto", classe: "" },
  won: { rotulo: "Ganho", classe: "bg-success/10 text-success" },
  lost: { rotulo: "Perdido", classe: "bg-destructive/10 text-destructive" },
} as const;

export function SeloDeNegocio({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  // Situação desconhecida cai em "aberto": é o default da coluna, e inventar um
  // rótulo para um valor que o banco não deveria ter seria pior que assumi-lo.
  const s = SITUACAO[(status ?? "open") as keyof typeof SITUACAO] ?? SITUACAO.open;
  return (
    <Badge variant="secondary" className={cn("text-label", s.classe, className)}>
      {s.rotulo}
    </Badge>
  );
}
