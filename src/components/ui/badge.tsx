import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  // `rounded-full` + `px-2.5` + `font-semibold` fazia cada selo virar uma
  // pílula gorda. Numa linha de tabela com quatro colunas de dado, três selos
  // assim dominam a linha e o dado vira secundário.
  //
  // Raio do token (o mesmo de tudo), menos preenchimento lateral, e peso médio
  // em vez de semibold: o selo passa a ser uma marca, não um botão.
  // `rounded-sm` (5px) e não `rounded-lg` (12px): no raio do CARTÃO um selo de
  // 18px de altura vira quase uma pílula -- que é o formato de que este
  // primitivo já tinha saído uma vez. O selo é uma marca, não um botão, e o
  // degrau pequeno da escala existe exatamente para os elementos pequenos.
  //
  // `gap-1` porque quase todo selo aqui leva um ponto de cor antes do texto.
  "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-label font-medium leading-4 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
        // O selo neutro ganhou LINHA.
        //
        // Era fundo sem borda, e sobre o rebaixo de uma célula de tabela ele
        // desaparecia -- `--secondary` e `--muted` são vizinhos na escala.
        // Com o fio ele existe sobre qualquer um dos três planos.
        secondary: "border-border bg-secondary text-secondary-foreground hover:bg-muted",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
