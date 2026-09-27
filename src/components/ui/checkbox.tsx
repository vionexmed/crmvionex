import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      // A CAIXA VAZIA DEIXOU DE SER COLORIDA.
      //
      // Era `border-primary` nos dois estados: numa tabela de contatos, a
      // coluna de seleção desenhava dez quadradinhos na cor da marca ANTES de
      // qualquer seleção existir. Cor sem estado é decoração -- e gasta
      // exatamente o sinal que deveria dizer "este aqui está marcado".
      //
      // Vazia ela usa `--input`, a mesma linha de todo campo; marcada, o acento
      // chega cheio, fundo e fio. Aí a cor significa.
      "peer h-4 w-4 shrink-0 rounded-sm border border-input bg-card transition-colors hover:border-ring/70 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-current")}>
      {/* 12px dentro de uma caixa de 16: com `h-4` o traço encostava nos quatro
          lados e a marca parecia grande demais para a caixa. */}
      <Check className="h-3 w-3" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
