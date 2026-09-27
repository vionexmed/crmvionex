import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        // `h-9`, acompanhando o botão: campo e botão lado a lado com alturas
        // diferentes é o desalinhamento mais visível de uma barra de filtros.
        //
        // `bg-card` e não `bg-background`: o campo quase sempre vive DENTRO de
        // um cartão, e ali o cinza da página abria um rebaixo onde deveria
        // haver uma caixa clara. Sobre a página ele continua se lendo, porque
        // a borda é `--input`, um degrau mais escuro que `--border`.
        //
        // `text-base md:text-sm` fica: 16px no celular é o que impede o iOS de
        // dar zoom ao focar o campo.
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1.5 text-base ring-offset-background transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-input/70 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
