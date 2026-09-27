import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // `[&_svg]:size-3.5` e não `size-4`: o ícone acompanha a base de 13px, não a
  // de 16px que o shadcn assume. Um ícone de 16px ao lado de um rótulo de 13px
  // pesa mais que a palavra que ele ilustra.
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Sem `shadow-sm` por cima: a `.vx-btn-primary` já traz a própria
        // sombra na cor do acento, e as duas somadas davam uma borda cinza
        // por baixo do botão colorido.
        default: "vx-btn-primary text-primary-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // A linha é `--border` e não `--input`: `--input` é o degrau de campo,
        // mais escuro, e num botão ele lê como caixa de texto. O fundo é o do
        // CARTÃO e não o da página -- botão contornado quase sempre aparece
        // dentro de um cartão, e `bg-background` ali abria um buraco cinza.
        outline: "border border-border bg-card hover:bg-muted hover:text-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-muted",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      /*
       * A ESCADA DE ALTURA DESCEU UM DEGRAU INTEIRO.
       *
       * Era 40 / 36 / 44px, que é a escada do shadcn calibrada para corpo de
       * 16px. Com o corpo em 13px, um botão de 40px tem quase três vezes a
       * altura da própria letra -- e numa barra de ações com cinco botões,
       * como a de Contatos, a fileira sozinha come 40px verticais de uma tela
       * cuja densidade é o argumento de venda.
       *
       * 36px é o novo padrão e continua acima do piso de toque de 32px que o
       * `escala-tipografica.test.ts` cobra. O `sm` fica exatamente no piso.
       */
      size: {
        default: "h-9 px-3.5 py-2",
        sm: "h-8 rounded-md px-2.5",
        lg: "h-10 rounded-md px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
